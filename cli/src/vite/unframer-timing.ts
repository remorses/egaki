/**
 * Unframer timing integration for Remotion frame-based rendering.
 *
 * Same patches as motion-timing.ts but targeting unframer's bundled
 * framer-motion (JSAnimation, MotionGlobalConfig, frameData are separate
 * instances from motion-dom's). Shares the same global registry so
 * seekTo drives all animations in one pass.
 */

// @ts-expect-error unframer exports these from its bundled framer-motion but has no types for them
import { JSAnimation, MotionGlobalConfig, _injectRuntime, frameData, frameSteps, time, visualElementStore } from 'unframer'

if (typeof Element !== 'undefined') {
  // @ts-expect-error
  delete Element.prototype.animate
}

if (typeof IntersectionObserver !== 'undefined' && !(globalThis as any).__egakiUnframerIntersectionObserverPatched) {
  ;(globalThis as any).__egakiUnframerIntersectionObserverPatched = true
  const NativeIntersectionObserver = IntersectionObserver
  ;(globalThis as any).IntersectionObserver = class EgakiIntersectionObserver extends NativeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      super(callback, options)
      const nativeObserve = this.observe.bind(this)
      this.observe = (target: Element) => {
        nativeObserve(target)
        const rect = target.getBoundingClientRect()
        const viewport = {
          top: 0,
          left: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          width: window.innerWidth,
          height: window.innerHeight,
          x: 0,
          y: 0,
          toJSON() {},
        }
        const intersectionRect = {
          top: Math.max(rect.top, 0),
          left: Math.max(rect.left, 0),
          right: Math.min(rect.right, window.innerWidth),
          bottom: Math.min(rect.bottom, window.innerHeight),
          get width() { return Math.max(0, this.right - this.left) },
          get height() { return Math.max(0, this.bottom - this.top) },
          get x() { return this.left },
          get y() { return this.top },
          toJSON() {},
        }
        const isIntersecting = intersectionRect.width > 0 && intersectionRect.height > 0
        callback([
          {
            time: performance.now(),
            target,
            rootBounds: viewport,
            boundingClientRect: rect,
            intersectionRect: intersectionRect as DOMRectReadOnly,
            isIntersecting,
            intersectionRatio: isIntersecting && rect.width && rect.height
              ? (intersectionRect.width * intersectionRect.height) / (rect.width * rect.height)
              : 0,
          },
        ], this)
      }
    }
  }
}

function proxyAssetUrl(src: string) {
  try {
    const url = new URL(src)
    if (url.origin === window.location.origin) return src
    return `/__egaki_asset?url=${encodeURIComponent(src)}`
  } catch {
    return src
  }
}

function proxySrcSet(srcSet: string) {
  return srcSet.split(',').map((entry) => {
    const [src, ...rest] = entry.trim().split(/\s+/)
    return [src ? proxyAssetUrl(src) : src, ...rest].filter(Boolean).join(' ')
  }).join(', ')
}

_injectRuntime({
  useImageSource(image: { src?: string }) {
    return image.src ? proxyAssetUrl(image.src) : ''
  },
  useImageElement(image: { src?: string; srcSet?: string }) {
    const element = new Image()
    element.crossOrigin = 'anonymous'
    element.src = image.src ? proxyAssetUrl(image.src) : ''
    if (image.srcSet) element.srcset = proxySrcSet(image.srcSet)
    return element
  },
})

if (typeof document !== 'undefined' && !(globalThis as any).__egakiUnframerImageCrossOriginPatched) {
  ;(globalThis as any).__egakiUnframerImageCrossOriginPatched = true
  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  const srcSetDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'srcset')

  if (srcDescriptor?.set && srcDescriptor.get) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDescriptor.enumerable,
      get: srcDescriptor.get,
      set(value: string) {
        this.crossOrigin = 'anonymous'
        this.loading = 'eager'
        this.decoding = 'sync'
        srcDescriptor.set!.call(this, proxyAssetUrl(value))
      },
    })
  }

  if (srcSetDescriptor?.set && srcSetDescriptor.get) {
    Object.defineProperty(HTMLImageElement.prototype, 'srcset', {
      configurable: true,
      enumerable: srcSetDescriptor.enumerable,
      get: srcSetDescriptor.get,
      set(value: string) {
        this.crossOrigin = 'anonymous'
        this.loading = 'eager'
        this.decoding = 'sync'
        srcSetDescriptor.set!.call(this, proxySrcSet(value))
      },
    })
  }

  const nativeCreateElement = document.createElement.bind(document)
  document.createElement = function createElement(tagName: string, options?: ElementCreationOptions) {
    const element = nativeCreateElement(tagName, options)
    if (tagName.toLowerCase() === 'img') {
      ;(element as HTMLImageElement).crossOrigin = 'anonymous'
      ;(element as HTMLImageElement).loading = 'eager'
      ;(element as HTMLImageElement).decoding = 'sync'
    }
    return element
  } as typeof document.createElement
}

MotionGlobalConfig.useManualTiming = true

interface AnimInternal {
  state: string
  holdTime: number | null
  calculatedDuration: number
  driver?: { stop: () => void }
  options?: {
    motionValue?: { owner?: { current: Element | null; render?: () => void } }
    onComplete?: () => void
  }
  notifyFinished: () => void
  sample: (timeMs: number) => void
  stop: () => void
}

type AnimInstance = InstanceType<typeof JSAnimation> & AnimInternal

const registry: {
  allAnimations: Set<AnimInstance>
  unframerAnimations?: Set<AnimInstance>
  scopeIdMap?: WeakMap<AnimInstance, string>
  wrappedStops: WeakSet<AnimInstance>
  patchedUnframer?: boolean
  currentTimeMs: number | undefined
} = (globalThis.__egakiMotionRegistry ??= {
  allAnimations: new Set(),
  unframerAnimations: new Set(),
  scopeIdMap: new WeakMap(),
  wrappedStops: new WeakSet(),
  patchedUnframer: false,
  currentTimeMs: undefined,
})
registry.scopeIdMap ??= new WeakMap()
registry.unframerAnimations ??= new Set()

const { allAnimations, wrappedStops } = registry
const unframerAnimations = registry.unframerAnimations
const scopeIdMap = registry.scopeIdMap!

function unregister(anim: AnimInstance) {
  if (anim.driver?.stop) {
    anim.driver.stop()
    anim.driver = undefined
  }
  allAnimations.delete(anim)
  unframerAnimations.delete(anim)
  scopeIdMap.delete(anim)
}

function registerScope(anim: AnimInstance) {
  const element = anim.options?.motionValue?.owner?.current
  const scope = element?.closest?.('[data-egaki-motion-scope-id]')
  const scopeId = scope?.getAttribute('data-egaki-motion-scope-id')
  scopeIdMap.set(anim, scopeId ?? '')
}

function flushUnframerFrameSteps() {
  ;(frameData as { isProcessing: boolean }).isProcessing = true
  frameSteps.setup.process(frameData)
  frameSteps.read.process(frameData)
  frameSteps.resolveKeyframes.process(frameData)
  frameSteps.preUpdate.process(frameData)
  frameSteps.update.process(frameData)
  frameSteps.preRender.process(frameData)
  frameSteps.render.process(frameData)
  frameSteps.postRender.process(frameData)
  ;(frameData as { isProcessing: boolean }).isProcessing = false
}

function getLiveAnimations(): AnimInstance[] {
  const live: AnimInstance[] = []
  for (const anim of Array.from(allAnimations)) {
    const owner = anim.options?.motionValue?.owner
    if (owner && owner.current == null) {
      unregister(anim)
    } else {
      live.push(anim)
    }
  }
  return live
}

type VisualElementOwner = NonNullable<NonNullable<NonNullable<AnimInternal['options']>['motionValue']>['owner']>

function flushOwners(anims: AnimInstance[]) {
  const owners = new Set<VisualElementOwner>()
  for (const a of anims) {
    const owner = a.options?.motionValue?.owner
    if (owner && owner.current != null) owners.add(owner)
  }
  for (const o of owners) {
    o.render?.()
  }
}

function flushScopeVisualElements(scopeId: string) {
  if (typeof document === 'undefined' || !scopeId) return
  const scopes = Array.from(document.querySelectorAll('[data-egaki-motion-scope-id]'))
    .filter((el) => el.getAttribute('data-egaki-motion-scope-id') === scopeId)
  for (const scope of scopes) {
    const elements = [scope, ...Array.from(scope.querySelectorAll('*'))]
    for (const el of elements) {
      visualElementStore.get(el)?.render?.()
    }
  }
}

function flushAllVisualElements() {
  if (typeof document === 'undefined') return
  for (const el of Array.from(document.querySelectorAll('*'))) {
    visualElementStore.get(el)?.render?.()
  }
}

function sampleAnim(anim: AnimInstance, timeMs: number) {
  anim.sample(timeMs)
}

function isInScope(anim: AnimInstance, scopeId: string) {
  return (scopeIdMap.get(anim) ?? '') === scopeId
}

if (!registry.patchedUnframer) {
  registry.patchedUnframer = true

  const origPlay = JSAnimation.prototype.play
  JSAnimation.prototype.play = function (this: AnimInstance) {
    if (!allAnimations.has(this)) {
      allAnimations.add(this)
      registerScope(this)
    }
    unframerAnimations.add(this)
    if (!wrappedStops.has(this)) {
      wrappedStops.add(this)
      const origStop = this.stop
      const self = this
      this.stop = function () {
        allAnimations.delete(self)
        unframerAnimations.delete(self)
        scopeIdMap.delete(self)
        return origStop.call(self)
      }
    }
    const result = origPlay.call(this)
    if (typeof registry.currentTimeMs === 'number') {
      sampleAnim(this, registry.currentTimeMs)
      flushUnframerFrameSteps()
      flushOwners([this])
      flushAllVisualElements()
    }
    return result
  }

  const origFinish = JSAnimation.prototype.finish
  JSAnimation.prototype.finish = function (this: AnimInstance) {
    if (!this.calculatedDuration) {
      return origFinish.call(this)
    }
    this.state = 'finished'
    this.holdTime = this.calculatedDuration
    if (this.driver?.stop) {
      this.driver.stop()
      this.driver = undefined
    }
    this.options?.onComplete?.()
    this.notifyFinished()
  }
}

// Hook into prepareTime to also update unframer's manual clock.
// frameData.timestamp alone is not enough because unframer's time.now()
// caches the last value until time.set() is called.
const origPrepareTime = globalThis.__egakiMotionPrepareTime
globalThis.__egakiMotionPrepareTime = function prepareTime(absoluteMs: number) {
  origPrepareTime?.(absoluteMs)
  registry.currentTimeMs = absoluteMs
  time.set(absoluteMs)
  ;(frameData as { timestamp: number }).timestamp = absoluteMs
}

// Wrap seekTo (motion-timing.ts installs it first) to also sample
// unframer animations. If motion-timing.ts didn't run, install seekTo.
const origSeekTo = globalThis.__egakiMotionSeekTo
globalThis.__egakiMotionSeekTo = function seekTo(absoluteMs: number, scopeId = '') {
  // Let motion-timing's seekTo run first (updates motion-dom time/frameData,
  // samples motion-dom animations, flushes their owners)
  if (origSeekTo) {
    origSeekTo(absoluteMs, scopeId)
  } else {
    globalThis.__egakiMotionPrepareTime?.(absoluteMs)
  }
  // Now sample unframer animations and flush their owners
  const live = getLiveAnimations().filter((anim) => unframerAnimations.has(anim) && (!scopeId || isInScope(anim, scopeId)))
  const ownerless = getLiveAnimations().filter((anim) => unframerAnimations.has(anim) && !anim.options?.motionValue?.owner)
  for (let i = 0; i < ownerless.length; i++) {
    sampleAnim(ownerless[i]!, absoluteMs)
  }
  for (let i = 0; i < live.length; i++) {
    sampleAnim(live[i]!, absoluteMs)
  }
  flushUnframerFrameSteps()
  flushOwners(live)
  flushScopeVisualElements(scopeId)
}
