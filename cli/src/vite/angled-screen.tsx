'use client'

/**
 * BasicAngledScreen — CSS 3D perspective wrapper with fake bokeh depth-of-field.
 *
 * The shader-based version (true depth-of-field via WebGL) lives in
 * angled-screen-shader.tsx and is exported as AngledScreen. This CSS version
 * is kept as a lightweight fallback that works without HTML-in-canvas support.
 *
 * Wraps any children (images, videos, divs) in a 3D-transformed plane using
 * CSS `perspective` + `transform: rotateX/Y/Z`. Simulates depth-of-field
 * via `backdrop-filter: blur()` masked with `mask-image: linear-gradient()`
 * so only the far edge of the content gets blurred.
 *
 * The blur direction is auto-detected from the rotation angles: whichever
 * edge is furthest from the camera gets blurred. Override with bokehDirection.
 *
 * IMPORTANT: the blur overlay lives OUTSIDE the 3D transform as a sibling
 * in the outer container. backdrop-filter does not work inside CSS 3D
 * transformed elements (the transform compositing layer breaks backdrop
 * sampling and blurs everything regardless of mask). Placing it outside
 * means it blurs the already-composited 3D scene in normal 2D space.
 *
 * Set `debug` to visualize the mask gradient as green (sharp) / red (blur).
 */

import { type CSSProperties, type ReactNode } from 'react'
import { ANGLED_SCREEN_DEFAULTS } from '@egaki/angled-screen/src'
import { useTweakpane } from './tweakpane-hook.tsx'

export interface BasicAngledScreenProps {
  children: ReactNode

  // --- 3D transform ---
  /** CSS perspective distance in px. Smaller = more dramatic. Default 1200. */
  perspective?: number
  /** X-axis rotation in degrees (tilts top/bottom). Default 8. */
  rotateX?: number
  /** Y-axis rotation in degrees (angles left/right). Default -12. */
  rotateY?: number
  /** Z-axis rotation in degrees. Default 0. */
  rotateZ?: number
  /** Push the plane forward/back in px. Positive = closer/larger,
   *  negative = further/smaller (same visual effect as scale). Default 0. */
  translateZ?: number
  /** Transform origin. Default '50% 50%'. */
  transformOrigin?: string

  // --- Bokeh (fake depth-of-field) ---
  /** Enable bokeh blur overlay. Default true. */
  bokeh?: boolean
  /** Max blur radius in px at the far edge. Default 12. */
  bokehBlur?: number
  /** Override which edge gets blurred. Auto-detected from rotation if omitted. */
  bokehDirection?: 'top' | 'bottom' | 'left' | 'right'
  /** Where blur starts (0-1). 0 = blur from the very near edge, 1 = no blur.
   *  The transition ramp is a fixed 25% after this point. Default 0.3. */
  bokehOffset?: number

  // --- Background ---
  /** Background color behind the tilted screen. Default '#000000'. */
  backgroundColor?: string

  // --- Sizing ---
  /** Width of the screen content. Default '80%'. */
  width?: string | number
  /** Height of the screen content. Default 'auto'. */
  height?: string | number

  /** Show the blur mask as green (sharp) / red (blur) overlay for debugging. */
  debug?: boolean

  /** Optional inline style on the outer container. */
  style?: CSSProperties
}

const GRADIENT_DIRECTIONS: Record<string, string> = {
  top: 'to top',
  bottom: 'to bottom',
  left: 'to left',
  right: 'to right',
}

/**
 * Auto-detect which edge is furthest from camera based on rotation.
 * CSS rotateY(-20deg): right edge comes toward viewer, LEFT is far → blur left.
 * CSS rotateY(+20deg): left edge comes toward viewer, RIGHT is far → blur right.
 * CSS rotateX(+10deg): top edge comes toward viewer, BOTTOM is far → blur bottom.
 * CSS rotateX(-10deg): bottom edge comes toward viewer, TOP is far → blur top.
 * Picks the axis with the larger rotation angle.
 */
function autoDirection(rotateX: number, rotateY: number): 'top' | 'bottom' | 'left' | 'right' {
  if (Math.abs(rotateY) >= Math.abs(rotateX)) {
    return rotateY < 0 ? 'left' : 'right'
  }
  return rotateX > 0 ? 'bottom' : 'top'
}

/**
 * @deprecated Use `AngledScreen` (angled-screen-shader.tsx) instead — the
 * WebGL version with true depth-of-field. This CSS version only remains as
 * the automatic fallback for browsers without HTML-in-canvas support.
 */
export function BasicAngledScreen(props: BasicAngledScreenProps) {
  const {
    children,
    transformOrigin = '50% 50%',
    bokehDirection,
    backgroundColor = ANGLED_SCREEN_DEFAULTS.backgroundColor,
    width = '80%',
    height = 'auto',
    style,
  } = props

  const d = ANGLED_SCREEN_DEFAULTS
  const tp = useTweakpane('BasicAngledScreen', {
    perspective: { value: props.perspective ?? d.perspective, min: 100, max: 3000, step: 10 },
    rotateX: { value: props.rotateX ?? d.rotateX, min: -90, max: 90, step: 0.5 },
    rotateY: { value: props.rotateY ?? d.rotateY, min: -90, max: 90, step: 0.5 },
    rotateZ: { value: props.rotateZ ?? d.rotateZ, min: -180, max: 180, step: 0.5 },
    translateZ: { value: props.translateZ ?? d.translateZ, min: -500, max: 500, step: 1 },
    bokeh: props.bokeh ?? d.bokeh,
    bokehBlur: { value: props.bokehBlur ?? 12, min: 0, max: 50, step: 0.5 },
    bokehOffset: { value: props.bokehOffset ?? 0.3, min: 0, max: 1, step: 0.01 },
    debug: props.debug ?? false,
  })

  const { perspective, rotateX, rotateY, rotateZ, translateZ } = tp
  const { bokeh, bokehBlur, bokehOffset } = tp
  const showDebug = tp.debug as boolean
  const direction = bokehDirection ?? autoDirection(rotateX, rotateY)
  const gradientDir = GRADIENT_DIRECTIONS[direction] || 'to right'
  const startPct = `${bokehOffset * 100}%`
  const endPct = `${Math.min((bokehOffset + 0.25) * 100, 100)}%`

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Moving layer: receives user style (translateX, etc.) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style,
        }}
      >
        {/* Perspective container */}
        <div
          style={{
            perspective: `${perspective}px`,
            perspectiveOrigin: '50% 50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
          }}
        >
          {/* Transformed plane */}
          <div
            style={{
              transform: [
                `rotateX(${rotateX}deg)`,
                `rotateY(${rotateY}deg)`,
                `rotateZ(${rotateZ}deg)`,
                translateZ !== 0 ? `translateZ(${translateZ}px)` : '',
              ]
                .filter(Boolean)
                .join(' '),
              transformOrigin,
              width: typeof width === 'number' ? `${width}px` : width,
              height: typeof height === 'number' ? `${height}px` : height,
              position: 'relative',
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            {children}
          </div>
        </div>
      </div>

      {/* Bokeh blur: fixed in screen space, does NOT move with the image.
          Acts like a camera lens DOF effect. Lives outside the moving layer
          and outside the 3D transform (backdrop-filter is broken inside
          CSS 3D transformed elements). */}
      {bokeh && bokehBlur > 0 && !showDebug && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backdropFilter: `blur(${bokehBlur}px)`,
            WebkitBackdropFilter: `blur(${bokehBlur}px)`,
            maskImage: `linear-gradient(${gradientDir}, transparent ${startPct}, black ${endPct})`,
            WebkitMaskImage: `linear-gradient(${gradientDir}, transparent ${startPct}, black ${endPct})`,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Debug: show the mask shape as green (sharp) to red (blur) */}
      {showDebug && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(${gradientDir}, rgba(0,255,0,0.4) ${startPct}, rgba(255,0,0,0.4) ${endPct})`,
            pointerEvents: 'none',
            zIndex: 999,
          }}
        />
      )}
    </div>
  )
}
