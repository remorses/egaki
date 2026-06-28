'use client'

/**
 * Client component: Remotion Player wrapper + MP4 export UI.
 *
 * Receives pre-rendered JSX sections from the server (via RSC flight).
 * All MDX processing (parsing, module resolution, safe-mdx rendering)
 * is done server-side in app.tsx. This component only handles:
 * - Wrapping sections in Remotion's Series/Sequence composition
 * - Rendering the Player
 * - MP4 export via WebCodecs
 */

import './styles.css'
import { Player, type PlayerRef } from '@remotion/player'
import React, { Suspense, useCallback, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, useState, type ReactNode } from 'react'
import {
  AbsoluteFill,
  Freeze,
  Sequence,
  Series,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from 'remotion'
import { renderInBrowser } from './render-client.ts'
import { createSpiceflowFetch } from 'spiceflow/client'
import type { app } from './app.tsx'
import { egakiStore } from './store.ts'
import { useGenerationStatus, useGenerationErrors, type GenerationStatus } from './store-hooks.ts'
import { egakiSDK } from './sdk.ts'
import { LayoutEditor, type SectionMeta } from './layout-editor.tsx'
import { TweakpaneRoot } from './tweakpane-hook.tsx'
import {
  Fill,
  LayoutAnimationLayer,
  LayoutGhost,
  LayoutTransitionProvider,
  MotionTimingSync,
  ServerSlotsContext,
} from './mdx-video.tsx'
import { SectionIndexContext } from './media-duration-store.ts'
import type { VideoFrontmatter } from './mdx-parse.ts'

// ---------------------------------------------------------------------------
// HMR scene-changed: store pending seek at module scope so it survives
// component remounts caused by rsc:update (spiceflow payload swap).
// The vite plugin sends egaki:scene-changed with { sectionIndex } when
// the user edits a specific section of the entry MDX.
// ---------------------------------------------------------------------------
let pendingSceneSeek: { sectionIndex: number; file: string } | null = null
/** Cancels the auto-pause listener from a previous scene-seek, so a new
 *  HMR during playback doesn't leave stale listeners that pause the wrong scene. */
let cancelPreviousAutoPlay: (() => void) | null = null
/** Monotonic counter to invalidate stale requestAnimationFrame callbacks
 *  when rapid successive HMR edits arrive before the first rAF fires. */
let sceneSeekVersion = 0

// ---------------------------------------------------------------------------
// Generation progress client — fetches /api/generation-progress on page
// load and on every rsc:update using the typed Spiceflow fetch client.
// The route is an async generator that yields progress events as SSE;
// createSpiceflowFetch returns an AsyncGenerator we consume with for-await.
// Max one connection at a time; new rsc:update aborts the previous one.
// ---------------------------------------------------------------------------

let progressAbortController: AbortController | null = null

function connectToProgress() {
  if (typeof window === 'undefined') return
  progressAbortController?.abort()
  const controller = new AbortController()
  progressAbortController = controller

  // Lazy-init: createSpiceflowFetch needs window.location.origin which
  // is only available in the browser, not during SSR.
  const safeFetch = createSpiceflowFetch<typeof app>(window.location.origin)

  ;(async () => {
    const result = await safeFetch('/api/generation-progress', {
      signal: controller.signal,
    })
    if (result instanceof Error) return

    // result is an AsyncGenerator<GenerationProgressEvent> from the streaming route
    try {
      for await (const event of result) {
        // Guard: if a newer connection replaced us, stop writing state
        if (progressAbortController !== controller) return

        // Log generation errors to the console and show them in the toolbar
        if (event.errors?.length) {
          for (const err of event.errors) {
            console.error(`[egaki] ${err.namespace} generation failed (${Math.round(err.durationMs / 1000)}s): ${err.error}`)
          }
          // Append new errors with unique IDs and auto-clear them after 8 seconds
          const errorIds = new Set<string>()
          const tagged = event.errors.map((e) => {
            const id = `${e.key}:${Date.now()}:${Math.random()}`
            errorIds.add(id)
            return { ...e, _id: id }
          })
          const currentErrors = egakiStore.getState().serverGenerationErrors
          egakiStore.setState({ serverGenerationErrors: [...currentErrors, ...tagged] })
          setTimeout(() => {
            egakiStore.setState({
              serverGenerationErrors: egakiStore.getState().serverGenerationErrors.filter(
                (e) => !errorIds.has((e as any)._id),
              ),
            })
          }, 8000)
        }
        const summary = event.summary
        egakiStore.setState({
          serverGenerationStatus: summary.total > 0 ? summary : null,
          serverGenerationEntries: event.generations,
        })
        if (event.done) break
      }
    } catch {
      // Aborted or network error — non-fatal
    }
    // Guard: only clear state if we're still the active connection
    if (progressAbortController === controller) {
      egakiStore.setState({ serverGenerationStatus: null, serverGenerationEntries: [] })
    }
  })()
}

// Connect on initial page load (guarded for SSR)
if (typeof window !== 'undefined') connectToProgress()

if (import.meta.hot) {
  import.meta.hot.on('egaki:scene-changed', (data: { sectionIndex: number; file: string }) => {
    pendingSceneSeek = data
  })
  // Reconnect on rsc:update — new generations may have started from
  // MDX edits that trigger server-side rendering of <Server> blocks.
  import.meta.hot.on('rsc:update', () => {
    // Small delay to let the server start processing before we connect,
    // so the first SSE event already includes the new generations.
    setTimeout(connectToProgress, 100)
  })
}

// Module-level stable callbacks for useSyncExternalStore (never re-subscribes)
const subscribeNoop = () => () => {}
const getClientMounted = () => true
const getServerMounted = () => false

const PLAYBACK_RATES = [0.5, 1, 1.5, 2, 4, 8] as const

function ToolbarSeparator() {
  return <div className='w-px h-4 bg-white/15' />
}

function DownloadIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
      <polyline points='7 10 12 15 17 10' />
      <line x1='12' y1='15' x2='12' y2='3' />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <line x1='18' y1='6' x2='6' y2='18' />
      <line x1='6' y1='6' x2='18' y2='18' />
    </svg>
  )
}

function ChevronUpIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <polyline points='18 15 12 9 6 15' />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <polyline points='6 9 12 15 18 9' />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg
      width='14'
      height='14'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className='animate-spin'
    >
      <path d='M21 12a9 9 0 1 1-6.219-8.56' />
    </svg>
  )
}

function formatGenerationStatus(status: GenerationStatus): string {
  const parts: string[] = []
  for (const [namespace, count] of Object.entries(status.counts)) {
    if (count <= 0) continue
    // Pluralize: add 's' for most, 'es' for speech
    const plural = count > 1 ? (namespace === 'speech' ? 'es' : 's') : ''
    parts.push(`${count} ${namespace}${plural}`)
  }
  return `Generating ${parts.join(', ')}`
}

/**
 * Remotion-aware Suspense fallback. When a section suspends (throws a promise),
 * this component calls delayRender() to prevent Remotion from taking a
 * screenshot of the incomplete frame. When the suspended component resolves
 * and this fallback unmounts, continueRender() fires and rendering proceeds.
 *
 * This is the same pattern Remotion uses internally in <Composition> (see
 * packages/core/src/Composition.tsx in the Remotion source).
 */
function SuspenseFallback() {
  const { delayRender, continueRender } = useDelayRender()
  // useLayoutEffect registers the delay handle before paint, preventing
  // the renderer from capturing a frame before the handle exists.
  useLayoutEffect(() => {
    const handle = delayRender('Waiting for section to unsuspend', {
      timeoutInMilliseconds: 10 * 60 * 1000,
    })
    return () => continueRender(handle)
  }, [delayRender, continueRender])

  // delayRender is a no-op in the Player, so this loading UI is only
  // visible during preview. During export, rendering pauses until the
  // suspended component resolves, then this fallback unmounts before
  // the screenshot is taken.
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#050505',
      }}
    >
      <span
        style={{
          fontSize: 48,
          fontWeight: 500,
          color: '#52525b',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
          letterSpacing: '-0.01em',
        }}
      >
        Loading…
      </span>
    </AbsoluteFill>
  )
}

interface SectionProps {
  heading: string | null
  durationInFrames: number
  jsx: ReactNode
}

// Shared by the visible section content and the hidden ghost copy of the
// previous section — element positions only match across the two containers
// if both use the exact same layout styles.
const SECTION_CONTENT_STYLE: React.CSSProperties = {
  zIndex: 1,
  gap: 'clamp(1rem, 2vw, 2.5rem)',
  // Force Chrome GPU compositing for subpixel text rendering.
  // Without this, Chrome snaps text positions to whole pixels
  // causing visible stutter on slow translate/scale animations.
  // Not supported by the web-renderer canvas export, but the
  // canvas renderer doesn't have Chrome's pixel snapping issue.
  // See: https://remotion.dev/docs/troubleshooting/subpixel-rendering
  perspective: '1000px',
  willChange: 'transform',
  // Grayscale antialiasing instead of subpixel. Subpixel rendering adds
  // RGB color fringing at text edges which creates shimmering artifacts
  // when text moves or scales in video. Grayscale is also consistent
  // across platforms (subpixel varies by OS and display).
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
} as React.CSSProperties

// How long (in seconds) the hidden ghost copy of the previous section stays
// mounted at the start of a section. LayoutTransition springs (default 20
// frames) settle well within this window. A constant is used because
// per-element durations are only known after children render — the ghost
// mount decision happens before that.
const GHOST_WINDOW_SECONDS = 5

// How many seconds before a section cut to premount the next section.
// Remotion's premountFor renders the next sequence early (hidden) so
// <Video> elements start loading before the cut, preventing stutter.
const PREMOUNT_SECONDS = 3

/**
 * Section content wrapper enabling <LayoutTransition> FLIP animations
 * across section boundaries.
 *
 * Renders the PREVIOUS section in a hidden ghost container, pinned at its
 * last frame via <Freeze>, so LayoutAnimationLayer can measure where each
 * LayoutTransition element was when the viewer last saw it. Seek-safe: the
 * ghost is derived purely from the current frame, never from playback order.
 *
 * Known limitation: the ghost's useVideoConfig().durationInFrames is clamped
 * by the CURRENT section's Series.Sequence (Remotion Sequences take
 * min(parent, own) duration). Exit animations in the previous section that
 * depend on durationInFrames measure slightly off when the current section
 * is shorter than the previous one. Position measurement is unaffected for
 * static layouts.
 */
function SectionWithLayoutTransition({
  jsx,
  prevJsx,
  prevDurationInFrames,
}: {
  jsx: ReactNode
  prevJsx: ReactNode | null
  prevDurationInFrames: number
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const showGhost =
    prevJsx != null && frame < fps * GHOST_WINDOW_SECONDS

  return (
    <LayoutTransitionProvider>
      <AbsoluteFill style={{ background: '#050505' }}>
        {showGhost ? (
          // Ghost: hidden but laid out (visibility:hidden keeps geometry).
          // opacity:0 is added for web-renderer safety, and the ghost comes
          // FIRST in DOM order so the visible section paints over it even
          // if a renderer ignores visibility (no z-index in web-renderer).
          <AbsoluteFill
            style={{ visibility: 'hidden', opacity: 0, pointerEvents: 'none' }}
            aria-hidden
          >
            <LayoutGhost>
              <Freeze frame={prevDurationInFrames - 1}>
                <Sequence
                  from={0}
                  durationInFrames={prevDurationInFrames}
                  layout="none"
                  showInTimeline={false}
                >
                  <Fill style={SECTION_CONTENT_STYLE}>
                    {prevJsx}
                  </Fill>
                </Sequence>
              </Freeze>
            </LayoutGhost>
          </AbsoluteFill>
        ) : null}
        <MotionTimingSync>
          <Fill style={SECTION_CONTENT_STYLE}>{jsx}</Fill>
        </MotionTimingSync>
        <LayoutAnimationLayer />
      </AbsoluteFill>
    </LayoutTransitionProvider>
  )
}

function VideoComposition({
  sections,
  totalDuration,
  preamble,
}: {
  sections: SectionProps[]
  totalDuration: number
  preamble?: ReactNode
}) {
  const { fps } = useVideoConfig()
  const premountFrames = Math.round(fps * PREMOUNT_SECONDS)

  return (
    <AbsoluteFill style={{ background: '#050505', fontSize: 60 }}>
      {/* Preamble: MDX content before the first heading. Rendered at
          composition level so it persists across all sections. Runs in the
          background behind the Series (earlier DOM order = behind). */}
      <MotionTimingSync>{preamble}</MotionTimingSync>
      {/* Sequential sections */}
      <Series>
        {sections.map((section, i) => (
          <Series.Sequence
            key={i}
            durationInFrames={section.durationInFrames}
            // @ts-ignore — name prop exists on Series.Sequence
            name={section.heading || `Section ${i}`}
            // Premount the next section N seconds early so <Video> elements
            // start loading before the cut, preventing playback stutter.
            // Remotion renders the premounted section hidden; it receives
            // its own correct frame context (starting at frame 0).
            premountFor={premountFrames}
          >
            <SectionIndexContext.Provider value={i}>
              <Suspense fallback={<SuspenseFallback />}>
                {/* Background components inside jsx self-position as AbsoluteFill
                    layers behind content via DOM order (rendered first = behind). */}
                <SectionWithLayoutTransition
                  jsx={section.jsx}
                  prevJsx={i > 0 ? sections[i - 1]!.jsx : null}
                  prevDurationInFrames={i > 0 ? sections[i - 1]!.durationInFrames : 0}
                />
              </Suspense>
            </SectionIndexContext.Provider>
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  )
}

export function PlayerPage({
  sections,
  totalDuration,
  preamble,
  entryPath,
  hasUnresolvedDurations = false,
  frontmatter,
  availableEntries = [],
  currentRoute = '',
}: {
  sections: SectionProps[]
  totalDuration: number
  preamble?: ReactNode
  /** Absolute path of the MDX entry file, included in copy prompts. */
  entryPath: string
  /** True when auto-duration sections haven't been visited yet (media
   *  durations still unknown). Gates the export button. */
  hasUnresolvedDurations?: boolean
  frontmatter: VideoFrontmatter
  /** All available MDX entry route paths for navigation. */
  availableEntries?: string[]
  /** Current route path ('' for default entry). */
  currentRoute?: string
}) {
  const { fps, width, height, scale } = frontmatter
  const serverSlots = useContext(ServerSlotsContext)
  // Stable component function that reads latest props from a ref.
  // Created once so its identity never changes between renders.
  // Remotion Player doesn't remount when component identity is stable.
  const propsRef = useRef({ sections, totalDuration, preamble, serverSlots })
  propsRef.current = { sections, totalDuration, preamble, serverSlots }

  // Wrap VideoComposition with ServerSlotsContext so that <Server> slots
  // are available during SDK export/screenshot (renderStillOnWeb /
  // renderMediaOnWeb create a fresh React tree from this component).
  const [Component] = useState(() => () => (
    <ServerSlotsContext.Provider value={propsRef.current.serverSlots}>
      <VideoComposition {...propsRef.current} />
    </ServerSlotsContext.Provider>
  ))

  const playerRef = useRef<PlayerRef>(null)
  const playerContainerRef = useRef<HTMLDivElement>(null)

  // Register the composition with the SDK so agents can call
  // window.egakiSDK.seekTo() / .screenshot() / .export() via Playwriter.
  useEffect(() => {
    egakiSDK.register({
      component: Component,
      totalDuration,
      fps,
      width,
      height,
      scale,
      sectionCount: sections.length,
      playerRef,
      playerContainerRef,
    })
  }, [Component, totalDuration, sections.length, fps, width, height, scale])

  // Consume pending scene seek after the RSC refetch delivers new sections.
  // The module-level pendingSceneSeek is set by import.meta.hot.on before
  // React re-renders; this effect fires after the commit with fresh data.
  // Seeks to the changed section's start frame, plays it, and pauses at
  // the section's end so the user sees exactly the content they edited.
  useEffect(() => {
    if (pendingSceneSeek == null) return
    // Ignore scene changes from a different entry MDX file.
    if (pendingSceneSeek.file !== entryPath) {
      pendingSceneSeek = null
      return
    }
    const idx = pendingSceneSeek.sectionIndex
    pendingSceneSeek = null

    // Wait one frame for the Remotion Player to initialize after remount.
    // Version token ensures stale rAF callbacks from rapid edits are ignored.
    const version = ++sceneSeekVersion
    requestAnimationFrame(() => {
      if (version !== sceneSeekVersion) return
      const player = playerRef.current
      if (!player || idx < 0 || idx >= sections.length) return

      // Compute section boundaries from current sections
      let startFrame = 0
      for (let i = 0; i < idx; i++) {
        startFrame += sections[i]!.durationInFrames
      }
      const endFrame = startFrame + sections[idx]!.durationInFrames - 1

      player.seekTo(startFrame)

      // Cancel any auto-pause from a previous HMR scene-seek so stale
      // listeners don't pause playback in the wrong section.
      cancelPreviousAutoPlay?.()
      cancelPreviousAutoPlay = null

      // Only auto-play if currently paused (after rsc:update remount
      // the player always starts paused at frame 0)
      if (!player.isPlaying()) {
        player.play()

        // Pause at section end so only the edited section plays.
        // If the user manually seeks (clicks timeline, arrow keys, etc.)
        // cancel the auto-pause so we don't randomly stop playback later.
        let cancelled = false
        const cleanup = () => {
          if (cancelled) return
          cancelled = true
          cancelPreviousAutoPlay = null
          player.removeEventListener('frameupdate', onFrame as any)
          player.removeEventListener('seeked', onSeek as any)
        }
        cancelPreviousAutoPlay = cleanup
        const onFrame = () => {
          if (cancelled) return
          if (player.getCurrentFrame() >= endFrame) {
            player.pause()
            cleanup()
          }
        }
        const onSeek = (e: any) => {
          // User seeked away — cancel auto-pause. Ignore seeks within
          // the target section range (could be our own seekTo settling).
          const frame = e?.detail?.frame ?? player.getCurrentFrame()
          if (frame < startFrame || frame > endFrame) {
            cleanup()
          }
        }
        player.addEventListener('frameupdate', onFrame as any)
        player.addEventListener('seeked', onSeek as any)
      }
    })
  }, [sections])

  // Defer Player mount to client only. Remotion's Player and all composition
  // components (Series, AbsoluteFill, Audio, Video) use React context provided
  // by Player at runtime. During SSR there's no Remotion context, so hooks like
  // useCurrentFrame/useVideoConfig crash with "Cannot read properties of null
  // (reading 'useContext')". useSyncExternalStore returns false on the server
  // and true on the client synchronously during hydration (no useEffect tick).
  const mounted = useSyncExternalStore(subscribeNoop, getClientMounted, getServerMounted)

  const generationStatus = useGenerationStatus()
  const generationErrors = useGenerationErrors()

  const [editing, setEditing] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [rendering, setRendering] = useState(false)
  const [progress, setProgress] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [currentFrame, setCurrentFrame] = useState(0)

  // Track current frame for scene navigation button states
  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    const onFrame = () => setCurrentFrame(player.getCurrentFrame())
    // Remotion Player fires 'frameupdate' on seek and during playback
    player.addEventListener('frameupdate', onFrame as any)
    return () => player.removeEventListener('frameupdate', onFrame as any)
  }, [mounted])

  // Precompute section start frames for navigation
  const sectionStarts: number[] = []
  {
    let acc = 0
    for (const s of sections) {
      sectionStarts.push(acc)
      acc += s.durationInFrames
    }
  }

  // Determine which section the current frame is in
  let currentSectionIdx = 0
  for (let i = sectionStarts.length - 1; i >= 0; i--) {
    if (currentFrame >= sectionStarts[i]!) {
      currentSectionIdx = i
      break
    }
  }
  const hasPrevScene = currentSectionIdx > 0 || currentFrame > 0
  const hasNextScene = currentSectionIdx < sections.length - 1

  // Double-tap prev: first tap seeks to current section start, second tap
  // within 400ms jumps to the previous section (like music player track skip).
  const lastPrevTapRef = useRef<{ time: number; targetFrame: number }>({ time: 0, targetFrame: -1 })

  const goToPrevScene = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    const wasPlaying = player.isPlaying()
    if (wasPlaying) player.pause()
    const frame = player.getCurrentFrame()
    // Find the section start strictly before the current frame
    let target = 0
    for (let i = sectionStarts.length - 1; i >= 0; i--) {
      if (sectionStarts[i]! < frame) {
        target = sectionStarts[i]!
        break
      }
    }
    // Double-tap: if we just seeked to this same target within 400ms,
    // go one section further back
    const now = Date.now()
    const last = lastPrevTapRef.current
    if (now - last.time < 400 && last.targetFrame === target && target > 0) {
      // Find the section start before the current target
      let deeperTarget = 0
      for (let i = sectionStarts.length - 1; i >= 0; i--) {
        if (sectionStarts[i]! < target) {
          deeperTarget = sectionStarts[i]!
          break
        }
      }
      target = deeperTarget
    }
    lastPrevTapRef.current = { time: now, targetFrame: target }
    player.seekTo(target)
    if (wasPlaying) player.play()
  }, [sectionStarts])

  const goToNextScene = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    const wasPlaying = player.isPlaying()
    if (wasPlaying) player.pause()
    const frame = player.getCurrentFrame()
    let target = totalDuration - 1
    for (const start of sectionStarts) {
      if (start > frame) {
        target = start
        break
      }
    }
    player.seekTo(target)
    if (wasPlaying) player.play()
  }, [sectionStarts, totalDuration])

  // Sync playbackRate state when user changes it via the gear menu
  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    const onRateChange: EventListener = (e: any) => {
      setPlaybackRate(e.detail?.playbackRate ?? 1)
    }
    player.addEventListener('ratechange', onRateChange as any)
    return () => player.removeEventListener('ratechange', onRateChange as any)
  }, [mounted])

  // Keyboard shortcuts — modeled after After Effects / Premiere / DaVinci.
  // Disabled when the layout editor is active (it may use arrow keys).
  //
  //   Left/Right        ±1 frame
  //   Shift+Left/Right  ±10 frames
  //   Up/Down           prev/next section
  //   , / .             ±1 frame (Premiere convention)
  //   Home / End        first / last frame
  //   J / K / L         rewind 2s / pause / play (L×2=2x, ×3=4x, ×4=8x)
  //   0-9               jump to 0%-90% of timeline
  useEffect(() => {
    if (editing) return

    const clamp = (frame: number) => Math.max(0, Math.min(totalDuration - 1, frame))

    const onKeyDown = (e: KeyboardEvent) => {
      const player = playerRef.current
      if (!player) return
      // Ignore when focus is on an input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

      const frame = player.getCurrentFrame()

      // --- Frame stepping ---
      if (e.key === 'ArrowLeft' && !e.shiftKey) {
        e.preventDefault()
        if (player.isPlaying()) player.pause()
        player.seekTo(clamp(frame - 1))
        return
      }
      if (e.key === 'ArrowRight' && !e.shiftKey) {
        e.preventDefault()
        if (player.isPlaying()) player.pause()
        player.seekTo(clamp(frame + 1))
        return
      }
      if (e.key === ',') {
        e.preventDefault()
        if (player.isPlaying()) player.pause()
        player.seekTo(clamp(frame - 1))
        return
      }
      if (e.key === '.') {
        e.preventDefault()
        if (player.isPlaying()) player.pause()
        player.seekTo(clamp(frame + 1))
        return
      }

      // --- 10-frame jump (Shift+Arrow) ---
      if (e.key === 'ArrowLeft' && e.shiftKey) {
        e.preventDefault()
        if (player.isPlaying()) player.pause()
        player.seekTo(clamp(frame - 10))
        return
      }
      if (e.key === 'ArrowRight' && e.shiftKey) {
        e.preventDefault()
        if (player.isPlaying()) player.pause()
        player.seekTo(clamp(frame + 10))
        return
      }

      // --- Section navigation (Up/Down) — delegates to goToPrev/NextScene
      //     which preserve playback state and support double-tap prev ---
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        goToPrevScene()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        goToNextScene()
        return
      }

      // --- Home / End ---
      if (e.key === 'Home') {
        e.preventDefault()
        if (player.isPlaying()) player.pause()
        player.seekTo(0)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        if (player.isPlaying()) player.pause()
        player.seekTo(totalDuration - 1)
        return
      }

      // --- J / K / L (NLE transport) ---
      // L = play, tap again to double speed (1→2→4→8 cap)
      // K = pause, reset rate to 1
      // J = rewind 2 seconds (reverse playback is unreliable in browsers)
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        if (!player.isPlaying()) {
          setPlaybackRate(1)
          player.play()
        } else {
          // Cycle to next rate in the list
          setPlaybackRate((prev) => {
            const idx = PLAYBACK_RATES.indexOf(prev as any)
            return PLAYBACK_RATES[Math.min((idx === -1 ? 1 : idx) + 1, PLAYBACK_RATES.length - 1)]!
          })
        }
        return
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        player.pause()
        setPlaybackRate(1)
        return
      }
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault()
        // Seek backward 2 seconds
        if (player.isPlaying()) player.pause()
        player.seekTo(clamp(frame - Math.round(fps * 2)))
        return
      }

      // --- 0-9: jump to percentage of timeline ---
      if (e.key >= '0' && e.key <= '9' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const pct = parseInt(e.key, 10) / 10
        player.seekTo(Math.floor(totalDuration * pct))
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editing, totalDuration, sections, goToPrevScene, goToNextScene, fps])

  const handleExport = useCallback(async () => {
    setRendering(true)
    setProgress(0)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const blob = await renderInBrowser({
        component: Component,
        durationInFrames: totalDuration,
        fps,
        width,
        height,
        scale,
        onProgress: (p) => setProgress(p),
        signal: controller.signal,
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'video.mp4'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      if ((err as Error).message?.includes('cancelled')) {
        console.log('Export cancelled')
      } else {
        console.error('Export failed:', err)
      }
    } finally {
      setRendering(false)
      abortRef.current = null
    }
  }, [Component, totalDuration, fps, width, height, scale])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return (
    <div className='flex flex-col items-center justify-center min-h-screen bg-black'
      style={{ paddingBottom: 96, paddingTop: 24 }}>
      <TweakpaneRoot playerRef={playerRef} fps={fps} sections={sections} entryPath={entryPath} />
      {/* Player — fills page width, but capped so the 16:9 height never
          exceeds the viewport height minus toolbar space (bottom-6 padding +
          toolbar height ≈ 96px). The same 96px is applied as padding-bottom
          on the outer container so the player centers in the remaining space. */}
      <div
        ref={playerContainerRef}
        style={{ maxWidth: `calc((100vh - 120px) * ${width / height})` }}
        className='w-full overflow-hidden'
      >
        {mounted ? (
          <Player
            key={resetKey}
            ref={playerRef}
            component={Component}
            durationInFrames={totalDuration}
            fps={fps}
            compositionWidth={width}
            compositionHeight={height}
            loop
            controls
            clickToPlay={!editing}
            spaceKeyToPlayOrPause
            playbackRate={playbackRate}
            style={{ width: '100%' }}
            errorFallback={({ error }) => (
              <AbsoluteFill
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#050505',
                  padding: '5% 8%',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '1rem',
                    maxWidth: '80%',
                    textAlign: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: 48,
                      fontWeight: 600,
                      color: '#ef4444',
                      fontFamily:
                        '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    Render Error
                  </span>
                  <pre
                    style={{
                      fontSize: 14,
                      fontWeight: 400,
                      color: '#a1a1aa',
                      fontFamily:
                        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      textAlign: 'left',
                      maxHeight: '50%',
                      overflow: 'auto',
                      width: '100%',
                      margin: 0,
                      lineHeight: 1.5,
                    }}
                  >
                    {error.stack || error.message}
                  </pre>
                </div>
              </AbsoluteFill>
            )}
          />
        ) : (
          <div className='aspect-video bg-[#050505]' />
        )}
      </div>

      {/* Floating toolbar — fixed at bottom center */}
      <div className='fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-[#1c1c1c] border border-white/10 px-2 py-1.5 shadow-2xl'>
        {/* Entry selector — only shown when multiple MDX files exist */}
        {availableEntries.length > 1 && (
          <>
            <select
              value={currentRoute}
              onChange={(e) => {
                const route = e.target.value
                const base = import.meta.env.BASE_URL ?? '/'
                window.location.href = `${base}${route}`
              }}
              className='appearance-none rounded-full px-3 py-1.5 text-[13px] font-medium text-zinc-300 bg-transparent hover:bg-white/5 transition-colors cursor-pointer outline-none'
              style={{ maxWidth: 150 }}
            >
              {availableEntries.map((route) => (
                <option key={route} value={route} style={{ background: '#1c1c1c', color: '#d4d4d8' }}>
                  {route || '(default)'}
                </option>
              ))}
            </select>
            <ToolbarSeparator />
          </>
        )}

        {rendering ? (
          <>
            <button
              onClick={handleCancel}
              className='flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer'
            >
              <XIcon />
              Cancel
            </button>
            <ToolbarSeparator />
            <div className='flex items-center gap-2.5 px-2'>
              <div className='w-24 h-1 rounded-full bg-white/10 overflow-hidden'>
                <div
                  className='h-full rounded-full bg-sky-400 transition-[width] duration-300'
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <span className='text-[13px] text-zinc-500 tabular-nums'>
                {Math.round(progress * 100)}%
              </span>
            </div>
          </>
        ) : (
          <button
            onClick={handleExport}
            className='flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-sky-950 bg-sky-200 hover:bg-sky-100 transition-colors cursor-pointer'
          >
            <DownloadIcon />
            Export MP4
          </button>
        )}

        <ToolbarSeparator />

        {/* Playback rate — click to cycle, synced with J/K/L shortcuts */}
        <button
          onClick={() => {
            setPlaybackRate((prev) => {
              const idx = PLAYBACK_RATES.indexOf(prev as any)
              const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length]!
              return next
            })
          }}
          className='flex items-center rounded-full px-2.5 py-1.5 text-[13px] font-medium tabular-nums text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer min-w-[3rem] justify-center'
          title='Playback speed (click to cycle)'
        >
          {playbackRate === 1 ? '1x' : `${playbackRate}x`}
        </button>

        <ToolbarSeparator />

        {/* Scene navigation — prev (Up) / next (Down) */}
        <div className='flex items-center'>
          <button
            onClick={goToPrevScene}
            disabled={!hasPrevScene}
            className='flex items-center justify-center rounded-full w-7 h-7 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-zinc-400'
            title='Previous scene (↑)'
          >
            <ChevronUpIcon />
          </button>
          <button
            onClick={goToNextScene}
            disabled={!hasNextScene}
            className='flex items-center justify-center rounded-full w-7 h-7 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-zinc-400'
            title='Next scene (↓)'
          >
            <ChevronDownIcon />
          </button>
        </div>

        <ToolbarSeparator />

        <LayoutEditor
          playerContainerRef={playerContainerRef}
          playerRef={playerRef}
          editing={editing}
          onEditingChange={setEditing}
          onReset={() => setResetKey((k) => k + 1)}
          sections={sections}
          fps={fps}
          entryPath={entryPath}
        />

        {generationStatus && (
          <>
            <ToolbarSeparator />
            <div className='flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium text-amber-400/90'>
              <SpinnerIcon />
              <span>{formatGenerationStatus(generationStatus)}</span>
            </div>
          </>
        )}

        {generationErrors.length > 0 && (
          <>
            <ToolbarSeparator />
            <div className='flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium text-red-400/90'>
              <span style={{ fontSize: 14, lineHeight: 1 }}>✕</span>
              <span>{generationErrors.length === 1
                ? `${generationErrors[0]!.namespace} failed: ${generationErrors[0]!.error.slice(0, 60)}`
                : `${generationErrors.length} generations failed`
              }</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
