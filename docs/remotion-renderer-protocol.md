# Remotion Server-Side Renderer Protocol

**Date:** 2026-03-14  
**Status:** Verified against Remotion source code  
**Source:** packages/renderer/src/ and packages/studio/src/renderEntry.tsx

## Summary

Remotion's headless Chrome renderer (CLI render, video export) communicates with a served app via a well-defined protocol. The protocol is **framework-agnostic** — any web framework (Webpack, Vite, Esbuild, etc.) works if the served page exposes the required globals and functions.

**Key insight:** There is NO Webpack-specific coupling. The renderer treats the serveUrl as a black box and only cares about JavaScript functions on the window object.

## Frame Rendering Flow

```
browser.goto(serveUrl)
    ↓
evaluateOnNewDocument(globals setup)
    ↓ (page scripts run, call registerRoot() + Composition() + delayRender)
waitForReady() polls window.remotion_renderReady
    ↓
window.getStaticCompositions() → verify it's Remotion
    ↓
window.remotion_calculateComposition(compId) → get width/height/fps
    ↓
FOR EACH FRAME:
    window.remotion_setFrame(frame, compId, attempt)
    ↓
    waitForReady() waits for delayRender to clear
    ↓
    page.screenshot() → capture DOM as image
    ↓
    save image to file or memory
    ↓
ffmpeg stitches images → MP4
```

## Required Page Globals

The page must expose these at `window.*` scope. Renderer injects most globals before the page loads via `evaluateOnNewDocument()`.

### Initialization (Injected by Renderer)

Set before any page script runs. Use `evaluateOnNewDocument()` so page code can read these immediately.

```typescript
// Input props and composition state
window.remotion_inputProps: string          // JSON string of input props
window.remotion_initialFrame: number        // Starting frame (0 by default)
window.remotion_attempt: number             // Retry counter (1 on first try, 2+ on retries)

// Media configuration
window.remotion_audioEnabled: boolean       // Should <Audio> render
window.remotion_videoEnabled: boolean       // Should <Video> render
window.remotion_sampleRate: number          // Audio sample rate in Hz

// Rendering environment
window.remotion_proxyPort: number           // Port for media proxy
window.remotion_puppeteerTimeout: number    // Timeout in ms (used by delayRender defaults)
window.remotion_logLevel: string            // 'info' | 'verbose' | 'warn' | 'error'
window.remotion_isMainTab: boolean          // Whether this is the main rendering tab

// Memory management
window.remotion_mediaCacheSizeInBytes: number | null
window.remotion_initialMemoryAvailable: number | null

// Environment variables
window.remotion_envVariables: string        // JSON string of {key: value}

// BroadcastChannel for media extraction
window.remotion_broadcastChannel: BroadcastChannel
```

### Ready State (Managed by Page)

Initialized by page code (delay-render.ts). Renderer polls these to detect when a frame is ready to screenshot.

```typescript
// Frame readiness — renderer waits for this to be true
window.remotion_renderReady: boolean = false

// Delay/continue handles — managed by delayRender()/continueRender()
window.remotion_delayRenderHandles: number[] = []
window.remotion_delayRenderTimeouts: {
  [handle: number]: {
    label: string | null
    timeout: Timer
    startTime: number
  }
} = {}

// Error from cancelled render (if render was cancelled with cancelRender())
window.remotion_cancelledError: string | undefined
```

### Version/Metadata (On Page HTML)

These must be set on the page itself (typically in `<script>` tags in `<head>`). Renderer verifies version compatibility.

```typescript
window.siteVersion: string = '11'          // Required: must equal '11'
window.remotion_version: string            // e.g. '4.0.0' (for warnings)
```

## Required Functions

All functions must be callable via `page.evaluate(function)` from headless Chrome.

### 1. `window.getStaticCompositions()`

**Called:** During initial page setup to verify the site is a valid Remotion project.

**Signature:**
```typescript
getStaticCompositions(): Promise<VideoConfigWithSerializedProps[]>
```

**Returns:** Array of all compositions registered with `registerRoot()`.

**Example return shape:**
```typescript
[
  {
    id: "my-comp",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 150,
    defaultCodec: "h264",
    serializedResolvedPropsWithCustomSchema: "{...}",
    serializedDefaultPropsWithCustomSchema: "{...}",
    // ... other metadata
  },
  // ... more compositions
]
```

**Error handling:** If undefined, renderer throws error saying the site is not a valid Remotion project.

**Source:** `packages/studio/src/renderEntry.tsx:382-436`

### 2. `window.remotion_calculateComposition(compId)`

**Called:** Once for each unique composition to get its resolved metadata (after calculateMetadata() is evaluated).

**Signature:**
```typescript
remotion_calculateComposition(compId: string): Promise<{
  width: number
  height: number
  fps: number
  durationInFrames: number
  defaultCodec: string
  defaultOutName: string
  defaultVideoImageFormat: string
  defaultPixelFormat: string
  defaultProResProfile: string | null
  defaultSampleRate: number
  serializedResolvedPropsWithCustomSchema: string
  serializedDefaultPropsWithCustomSchema: string
}>
```

**Implementation notes:**
- Called with composition ID
- Must invoke `calculateMetadata()` if present on the composition
- Must resolve input props (merge defaults + passed props)
- Must return width/height/fps/duration + serialized props

**Example (from renderEntry.tsx):**
```typescript
window.remotion_calculateComposition = async (compId: string) => {
  const compositions = getUnevaluatedComps()
  const selectedComp = compositions.find(c => c.id === compId)
  
  // Call calculateMetadata() if present
  const resolved = await Internals.resolveVideoConfig({
    calculateMetadata: selectedComp.calculateMetadata,
    compositionDurationInFrames: selectedComp.durationInFrames,
    compositionFps: selectedComp.fps,
    // ... other fields
    inputProps: {...selectedComp.defaultProps, ...passedProps}
  })
  
  return {
    ...resolved,
    serializedResolvedPropsWithCustomSchema: JSON.stringify(resolved.props),
    serializedDefaultPropsWithCustomSchema: JSON.stringify(resolved.defaultProps)
  }
}
```

**Source:** `packages/studio/src/renderEntry.tsx:442-499`, called from `packages/renderer/src/select-composition.ts:141`

### 3. `window.remotion_setFrame(frame, compId, attempt)`

**Called:** Before rendering each frame. Must synchronously update React state so `useCurrentFrame()` returns the new frame.

**Signature:**
```typescript
remotion_setFrame(frame: number, composition: string, attempt: number): void
```

**Implementation notes:**
- Synchronous (not async)
- Must update React state or context for current frame
- Must trigger `useCurrentFrame()` to return the new frame
- `attempt` param is for retry tracking (used by delayRender timeouts)

**Example (from TimelineContext.tsx):**
```typescript
window.remotion_setFrame = (f: number, composition: string, attempt) => {
  window.remotion_attempt = attempt
  
  setFrame((s) => ({
    ...s,
    [composition]: f  // Store frame per composition
  }))
}
```

Then `useCurrentFrame()` hook reads:
```typescript
const context = useContext(TimelineContext)
return context.frameState[compositionId] ?? window.remotion_initialFrame
```

**Source:** `packages/core/src/TimelineContext.tsx`, called from `packages/renderer/src/seek-to-frame.ts:206`

### 4. `window.remotion_setBundleMode(state)`

**Called:** During setup to switch rendering modes.

**Signature:**
```typescript
remotion_setBundleMode(state: BundleState): void
// where BundleState = 
//   | {type: 'index'}
//   | {type: 'composition', compositionName: string}
//   | {type: 'evaluation'}
```

**Implementation notes:**
- Used internally to control which React component renders
- Not critical for external Vite usage, but should be a no-op

**Source:** `packages/studio/src/renderEntry.tsx:323-334`, called from `packages/renderer/src/select-composition.ts:113-115`

## Ready State Protocol

Remotion polls `window.remotion_renderReady` to detect when a frame is ready to screenshot.

### How It Works

1. **Page initializes:** `window.remotion_renderReady = false`

2. **Async work starts:** Component calls `delayRender(label)` → returns handle, sets `remotion_renderReady = false`

3. **Async work completes:** Component calls `continueRender(handle)` → removes handle from array

4. **Array becomes empty:** `remotion_renderReady = true`

5. **Renderer polls:** `window.remotion_renderReady === true ? "ready" : false`

### Implementation

In page code (typically injected by bundler or framework):

```typescript
// Initialize
window.remotion_renderReady = false
window.remotion_delayRenderTimeouts = {}
window.remotion_delayRenderHandles = []

// When starting async work
export const delayRender = (label?: string) => {
  const handle = Math.random()
  window.remotion_delayRenderHandles.push(handle)
  window.remotion_renderReady = false
  
  // Set timeout if in headless mode
  if (window.remotion_puppeteerTimeout) {
    window.remotion_delayRenderTimeouts[handle] = {
      label,
      timeout: setTimeout(() => {
        // Handle timeout
      }, window.remotion_puppeteerTimeout - 2000)
    }
  }
  
  return handle
}

// When async work completes
export const continueRender = (handle: number) => {
  window.remotion_delayRenderHandles = 
    window.remotion_delayRenderHandles.filter(h => h !== handle)
  
  if (window.remotion_delayRenderTimeouts[handle]) {
    clearTimeout(window.remotion_delayRenderTimeouts[handle].timeout)
    delete window.remotion_delayRenderTimeouts[handle]
  }
  
  // Ready when all handles cleared
  if (window.remotion_delayRenderHandles.length === 0) {
    window.remotion_renderReady = true
  }
}
```

**Source:** `packages/core/src/delay-render.ts:53-194`

## Version Verification

Renderer checks compatibility:

```typescript
// Must match exactly
if (window.siteVersion !== '11') {
  throw new Error(`Incompatible site version: ${window.siteVersion}. Required: '11'`)
}

// Warning if different (non-fatal)
if (window.remotion_version !== RENDERER_VERSION) {
  console.warn(`Version mismatch: bundled ${window.remotion_version}, renderer ${RENDERER_VERSION}`)
}
```

**Source:** `packages/renderer/src/set-props-and-env.ts:285-325`

## HTML Structure Requirements

Minimal required HTML structure:

```html
<!DOCTYPE html>
<html>
  <head>
    <script>
      window.siteVersion = '11'
      window.remotion_version = '4.0.0'
    </script>
  </head>
  <body>
    <div id="video-container"></div>
    <!-- React renders here -->
    <script src="/bundle.js"></script>
  </body>
</html>
```

## Vite Integration Example

A Vite-based Remotion app needs:

1. **HTML template** (`index.html`) injecting version globals
2. **Vite plugin** injecting the globals list via `evaluateOnNewDocument` when not in dev mode
3. **Remotion setup** with delayRender/continueRender, Composition(), registerRoot()
4. **State management** connecting `window.remotion_setFrame` to React's `useCurrentFrame()`

No webpack bundler needed. The protocol is framework-agnostic.

## Debugging Checklist

When building a custom Remotion integration:

- [ ] `window.getStaticCompositions()` is callable and returns composition list
- [ ] `window.siteVersion === '11'`
- [ ] `window.remotion_renderReady` starts false and becomes true after render
- [ ] `window.remotion_setFrame()` updates frame and triggers useCurrentFrame() change
- [ ] `window.remotion_calculateComposition()` returns full metadata with serialized props
- [ ] All `window.remotion_*` globals are set before page scripts run
- [ ] delayRender()/continueRender() properly manage `remotion_renderReady` state
- [ ] No errors in browser console during render (use window.remotion_logLevel for debugging)

## References

- Renderer entry: `packages/renderer/src/select-composition.ts`
- Frame navigation: `packages/renderer/src/seek-to-frame.ts`
- Setup: `packages/renderer/src/set-props-and-env.ts`
- Studio rendering: `packages/studio/src/renderEntry.tsx`
- Ready mechanism: `packages/core/src/delay-render.ts`
