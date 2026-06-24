/**
 * Framer Motion (motion/react) integration for Remotion frame-based rendering.
 *
 * Patches JSAnimation.prototype to register animations in a global registry,
 * then exposes seekTo(ms) on globalThis for MotionTimingSync to call each frame.
 *
 * This file is imported as a side-effect from virtual:egaki-modules when the
 * user has `motion` installed. The Vite plugin gates the import at build time.
 * resolve.dedupe ensures motion-dom/motion-utils resolve to the same instance
 * that motion/react uses, so prototype patches apply to the right class.
 *
 * Hard-won lessons (see AGENTS.md "Framer Motion" section for full details):
 * - stop() is a per-instance arrow function, not on prototype. Wrap in play().
 * - anim.sample(ms) doesn't flush DOM. Must call owner.render() after sampling.
 * - useLayoutEffect, not render-time, for seekTo calls.
 * - Prune stale animations (owner.current === null) to prevent registry bloat.
 * - Stop driver in finish() to prevent resource leaks.
 * - Sample newly created animations at current seekTo time in play() patch.
 */

import { JSAnimation, time, frameData } from 'motion-dom'
import { MotionGlobalConfig } from 'motion-utils'

// Force JS animation path by deleting WAAPI. motion's memoized
// supportsWaapi() checks Object.hasOwnProperty.call(Element.prototype, "animate")
// on first call and caches the result. Deleting before any animation runs
// means the memoized result is permanently false.
if (typeof Element !== 'undefined') {
  // @ts-expect-error animate is non-optional on Element but we need to remove it
  delete Element.prototype.animate
}

MotionGlobalConfig.useManualTiming = true

// --- Internal type for JSAnimation private fields we access ---
// These are not part of motion-dom's public types but are stable internal
// properties needed for frame-based seeking.

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
  scopeIdMap?: WeakMap<AnimInstance, string>
  wrappedStops: WeakSet<AnimInstance>
  patched: boolean
  currentTimeMs: number | undefined
} = (globalThis.__egakiMotionRegistry ??= {
  allAnimations: new Set(),
  scopeIdMap: new WeakMap(),
  wrappedStops: new WeakSet(),
  patched: false,
  currentTimeMs: undefined,
})
registry.scopeIdMap ??= new WeakMap()

const { allAnimations, wrappedStops } = registry
const scopeIdMap = registry.scopeIdMap

// --- Helpers ---

function unregister(anim: AnimInstance) {
  if (anim.driver?.stop) {
    anim.driver.stop()
    anim.driver = undefined
  }
  allAnimations.delete(anim)
  scopeIdMap.delete(anim)
}

function registerScope(anim: AnimInstance) {
  const element = anim.options?.motionValue?.owner?.current
  const scope = element?.closest?.('[data-egaki-motion-scope-id]')
  const scopeId = scope?.getAttribute('data-egaki-motion-scope-id')
  scopeIdMap.set(anim, scopeId ?? '')
}

/** Return only animations whose VisualElement owner is still mounted.
 *  Prunes unmounted animations that accumulate as sections mount/unmount.
 *  Without this the registry grows to thousands and seekTo grinds to a halt. */
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

/** Flush VisualElement renders after sampling. sample() updates MotionValues
 *  but does NOT synchronously flush the render to DOM. Without this, styles
 *  stay stale until the next rAF (which never comes with useManualTiming). */
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

function sampleAnim(anim: AnimInstance, timeMs: number) {
  anim.sample(timeMs)
}

function isInScope(anim: AnimInstance, scopeId: string) {
  return (scopeIdMap.get(anim) ?? '') === scopeId
}

// --- Prototype patches (guarded against double-patching on HMR) ---

if (!registry.patched) {
  registry.patched = true

  const origPlay = JSAnimation.prototype.play
  JSAnimation.prototype.play = function (this: AnimInstance) {
    if (!allAnimations.has(this)) {
      allAnimations.add(this)
      registerScope(this)
    }
    // stop() is an arrow class field (per-instance, not on prototype).
    // Must wrap per-instance inside play() to intercept unmount cleanup.
    if (!wrappedStops.has(this)) {
      wrappedStops.add(this)
      const origStop = this.stop
      const self = this
      this.stop = function () {
        allAnimations.delete(self)
        scopeIdMap.delete(self)
        return origStop.call(self)
      }
    }
    const result = origPlay.call(this)
    // If seekTo has been called, immediately bring this new animation
    // to the current time so it doesn't flash its initial state.
    if (typeof registry.currentTimeMs === 'number') {
      sampleAnim(this, registry.currentTimeMs)
      flushOwners([this])
    }
    return result
  }

  // Patch finish(): hold at end instead of teardown so backward seeking
  // works. Also stops the driver to prevent resource leaks (the animation
  // stays seekable via sample() without a running driver).
  //
  // IMPORTANT: 0-duration animations (calculatedDuration === 0) must finish
  // normally via the original finish(). These are instant variant snaps
  // (initial→animate commits, layout property resets) that framer-motion's
  // VisualElement uses to flush final styles. Holding them prevents cleanup
  // of the internal active-animation queue, which blocks the VisualElement
  // from committing styles to DOM — causing subsequent sections to render
  // blank (all opacity/transform stuck at initial values).
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

// --- seekTo: synchronously update all live animations and flush DOM ---

globalThis.__egakiMotionPrepareTime = function prepareTime(absoluteMs: number) {
  registry.currentTimeMs = absoluteMs
  time.set(absoluteMs)
  ;(frameData as { timestamp: number }).timestamp = absoluteMs
}

globalThis.__egakiMotionSeekTo = function seekTo(absoluteMs: number, scopeId = '') {
  globalThis.__egakiMotionPrepareTime?.(absoluteMs)
  const live = getLiveAnimations().filter((anim) => isInScope(anim, scopeId))
  for (let i = 0; i < live.length; i++) {
    sampleAnim(live[i]!, absoluteMs)
  }
  flushOwners(live)
}
