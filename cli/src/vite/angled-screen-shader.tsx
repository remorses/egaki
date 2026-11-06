'use client'

/**
 * AngledScreen — WebGL depth-of-field 3D screen via Remotion HtmlInCanvas.
 *
 * Shader-based successor to BasicAngledScreen (angled-screen.tsx). Children
 * DOM is captured per frame with the HTML-in-canvas API (texElementImage2D)
 * and drawn by the framework-free renderer in @egaki/angled-screen, which
 * holds the shader, the depth of field model and the coordinate notes.
 * This file only adds Remotion timing, tweakpane controls and the export path.
 *
 * Requires Chrome 149+ with chrome://flags/#canvas-draw-element enabled.
 * Falls back to the CSS BasicAngledScreen when unsupported.
 *
 * EXPORT PATH (DOM-composer fallback), hard-won — don't re-debug:
 * When Remotion's nested HTML-in-canvas probe fails (Chromium changes the
 * API shape between builds), web-renderer composes exports/stills with the
 * DOM composer instead of native capture. Three things must line up for the
 * shader output to survive that path:
 *   1. The scaffold wrapper is visibility:hidden, and Chromium creates no
 *      paint records for hidden subtrees — captureElementImage() throws
 *      "missing paint record" and HtmlInCanvas SILENTLY skips onInit/onPaint
 *      (canRetryMissingPaintRecord swallows it). Fix: the egaki render entry
 *      points wrap the composition root in a visibility:visible div
 *      (wrapForWebRenderer in render-client.ts), restoring paint records
 *      while preserving deeper visibility:hidden semantics (e.g.
 *      LayoutTransition's hidden inactive instances). Do NOT force
 *      visibility on this component's canvas — that leaks into preview.
 *   2. remotion's HtmlInCanvas has a scoping bug (present through 4.0.495):
 *      it registers delayRender() on the GLOBAL window scope but the
 *      scaffold's waitForReady() polls its own delayRenderScope — so the
 *      renderer never waits for the nested canvas paint. Fix: this component
 *      registers its own properly-scoped useDelayRender() handle per frame
 *      while isRendering, calls requestPaint(), and releases the handle only
 *      after onPaint has drawn and blitted the frame.
 *      TODO: remove the scoped-delayRender workaround (and re-evaluate the
 *      visibility wrapper in render-client.ts) once this upstream issue is
 *      fixed: https://github.com/remotion-dev/remotion/issues/9367
 *   3. The DOM composer cannot read the transferred placeholder canvas, so
 *      every painted GL frame is blitted into a plain 2D mirror canvas that
 *      the composer picks up like any regular canvas.
 */

import {
  HtmlInCanvas,
  useCurrentFrame,
  useDelayRender,
  useRemotionEnvironment,
  useVideoConfig,
  type HtmlInCanvasOnInit,
  type HtmlInCanvasOnPaint,
} from 'remotion'
import { useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { useTweakpane } from './tweakpane-hook.tsx'
import {
  ANGLED_SCREEN_DEFAULTS,
  createAngledScreenRenderer,
  type AngledScreenParams,
  type AngledScreenRenderer,
} from '@egaki/angled-screen/src'
import { BasicAngledScreen } from './angled-screen.tsx'

/** Shader params (perspective, rotateX/Y/Z, bokeh, fog...) are documented on
 *  `AngledScreenParams` in @egaki/angled-screen. */
export interface AngledScreenProps extends Partial<AngledScreenParams> {
  children: ReactNode
  /** Width of the inner content wrapper. Default '80%'. */
  width?: string | number
  /** Height of the inner content wrapper. Default 'auto'. */
  height?: string | number
  /** Optional inline style on the outer container. */
  style?: CSSProperties
}

/** Chromium's html-in-canvas layout canvas exposes a non-standard
 *  requestPaint() (behind chrome://flags/#canvas-draw-element). */
type LayoutSubtreeCanvas = HTMLCanvasElement & { requestPaint?: () => void }

export function AngledScreen(props: AngledScreenProps) {
  const frame = useCurrentFrame()
  const { width: compW, height: compH, fps } = useVideoConfig()
  const glRef = useRef<{ renderer: AngledScreenRenderer; canvas: OffscreenCanvas } | null>(null)
  // Mirror canvas: the web-renderer's DOM composer (used for exports and SDK
  // screenshots whenever nested HTML-in-canvas capture is unavailable)
  // cannot read the HtmlInCanvas offscreen and paints the raw children
  // instead. Every painted GL frame is blitted into this plain 2D canvas
  // overlaid on top; the DOM composer draws it like any regular canvas.
  // It is always mounted (not only during export) because sdk.screenshot()
  // captures the live tree without ExportContext.
  const mirrorRef = useRef<HTMLCanvasElement | null>(null)
  const mirrorLoggedRef = useRef(false)

  // Export sync: while web-renderer renders (isRendering), hold a scoped
  // delayRender handle per frame and force a paint on the layout canvas.
  // Released in onPaint after the GL frame is blitted to the mirror, so
  // waitForReady() blocks until the shader output for THIS frame exists.
  // Needed because remotion's own "waiting for first paint" delayRender
  // registers on the window scope, which the export scaffold ignores.
  // TODO: remove once fixed upstream:
  // https://github.com/remotion-dev/remotion/issues/9367
  const { isRendering } = useRemotionEnvironment()
  const { delayRender, continueRender } = useDelayRender()
  const continueRenderRef = useRef(continueRender)
  continueRenderRef.current = continueRender
  const layoutCanvasRef = useRef<LayoutSubtreeCanvas | null>(null)
  const pendingPaintHandleRef = useRef<number | null>(null)

  const d = ANGLED_SCREEN_DEFAULTS
  const tp = useTweakpane('AngledScreen', {
    perspective: { value: props.perspective ?? d.perspective, min: 100, max: 3000, step: 10 },
    rotateX: { value: props.rotateX ?? d.rotateX, min: -90, max: 90, step: 0.5 },
    rotateY: { value: props.rotateY ?? d.rotateY, min: -90, max: 90, step: 0.5 },
    rotateZ: { value: props.rotateZ ?? d.rotateZ, min: -180, max: 180, step: 0.5 },
    translateX: { value: props.translateX ?? d.translateX, min: -1000, max: 1000, step: 1 },
    translateZ: { value: props.translateZ ?? d.translateZ, min: -500, max: 500, step: 1 },
    bokeh: props.bokeh ?? d.bokeh,
    aperture: { value: props.aperture ?? d.aperture, min: 0, max: 2, step: 0.01 },
    maxBlur: { value: props.maxBlur ?? d.maxBlur, min: 0, max: 0.3, step: 0.005 },
    // 0 = auto: only the far side blurs, progressively. Any other value =
    // fraction of perspective, like Three's focus uniform.
    focus: { value: props.focus ?? d.focus, min: 0, max: 2, step: 0.01 },
    fog: { value: props.fog ?? d.fog, min: 0, max: 1, step: 0.01 },
    grainIntensity: { value: props.grainIntensity ?? d.grainIntensity, min: 0, max: 0.3, step: 0.005 },
    chromaticAberration: { value: props.chromaticAberration ?? d.chromaticAberration, min: 0, max: 2, step: 0.01 },
    backgroundColor: props.backgroundColor ?? d.backgroundColor,
    debug: props.debug ?? d.debug,
  })

  const { perspective, rotateX, rotateY, rotateZ, translateX, translateZ } = tp
  const { aperture, maxBlur, focus, fog, grainIntensity, chromaticAberration } = tp
  const { bokeh, debug, backgroundColor } = tp
  const time = frame / fps

  const onInit: HtmlInCanvasOnInit = useCallback(({ canvas }) => {
    const renderer = createAngledScreenRenderer({ canvas })
    glRef.current = { renderer, canvas }
    return () => {
      renderer.dispose()
      glRef.current = null
    }
  }, [])

  const onPaint: HtmlInCanvasOnPaint = useCallback(
    ({ elementImage }) => {
      const state = glRef.current
      if (!state) return

      state.renderer.uploadElementImage(elementImage)
      state.renderer.draw({
        width: compW,
        height: compH,
        time,
        params: {
          perspective, rotateX, rotateY, rotateZ, translateX, translateZ,
          bokeh, aperture, maxBlur, focus, fog, grainIntensity, chromaticAberration,
          backgroundColor, debug,
        },
      })

      // Export path: mirror the GL frame into the overlay 2D canvas so the
      // DOM composer (used when nested HTML-in-canvas capture is
      // unavailable) picks up the shader output instead of the raw children.
      const mirror = mirrorRef.current
      if (mirror) {
        if (mirror.width !== state.canvas.width || mirror.height !== state.canvas.height) {
          mirror.width = state.canvas.width
          mirror.height = state.canvas.height
        }
        const ctx2d = mirror.getContext('2d')
        if (ctx2d) {
          ctx2d.drawImage(state.canvas, 0, 0)
          if (!mirrorLoggedRef.current) {
            mirrorLoggedRef.current = true
            console.info(
              '[egaki] AngledScreen: mirror canvas active — GL frames are blitted to a 2D canvas so DOM-composer captures (export/screenshot) include the shader output.',
            )
          }
        }
      }

      // Release the export-sync handle now that this frame's shader output
      // (including the mirror blit) is complete.
      const pending = pendingPaintHandleRef.current
      if (pending !== null) {
        pendingPaintHandleRef.current = null
        continueRenderRef.current(pending)
      }
    },
    [
      compW, compH, perspective, rotateX, rotateY, rotateZ, translateX, translateZ,
      bokeh, aperture, maxBlur, focus, fog, grainIntensity, chromaticAberration,
      backgroundColor, debug, time,
    ],
  )

  const supported = typeof document !== 'undefined' && HtmlInCanvas.isSupported()

  // Per-frame export sync (see comment on pendingPaintHandleRef). Layout
  // effect so the handle is registered synchronously inside the renderer's
  // flushSync time update, before waitForReady() first checks the scope.
  // Gated on `supported`: the CSS BasicAngledScreen fallback never paints,
  // so registering a handle there would hang the export until timeout.
  // Also gated on computed visibility: instances under visibility:hidden
  // ancestors (LayoutTransition ghosts and inactive timed instances) get no
  // Chromium paint records, so their HtmlInCanvas never fires paint and a
  // registered handle would hang the export. Premounted sections are fine —
  // remotion premount hides via opacity:0, which keeps paint records.
  useLayoutEffect(() => {
    if (!isRendering || !supported) return
    const canvas = layoutCanvasRef.current
    if (!canvas || getComputedStyle(canvas).visibility === 'hidden') return
    const handle = delayRender('AngledScreen: waiting for shader paint')
    pendingPaintHandleRef.current = handle
    layoutCanvasRef.current?.requestPaint?.()
    return () => {
      if (pendingPaintHandleRef.current === handle) {
        pendingPaintHandleRef.current = null
      }
      continueRenderRef.current(handle)
    }
  }, [frame, isRendering, supported, delayRender])
  if (!supported) {
    if (typeof console !== 'undefined' && !(globalThis as any).__egakiAngledScreenFallbackWarned) {
      ;(globalThis as any).__egakiAngledScreenFallbackWarned = true
      console.warn(
        '[egaki] AngledScreen: HTML-in-canvas is not supported in this browser — ' +
          'falling back to the CSS BasicAngledScreen (no true depth-of-field). ' +
          'Use Chrome 149+ and enable chrome://flags/#canvas-draw-element for the WebGL version.',
      )
    }
    return (
      <BasicAngledScreen
        perspective={perspective}
        rotateX={rotateX}
        rotateY={rotateY}
        rotateZ={rotateZ}
        translateZ={translateZ}
        bokeh={bokeh}
        bokehBlur={maxBlur * compW * 0.4}
        bokehOffset={0.5}
        backgroundColor={backgroundColor}
        width={props.width}
        height={props.height}
        debug={debug}
        style={{
          // BasicAngledScreen has no translateX — approximate with a CSS shift
          transform: translateX !== 0 ? `translateX(${translateX}px)` : undefined,
          ...props.style,
        }}
      >
        {props.children}
      </BasicAngledScreen>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...props.style }}>
      <HtmlInCanvas
        ref={layoutCanvasRef}
        width={compW}
        height={compH}
        pixelDensity={Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)}
        onInit={onInit}
        onPaint={onPaint}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: typeof props.width === 'number' ? `${props.width}px` : (props.width ?? '80%'),
              height: typeof props.height === 'number' ? `${props.height}px` : (props.height ?? 'auto'),
              position: 'relative',
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            {props.children}
          </div>
        </div>
      </HtmlInCanvas>
      <canvas
        ref={mirrorRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
