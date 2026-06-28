'use client'

/**
 * Ghost-aware media components for egaki video.
 *
 * Wraps Remotion's Img and @remotion/media's Audio/Video with:
 * - LayoutTransition ghost neutralization (Audio renders nothing in ghost,
 *   Video renders a lightweight div placeholder for FLIP measurement)
 * - Promise<string> src support via Suspense + React 19 use()
 * - Auto duration reporting to the per-section duration store
 * - Tweakpane trim controls for interactive Video editing
 * - Export-aware delayRender for frame capture blocking
 *
 * Also defines ExportContext for detecting export mode (renderMediaOnWeb).
 */

import {
  createContext,
  Suspense,
  use,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import {
  Img as RemotionImg,
  Sequence,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from 'remotion'
import { Audio as MediaAudio, Video as MediaVideo } from '@remotion/media'
import { LayoutContainerContext } from './layout-transition.tsx'
import {
  getCachedRawDuration,
  cacheRawDuration,
  computeEffectiveDuration,
  computeRetimeRate,
  reportSectionDuration,
  useSectionIndex,
} from './media-duration-store.ts'
import { useTweakpane } from './tweakpane-hook.tsx'

// ---------------------------------------------------------------------------
// Export context — lets components detect when they're inside a render export
// ---------------------------------------------------------------------------

export const ExportContext = createContext(false)

/** Returns true when the component is rendering inside an export (renderMediaOnWeb). */
export function useIsExporting(): boolean {
  return useContext(ExportContext)
}

// ---------------------------------------------------------------------------
// useReportMediaDuration
//
// Shared hook for Audio/Video: fetches raw media duration, computes
// effective playback duration (accounting for trim + playbackRate), and
// reports to the per-section duration store.
//
// Priority:
//   1. Both trimBefore + trimAfter set → compute from props, no fetch.
//   2. Raw src cached → compute effective from cached raw + trim + rate.
//   3. Cache miss → delayRender, fetch via mediabunny, cache raw, compute
//      effective, report, continueRender.
//
// Returns the RAW source duration (for tweakpane trim controls). null until
// known. Reports the EFFECTIVE duration to the section store.
//
// Uses delayRender to block export rendering until the duration is known.
//
// Reports are NOT cleared on unmount. Remotion's Series.Sequence unmounts
// inactive sections during normal seek/playback; clearing on unmount would
// cause an infinite loop (report → duration changes → remount → report).
// Reports persist for the lifetime of the composition and are reset when
// the MDX/modules change (see resetSectionDurations in mdx-client.tsx).
// ---------------------------------------------------------------------------

/**
 * @param skip - Skip everything (no fetch, no report). Use for ghost
 *   containers and unresolved promise src.
 * @param skipReport - Fetch raw duration but do not report effective
 *   duration to the section store. Use when the media conforms to the
 *   section (retimeToFit=true) rather than determining it.
 */
function useReportMediaDuration(props: {
  src?: string
  trimBefore?: number
  trimAfter?: number
  playbackRate?: number
  gapBefore?: number
  gapAfter?: number
}, skip?: boolean, skipReport?: boolean): number | null {
  const instanceId = useId()
  const sectionIndex = useSectionIndex()
  const { fps } = useVideoConfig()
  const { delayRender, continueRender } = useDelayRender()
  const isExporting = useIsExporting()
  const [rawDuration, setRawDuration] = useState<number | null>(null)

  // useLayoutEffect ensures delayRender is registered before paint,
  // preventing the renderer from capturing a frame before the handle exists.
  useLayoutEffect(() => {
    if (!props.src || skip) return

    let delayHandle: number | null = null
    let disposed = false

    const reportEffective = (raw: number) => {
      if (skipReport) return
      const effective = computeEffectiveDuration({
        rawSeconds: raw,
        fps,
        trimBefore: props.trimBefore,
        trimAfter: props.trimAfter,
        playbackRate: props.playbackRate,
        gapBefore: props.gapBefore,
        gapAfter: props.gapAfter,
      })
      if (effective != null && effective > 0) {
        reportSectionDuration(sectionIndex, instanceId, effective)
      }
    }

    // Fast path: both trim bounds set → effective duration fully determined.
    // Still compute and report, but don't short-circuit the raw duration
    // fetch — callers (retimeToFit) may need the raw value even when both
    // trim bounds are present.
    const effectiveFromProps = computeEffectiveDuration({
      fps,
      trimBefore: props.trimBefore,
      trimAfter: props.trimAfter,
      playbackRate: props.playbackRate,
      gapBefore: props.gapBefore,
      gapAfter: props.gapAfter,
    })
    if (effectiveFromProps != null) {
      if (!skipReport) {
        reportSectionDuration(sectionIndex, instanceId, effectiveFromProps)
      }
      // If we don't need to fetch raw duration for other purposes, return early
      if (!skipReport) return
      // When skipReport is true (retimeToFit), still try to populate rawDuration
      // from cache so retime rate can be computed. Fall through to cache check.
    }

    // Check raw src cache
    const cachedRaw = getCachedRawDuration(props.src)
    if (cachedRaw !== undefined) {
      setRawDuration(cachedRaw)
      reportEffective(cachedRaw)
      return
    }

    // Cache miss: during export, block rendering until metadata is known.
    // In the interactive Player, delayRender still creates global handles even
    // though playback buffering is handled by Remotion's separate BufferState.
    // Keeping it export-only avoids stale render-ready state during trim seeks.
    if (isExporting) {
      delayHandle = delayRender('Fetching media duration for ' + props.src)
    }

    void (async () => {
      try {
        const { Input, UrlSource, ALL_FORMATS } = await import('mediabunny')
        if (disposed) return
        const input = new Input({
          formats: ALL_FORMATS,
          source: new UrlSource(props.src!),
        })
        const duration =
          (await input.getDurationFromMetadata()) ??
          (await input.computeDuration())
        input.dispose()
        if (!disposed && isFinite(duration) && duration > 0) {
          cacheRawDuration(props.src!, duration)
          setRawDuration(duration)
          reportEffective(duration)
        }
      } catch {
        // Source unreadable or unsupported format; skip
      } finally {
        if (delayHandle != null) {
          continueRender(delayHandle)
          delayHandle = null
        }
      }
    })()

    return () => {
      disposed = true
      if (delayHandle != null) {
        continueRender(delayHandle)
        delayHandle = null
      }
    }
  }, [props.src, skip, skipReport, sectionIndex, instanceId, fps, props.trimBefore, props.trimAfter, props.playbackRate, props.gapBefore, props.gapAfter, isExporting])

  return rawDuration
}

// ---------------------------------------------------------------------------
// ExportDelayFallback — Suspense fallback that blocks Remotion frame capture
// during export when a promise src is still pending. In the interactive Player,
// renders nothing (no blocking needed).
// ---------------------------------------------------------------------------

function ExportDelayFallback() {
  const isExporting = useIsExporting()
  const { delayRender, continueRender } = useDelayRender()

  useLayoutEffect(() => {
    if (!isExporting) return
    const handle = delayRender('Waiting for async media src')
    return () => continueRender(handle)
  }, [isExporting, delayRender, continueRender])

  return null
}

// ---------------------------------------------------------------------------
// Promise-aware media components — Audio, Video, Img all accept
// src: string | Promise<string>. When a promise is passed, the component
// wraps internally in Suspense + use() to resolve it. During export,
// delayRender blocks frame capture until the promise resolves.
// ---------------------------------------------------------------------------

type ImgProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | Promise<string>
}

function ResolvedImg({ srcPromise, ...rest }: { srcPromise: Promise<string> } & Omit<ImgProps, 'src'>) {
  const src = use(srcPromise)
  return <Img src={src} {...rest} />
}

export function Img(props: ImgProps) {
  const { style, src, ...rest } = props
  if (!src) return null
  if (src instanceof Promise) {
    return (
      <Suspense fallback={<ExportDelayFallback />}>
        <ResolvedImg srcPromise={src} style={style} {...rest} />
      </Suspense>
    )
  }
  // eslint-disable-next-line jsx-a11y/alt-text
  return <RemotionImg src={src} style={{ display: 'block', ...style }} {...rest} />
}

/** Extra gap props accepted by egaki's Audio and Video wrappers. */
type GapProps = {
  /** Empty frames before the media starts playing. Delays playback start
   *  and adds to the section's auto-duration. In frames. */
  gapBefore?: number
  /** Empty frames after the media finishes. Adds to the section's
   *  auto-duration. In frames. */
  gapAfter?: number
  /**
   * Retime (speed up or slow down) the media to fit the available duration.
   *
   * - `true`: fit the current section's `durationInFrames`.
   * - `number`: fit that many frames exactly.
   *
   * The computed playbackRate replaces any explicit `playbackRate` prop.
   * When retiming, the component does NOT report its duration to the
   * section store (it conforms to the section, not the other way around).
   *
   * If the media is trimmed (`trimBefore`/`trimAfter`), only the trimmed
   * portion is retimed. `gapBefore`/`gapAfter` are subtracted from the
   * target so the media fills the remaining time.
   */
  retimeToFit?: boolean | number
}

type AudioProps = Omit<ComponentProps<typeof MediaAudio>, 'src'> & GapProps & {
  src?: string | Promise<string>
}

function ResolvedAudio({ srcPromise, ...rest }: { srcPromise: Promise<string> } & Omit<AudioProps, 'src'>) {
  const src = use(srcPromise)
  return <Audio src={src} {...rest} />
}

export function Audio(props: AudioProps) {
  const { gapBefore, gapAfter, retimeToFit, src, ...mediaProps } = props
  const container = useContext(LayoutContainerContext)
  const { fps, durationInFrames } = useVideoConfig()
  const instanceId = useId()
  const sectionIndex = useSectionIndex()

  // Skip duration reporting only for boolean true (circular dependency).
  // Numeric retimeToFit has an explicit target, so it can safely report.
  const skipReport = retimeToFit === true
  const skipFetch = container === 'ghost' || src instanceof Promise

  // Fetch raw duration and report effective duration (unless skipped)
  const rawDuration = useReportMediaDuration(
    { ...props, src: typeof src === 'string' ? src : undefined },
    skipFetch,
    skipReport,
  )

  // Compute retime rate from raw duration + section/explicit target.
  // Also works when both trimBefore/trimAfter are set (rawDuration not needed).
  const canComputeRate = rawDuration != null || (mediaProps.trimBefore != null && mediaProps.trimAfter != null)
  let retimeRate: number | undefined
  if (retimeToFit && canComputeRate) {
    const targetFrames = typeof retimeToFit === 'number' ? retimeToFit : durationInFrames
    const rate = computeRetimeRate({
      rawSeconds: rawDuration ?? undefined,
      fps,
      trimBefore: mediaProps.trimBefore,
      trimAfter: mediaProps.trimAfter,
      gapBefore,
      gapAfter,
      targetFrames,
    })
    if (rate != null) retimeRate = rate
  }

  // For numeric retimeToFit, report the target as effective duration
  // so auto-duration sections can resolve from it.
  if (typeof retimeToFit === 'number' && retimeToFit > 0) {
    reportSectionDuration(sectionIndex, instanceId, retimeToFit / fps)
  }

  if (container === 'ghost') return null

  if (src instanceof Promise) {
    return (
      <Suspense fallback={<ExportDelayFallback />}>
        <ResolvedAudio srcPromise={src} gapBefore={gapBefore} gapAfter={gapAfter} retimeToFit={retimeToFit} {...mediaProps} />
      </Suspense>
    )
  }

  // Apply computed retime rate, overriding any explicit playbackRate
  const finalProps = retimeRate != null
    ? { ...mediaProps, playbackRate: retimeRate }
    : mediaProps

  if (gapBefore) {
    return <Sequence from={gapBefore} layout="none"><MediaAudio src={src} {...finalProps} /></Sequence>
  }
  return <MediaAudio src={src} {...finalProps} />
}

type VideoProps = Omit<ComponentProps<typeof MediaVideo>, 'src'> & GapProps & {
  src?: string | Promise<string>
}

function ResolvedVideo({ srcPromise, ...rest }: { srcPromise: Promise<string> } & Omit<VideoProps, 'src'>) {
  const src = use(srcPromise)
  return <Video src={src} {...rest} />
}

export function Video(props: VideoProps) {
  const { gapBefore, gapAfter, retimeToFit, src, ...mediaProps } = props
  const container = useContext(LayoutContainerContext)
  const isExporting = useIsExporting()

  // Promise src: wrap in Suspense, resolve, then re-render with string src
  if (src instanceof Promise) {
    return (
      <Suspense fallback={<ExportDelayFallback />}>
        <ResolvedVideo srcPromise={src} gapBefore={gapBefore} gapAfter={gapAfter} retimeToFit={retimeToFit} {...mediaProps} />
      </Suspense>
    )
  }

  // Default to filling the container. Remotion's canvas renders at the
  // video's native resolution without explicit width/height, which causes
  // the video to appear tiny in flex layouts. safe-mdx also drops the
  // style prop when a component is passed as an expression prop (e.g.
  // background={<Video style={{...}} />}), so explicit user styles are
  // unreliable in MDX. Defaulting to 100% matches how users expect a
  // video to behave in a layout system. An explicit style prop overrides.
  const filledProps = {
    ...mediaProps,
    src,
    style: { width: '100%', height: '100%', ...mediaProps.style },
  }

  const wrapWithGap = (el: ReactNode) =>
    gapBefore ? <Sequence from={gapBefore} layout="none">{el}</Sequence> : el

  if (container === 'ghost') {
    return wrapWithGap(<div style={filledProps.style} />)
  }

  // During export, report duration but skip tweakpane UI
  if (isExporting) {
    return wrapWithGap(
      <VideoExportDuration {...filledProps} gapBefore={gapBefore} gapAfter={gapAfter} retimeToFit={retimeToFit} />,
    )
  }

  return wrapWithGap(
    <VideoWithTweakpane {...filledProps} gapBefore={gapBefore} gapAfter={gapAfter} retimeToFit={retimeToFit} />,
  )
}

/** Export mode: reports duration to section store, renders plain MediaVideo. */
function VideoExportDuration(props: ComponentProps<typeof MediaVideo> & GapProps & {
  retimeToFit?: boolean | number
}) {
  const { gapBefore, gapAfter, retimeToFit, ...mediaProps } = props
  const { fps, durationInFrames } = useVideoConfig()
  const instanceId = useId()
  const sectionIndex = useSectionIndex()
  const skipReport = retimeToFit === true

  const rawDuration = useReportMediaDuration(props, false, skipReport)

  // Compute retime rate from raw duration or trim bounds
  const canComputeRate = rawDuration != null || (mediaProps.trimBefore != null && mediaProps.trimAfter != null)
  let retimeRate: number | undefined
  if (retimeToFit && canComputeRate) {
    const targetFrames = typeof retimeToFit === 'number' ? retimeToFit : durationInFrames
    const rate = computeRetimeRate({
      rawSeconds: rawDuration ?? undefined, fps,
      trimBefore: mediaProps.trimBefore, trimAfter: mediaProps.trimAfter,
      gapBefore, gapAfter, targetFrames,
    })
    if (rate != null) retimeRate = rate
  }

  // For numeric retimeToFit, report the target as effective duration
  if (typeof retimeToFit === 'number' && retimeToFit > 0) {
    reportSectionDuration(sectionIndex, instanceId, retimeToFit / fps)
  }

  const finalProps = retimeRate != null ? { ...mediaProps, playbackRate: retimeRate } : mediaProps
  return <MediaVideo {...finalProps} />
}

/**
 * Loads the source video's duration via the shared hook, then delegates
 * to VideoTrimControls for tweakpane trim sliders. Until duration is known,
 * renders the video without trim controls.
 */
function VideoWithTweakpane(props: ComponentProps<typeof MediaVideo> & GapProps & {
  retimeToFit?: boolean | number
}) {
  const { retimeToFit } = props
  const skipReport = retimeToFit === true
  const rawDuration = useReportMediaDuration(props, false, skipReport)
  const { gapBefore, gapAfter, retimeToFit: _, ...mediaProps } = props

  if (rawDuration === null) {
    return <MediaVideo {...mediaProps} />
  }

  return <VideoTrimControls {...mediaProps} mediaDuration={rawDuration} retimeToFit={retimeToFit} gapBefore={gapBefore} gapAfter={gapAfter} />
}

/**
 * Registers tweakpane start/end sliders (in seconds) and converts
 * them to Remotion's trimBefore/trimAfter frame props. The folder label
 * is the video filename extracted from src.
 *
 * When the user drags a slider, the player pauses and seeks to the
 * corresponding frame so the user can see exactly where the cut lands.
 * Seeks are debounced to 50ms to avoid flooding the player during
 * continuous dragging.
 *
 * Section offset computation: this component lives inside a Remotion
 * Series.Sequence. useCurrentFrame() returns the frame relative to the
 * sequence, while egakiSDK.getCurrentFrame() returns the absolute
 * composition frame. The difference (absolute - relative) gives the
 * section's start frame in the composition, cached on first render.
 */
function VideoTrimControls(
  props: ComponentProps<typeof MediaVideo> & {
    mediaDuration: number
    retimeToFit?: boolean | number
    gapBefore?: number
    gapAfter?: number
  },
) {
  const { mediaDuration, retimeToFit, gapBefore, gapAfter, ...videoProps } = props
  const { fps, durationInFrames: sectionDuration } = useVideoConfig()
  const relativeFrame = useCurrentFrame()
  const instanceId = useId()
  const sectionIndex = useSectionIndex()

  // Compute the absolute frame offset of this section once on first render.
  // useCurrentFrame() = relative, egakiSDK.getCurrentFrame() = absolute.
  const sectionOffsetRef = useRef<number | null>(null)
  if (sectionOffsetRef.current === null) {
    try {
      const absoluteFrame = window.egakiSDK?.getCurrentFrame() ?? 0
      sectionOffsetRef.current = absoluteFrame - relativeFrame
    } catch {
      sectionOffsetRef.current = 0
    }
  }

  // Use the filename from src as the tweakpane folder label
  const src = typeof props.src === 'string' ? props.src : 'Video'
  const label = src.split('/').pop()?.split('?')[0] || 'Video'

  // Convert any existing trim props (in frames) to seconds for defaults
  const defaultStart = props.trimBefore != null ? props.trimBefore / fps : 0
  const defaultEnd = props.trimAfter != null ? props.trimAfter / fps : mediaDuration

  const tp = useTweakpane(label, {
    start: { value: defaultStart, min: 0, max: mediaDuration, step: 0.1 },
    end: { value: defaultEnd, min: 0, max: mediaDuration, step: 0.1 },
  })

  // Debounced seek: pause the player and seek to the trim point so the
  // user sees the exact frame they're cutting to. Debounce at 50ms so
  // continuous slider dragging doesn't flood the player with seeks.
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevTrimStartRef = useRef(tp.start)
  const prevTrimEndRef = useRef(tp.end)

  useEffect(() => {
    const sdk = window.egakiSDK
    if (!sdk) return

    const offset = sectionOffsetRef.current ?? 0
    let targetFrame: number | null = null

    if (tp.start !== prevTrimStartRef.current) {
      // start changed → seek to section start (where source shows start)
      targetFrame = offset
      prevTrimStartRef.current = tp.start
    } else if (tp.end !== prevTrimEndRef.current) {
      // end changed → seek to the section-relative frame where source
      // shows the end point: F = (end - start) * fps - 1
      // Seek away from the cut. Browser/media decoders are often
      // flaky at the exact final decodable frame of a trimmed range, and this
      // seek is only preview feedback; trimAfter itself remains exact.
      const endRelative = Math.round((tp.end - tp.start) * fps) - Math.round(fps * 0.25)
      targetFrame = offset + Math.max(0, Math.min(endRelative, sectionDuration - 1))
      prevTrimEndRef.current = tp.end
    }

    if (targetFrame === null) return

    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
    const frame = targetFrame
    seekTimerRef.current = setTimeout(() => {
      try {
        sdk.seekTo(Math.max(0, frame))
      } catch {
        // SDK not ready, ignore
      }
    }, 50)

    return () => {
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
    }
  }, [tp.start, tp.end, fps, sectionDuration])

  // Convert seconds back to frames for Remotion
  const trimBefore = tp.start > 0 ? Math.round(tp.start * fps) : undefined
  const trimAfter = tp.end < mediaDuration ? Math.round(tp.end * fps) : undefined

  // Compute retime rate from the FINAL tweakpane-resolved trim values.
  // This ensures dragging trim sliders recalculates the playback rate.
  let retimeRate: number | undefined
  if (retimeToFit) {
    const targetFrames = typeof retimeToFit === 'number' ? retimeToFit : sectionDuration
    const rate = computeRetimeRate({
      rawSeconds: mediaDuration, fps,
      trimBefore, trimAfter,
      gapBefore, gapAfter, targetFrames,
    })
    if (rate != null) retimeRate = rate
  }

  // For numeric retimeToFit, report the target as effective duration
  if (typeof retimeToFit === 'number' && retimeToFit > 0) {
    reportSectionDuration(sectionIndex, instanceId, retimeToFit / fps)
  }

  const finalProps = retimeRate != null
    ? { ...videoProps, playbackRate: retimeRate }
    : videoProps

  return <MediaVideo {...finalProps} trimBefore={trimBefore} trimAfter={trimAfter} />
}
