'use client'

/**
 * Client wrappers for server-generated media components.
 *
 * Each wrapper receives a `srcPromise: Promise<string>` from the server
 * component (streamed through RSC flight) and a `fallbackSrc` for the
 * stale file to show while generation is in progress. React 19's `use()`
 * suspends until the promise resolves, then renders the actual media
 * component. While suspended, the fallback (stale generation) renders if
 * available; otherwise nothing renders.
 *
 * Passthrough props are forwarded to the underlying media component so
 * users can set style, className, trimBefore, trimAfter, playbackRate, etc.
 *
 * Generation tracking: handled server-side via the /api/generation-progress
 * SSE stream. The server tracks all active generations across all scenes
 * and the client fetches progress updates to show in the toolbar.
 * The Suspense fallback only handles delayRender for export mode.
 */

import { Suspense, use, useLayoutEffect, type ComponentProps, type ReactNode } from 'react'
import { useDelayRender } from 'remotion'
import { Img, Audio, Video, useIsExporting } from './mdx-video.tsx'
import { useGenerationStatus, type GenerationStatus } from './store-hooks.ts'

export { useGenerationStatus, type GenerationStatus }

// ---------------------------------------------------------------------------
// Export-aware Suspense fallback — blocks Remotion frame capture while
// a generated media promise is still pending. Also registers/unregisters
// the generation in the tracker so the toolbar can show status.
// ---------------------------------------------------------------------------

/** Export-aware Suspense fallback — blocks Remotion frame capture while
 *  a generated media promise is still pending. Generation progress tracking
 *  is now handled server-side via the /api/generation-progress SSE stream,
 *  so this component only needs to handle delayRender for exports. */
function GeneratedMediaFallback({ children }: { children?: ReactNode }) {
  const isExporting = useIsExporting()
  const { delayRender, continueRender } = useDelayRender()

  // useLayoutEffect prevents a first-frame capture race: the delay handle
  // is registered before the browser paints, matching Remotion's own pattern.
  useLayoutEffect(() => {
    if (!isExporting) return
    const handle = delayRender('Waiting for generated media', {
      timeoutInMilliseconds: 10 * 60 * 1000,
    })
    return () => continueRender(handle)
  }, [isExporting, delayRender, continueRender])
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Inner components that call use() — must be inside <Suspense>
// ---------------------------------------------------------------------------

function ResolvedImage({ srcPromise, ...rest }: { srcPromise: Promise<string> } & ComponentProps<typeof Img>) {
  const src = use(srcPromise)
  return <Img src={src} {...rest} />
}

function ResolvedVideo({ srcPromise, ...rest }: { srcPromise: Promise<string> } & ComponentProps<typeof Video>) {
  const src = use(srcPromise)
  return <Video src={src} {...rest} />
}

function ResolvedAudio({ srcPromise, ...rest }: { srcPromise: Promise<string> } & ComponentProps<typeof Audio>) {
  const src = use(srcPromise)
  return (
    <>
      <span data-egaki-tts style={{ display: 'none' }} aria-hidden />
      <Audio src={src} {...rest} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Exported client wrappers — render fallback while promise is pending
// ---------------------------------------------------------------------------

export function GeneratedImageClient({
  srcPromise,
  fallbackSrc,
  ...rest
}: {
  srcPromise: Promise<string>
  fallbackSrc?: string
} & ComponentProps<typeof Img>) {
  return (
    <Suspense fallback={<GeneratedMediaFallback>{fallbackSrc ? <Img src={fallbackSrc} {...rest} /> : null}</GeneratedMediaFallback>}>
      <ResolvedImage srcPromise={srcPromise} {...rest} />
    </Suspense>
  )
}

export function GeneratedVideoClient({
  srcPromise,
  fallbackSrc,
  ...rest
}: {
  srcPromise: Promise<string>
  fallbackSrc?: string
} & ComponentProps<typeof Video>) {
  return (
    <Suspense fallback={<GeneratedMediaFallback>{fallbackSrc ? <Video src={fallbackSrc} {...rest} /> : null}</GeneratedMediaFallback>}>
      <ResolvedVideo srcPromise={srcPromise} {...rest} />
    </Suspense>
  )
}

export function GeneratedSpeechClient({
  srcPromise,
  fallbackSrc,
  ...rest
}: {
  srcPromise: Promise<string>
  fallbackSrc?: string
} & ComponentProps<typeof Audio>) {
  return (
    <Suspense fallback={<GeneratedMediaFallback>{fallbackSrc ? <Audio src={fallbackSrc} {...rest} /> : null}</GeneratedMediaFallback>}>
      <ResolvedAudio srcPromise={srcPromise} {...rest} />
    </Suspense>
  )
}
