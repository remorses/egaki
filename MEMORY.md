# Session Memory

## 2026-03-12

- Public Egaki gateway base should be `/v3/ai` for transparent proxying with
  current `@ai-sdk/gateway` behavior.
- For gateway image/video model requests, model ID is sent in `ai-model-id`
  (not only `ai-image-model-id` / `ai-video-model-id`). Keep legacy headers as fallback.
- Video requests can be classified reliably by endpoint path (`/video-model`) in addition
  to legacy headers.
- AI Gateway may reject video generation with `402 insufficient_funds` and a minimum
  balance requirement (observed: minimum $10) even when auth and routing are correct.
- For gateway request parsing, the source of truth is
  `opensrc/repos/github.com/vercel/ai/packages/gateway/src/gateway-*-model.ts`.
  Video body currently sends only: `prompt`, `n`, `aspectRatio`, `resolution`,
  `duration`, `fps`, `seed`, `providerOptions`, `image`.

## 2026-03-13

### Egaki Features Beyond Plain Remotion (Comprehensive Survey)

Explored entire codebase to identify non-trivial features. Found 25+ major features requiring custom infrastructure:

**Core pipeline:** MDX parsing (frontmatter, sections, durations, aspect ratio), client-side composition building, error recovery with last-good cache.

**Server-side:** RSC integration (app.tsx), Server components with flight streaming, auto-wrapping of generated media, import detection via identifier scanning.

**AI generation:** cachedGenerate HOF (deterministic keys, dedup, stale fallback, progress tracking), media caching (localStorage for raw src, per-section effective duration reports).

**Animation:** Layout transitions with FLIP (ghost measurement, no temporal state, coordinate mapping accounting for Player scale), animation primitives (Opacity, Scale, TranslateX, TranslateY, Blur — composable, all use Fill, enter/exit via startInFrames sign, cutInMotion for scene-boundary clipping), Jitter easing engine (polybezier, spring/bounce physics, 14 presets).

**Infrastructure:** Vite plugin managing 3 environments (client, rsc, ssr), virtual modules (virtual:egaki-mdx, virtual:egaki-modules, virtual:egaki-app), HMR with section-level diff detection and auto-seek.

**Dev tools:** Tweakpane integration (Pane singleton, folder registry, copy button with frame/section metadata), media duration auto-computation (mediabunny fetching, trim/playback-rate handling).

**Export:** Web-renderer with HTML-in-canvas, client-side rendering, export context detection (useIsExporting), agent SDK (window.egakiSDK with screenshot/export/seek/getElementPosition).

**State:** Zustand vanilla store (modules, section reports, generation progress), useSyncExternalStore pattern for external state.

**Special:** Framer Motion sync (patch JSAnimation for frame-based timing), Spiceflow RSC framework, Preamble content (before first heading, outside Series), MDX scope variables (FPS, BEAT), visual component library (remocn ports).

**Complexity:** 51 CLI source files, ~12,800 lines. No part copyable from plain Remotion—all requires custom infrastructure due to Remotion's lack of RSC, MDX parsing, composition-level abstractions.


## 2026-03-14

### Remotion Server-Side Renderer: Page Interface & Globals

Investigated how Remotion's headless Chrome renderer (packages/renderer/src/) communicates with a serveUrl. **KEY FINDING: No Webpack-specific requirements.** Any React+Remotion app (Vite, Webpack, etc.) works if it exposes the required window globals and functions.

#### Critical Globals the Page Must Expose

**Initialization (set by renderer before navigation via evaluateOnNewDocument):**
- `window.remotion_inputProps` - JSON string of input props
- `window.remotion_initialFrame` - starting frame number
- `window.remotion_attempt` - retry counter (1-based)
- `window.remotion_proxyPort` - media proxy port
- `window.remotion_audioEnabled` - boolean
- `window.remotion_videoEnabled` - boolean
- `window.remotion_logLevel` - 'info' | 'verbose' | 'warn' | 'error'
- `window.remotion_puppeteerTimeout` - timeout in ms (headless detection)
- `window.remotion_isMainTab` - boolean
- `window.remotion_mediaCacheSizeInBytes` - bytes | null
- `window.remotion_initialMemoryAvailable` - bytes | null
- `window.remotion_sampleRate` - audio sample rate
- `window.remotion_envVariables` - JSON string of env vars
- `window.remotion_broadcastChannel` - new BroadcastChannel("remotion-video-frame-extraction")

**Metadata/Version (must be present on page):**
- `window.siteVersion` - must equal '11' (string)
- `window.remotion_version` - Remotion version string

**Ready state (internal, managed by delayRender/continueRender):**
- `window.remotion_renderReady` - boolean, starts false
- `window.remotion_delayRenderTimeouts` - Map of handles to {label, timeout, startTime}
- `window.remotion_delayRenderHandles` - number[], array of active handles
- `window.remotion_cancelledError` - string | undefined, error stack if cancelled

#### Critical Functions the Page Must Expose

**Core rendering functions (must be present, called via page.evaluate):**

1. `window.getStaticCompositions()` → Promise<VideoConfigWithSerializedProps[]>
   - Returns list of all compositions with metadata
   - Used to verify it's a valid Remotion project (throws if undefined)
   - Evaluated during initial page setup (set-props-and-env.ts:222-232)

2. `window.remotion_calculateComposition(compId: string)` → Promise<CompositionMetadata>
   - Takes composition ID, returns resolved metadata for that composition
   - Called during selectComposition() (select-composition.ts:141)
   - Returns: {width, height, fps, durationInFrames, defaultCodec, serializedResolvedPropsWithCustomSchema, serializedDefaultPropsWithCustomSchema, etc.}

3. `window.remotion_setFrame(frame: number, composition: string, attempt: number)` → void
   - Synchronously updates the current frame for rendering
   - Called by seekToFrame() before rendering each frame (seek-to-frame.ts:206)
   - Args: frame number, composition ID, retry attempt counter
   - Must trigger React state update that propagates to useCurrentFrame() hook

4. `window.remotion_setBundleMode(state: BundleState)` → void
   - Sets evaluation mode: {type: 'evaluation'} for selectComposition, {type: 'composition', compositionName: string} for rendering
   - Called during setup (select-composition.ts:113-115)

#### Frame Navigation Flow

1. Renderer navigates to serveUrl via page.goto()
2. Renderer injects globals via evaluateOnNewDocument() (before page runs any script)
3. Renderer calls `window.getStaticCompositions()` to verify it's a Remotion project
4. Renderer calls `window.remotion_calculateComposition(compId)` to get metadata (width, height, fps, etc.)
5. For each frame to render:
   - Renderer calls `window.remotion_setFrame(frameNum, compId, attemptNum)`
   - Renderer waits for `window.remotion_renderReady === true` (managed by delayRender/continueRender)
   - Renderer calls page.screenshot() to capture the DOM as an image
   - Screenshot is encoded to PNG/JPEG/WebP
   - Frames are stitched into MP4 via FFmpeg

#### Ready State Mechanism

`delayRender(label?, options?)` → number:
- Returns a handle (random number)
- Sets `window.remotion_renderReady = false`
- If in headless mode, starts a timeout

`continueRender(handle)`:
- Removes the handle from `window.remotion_delayRenderHandles`
- When array becomes empty, sets `window.remotion_renderReady = true`

Renderer polls: `window.remotion_renderReady === true ? "ready" : false` (seek-to-frame.ts:72)

#### Version Verification

Renderer checks (set-props-and-env.ts:287-299):
- `window.siteVersion === '11'` (must match)
- `window.remotion_version` warning if different from renderer version

#### No Webpack Requirement

The renderer DOES NOT:
- Require Webpack-specific entry points
- Expect specific HTML structure (besides `<div id="video-container">`)
- Need special bundle metadata
- Require specific asset serving patterns

The renderer DOES:
- Call generic window functions that are React-managed
- Work with any bundler (Webpack, Vite, Esbuild, etc.)
- Require proper React state management (useCurrentFrame must respond to window.remotion_setFrame)

#### Implications for Vite-based Remotion

A Vite-served Remotion app CAN be used with the renderer if:
1. It exposes all required globals and functions
2. It properly implements useCurrentFrame() + state synchronization with window.remotion_setFrame()
3. It includes the required HTML structure (<div id="video-container">, delayRender infrastructure)
4. Version check passes (siteVersion = '11')

**Current egaki Remotion setup:** Uses Webpack bundler in /packages/bundler/. The index-html.ts template injects all required globals. This approach is framework-agnostic; Vite could replicate it in a Vite plugin.


### Remotion HTML Template & Complete Window Interface (Extracted from Source)

Analyzed bundler/src/index-html.ts, core/src/delay-render.ts, core/src/TimelineContext.tsx, renderer/src/seek-to-frame.ts, web-renderer/src/wait-for-ready.ts.

#### HTML Template Structure (bundler/src/index-html.ts, lines 59–161)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Remotion</title>
  </head>
  <body>
    <!-- Inline globals (BEFORE bundle.js loads) -->
    <script>window.remotion_numberOfAudioTags = {N};</script>
    <script>window.remotion_audioLatencyHint = "{category}";</script>
    <script>window.remotion_sampleRate = {sampleRate};</script>
    <script>window.remotion_previewSampleRate = {sampleRate};</script>
    <script>window.remotion_logLevel = "{logLevel}";</script> <!-- dev mode only -->
    <script>window.remotion_staticBase = "{staticHash}";</script>
    <script>window.remotion_editorName = "{editorName}" | null;</script>
    <script>window.remotion_projectName = {JSON string};</script>
    <script>window.remotion_publicPath = {JSON string};</script>
    <script>window.remotion_audioEnabled = true;</script>
    <script>window.remotion_videoEnabled = true;</script>
    <script>window.remotion_renderDefaults = {JSON};</script>
    <script>window.remotion_cwd = {JSON string};</script>
    <script>window.remotion_studioServerCommand = {string} | null;</script>
    <script>window.remotion_inputProps = {JSON string of stringified props};</script> <!-- optional -->
    <script>window.remotion_initialRenderQueue = {JSON};</script> <!-- optional -->
    <script>window.remotion_initialClientRenders = {JSON};</script> <!-- optional -->
    <script>window.process = {env: {JSON}};</script> <!-- env vars, optional -->
    <script>window.remotion_gitSource = {JSON};</script> <!-- optional -->
    <script>window.remotion_isStudio = true;</script> <!-- dev mode only -->
    <script>window.remotion_isReadOnlyStudio = false;</script> <!-- dev mode only -->
    <script>window.remotion_staticFiles = {JSON array};</script>
    <script>window.remotion_installedPackages = {JSON array};</script>
    <script>window.remotion_packageManager = {JSON string};</script>
    <script>window.remotion_publicFolderExists = {string} | null;</script>
    <script>
      window.siteVersion = '11';
      window.remotion_version = '{VERSION}';
    </script>

    <div id="video-container"></div>
    <div id="__remotion-studio-container"></div>
    <div id="menuportal-0"></div>
    <!-- ... menuportal-1 through menuportal-5 ... -->
    <div id="remotion-error-overlay"></div>
    <div id="server-disconnected-overlay"></div>
    <script src="{publicPath}bundle.js"></script>
  </body>
</html>
```

#### Complete Window Interface (All Globals & Functions)

**Studio/Config globals (injected by HTML template):**
- `window.siteVersion` = `'11'` (string, MUST match for renderer)
- `window.remotion_version` = version string
- `window.remotion_numberOfAudioTags` = number
- `window.remotion_audioLatencyHint` = AudioContextLatencyCategory string
- `window.remotion_sampleRate` = number | null
- `window.remotion_previewSampleRate` = number | null
- `window.remotion_logLevel` = 'info' | 'verbose' | 'warn' | 'error' (dev mode)
- `window.remotion_staticBase` = hash string
- `window.remotion_editorName` = string | null
- `window.remotion_projectName` = string
- `window.remotion_publicPath` = string (with trailing /)
- `window.remotion_audioEnabled` = true
- `window.remotion_videoEnabled` = true
- `window.remotion_renderDefaults` = RenderDefaults | undefined
- `window.remotion_cwd` = project root path
- `window.remotion_studioServerCommand` = string | null
- `window.remotion_inputProps` = JSON string (double-stringified, optional)
- `window.remotion_initialRenderQueue` = unknown | null
- `window.remotion_initialClientRenders` = unknown | null
- `window.process` = {env: {[key]: value}} (optional)
- `window.remotion_gitSource` = GitSource | null (optional)
- `window.remotion_isStudio` = true (dev mode only)
- `window.remotion_isReadOnlyStudio` = false (dev mode only)
- `window.remotion_staticFiles` = StaticFile[]
- `window.remotion_installedPackages` = string[] | null
- `window.remotion_packageManager` = 'npm' | 'pnpm' | 'bun' | 'yarn' | 'unknown'
- `window.remotion_publicFolderExists` = string | null

**Renderer-injected globals (via evaluateOnNewDocument in headless mode):**
- `window.remotion_inputProps` = JSON string (renderer overrides if headless)
- `window.remotion_initialFrame` = number (starting frame, 0-based)
- `window.remotion_attempt` = number (retry counter, 1-based)
- `window.remotion_proxyPort` = number (media proxy port in headless)
- `window.remotion_audioEnabled` = boolean
- `window.remotion_videoEnabled` = boolean
- `window.remotion_logLevel` = 'verbose' | 'warn' | 'error'
- `window.remotion_puppeteerTimeout` = number (timeout in ms)
- `window.remotion_isMainTab` = boolean
- `window.remotion_mediaCacheSizeInBytes` = number | null
- `window.remotion_initialMemoryAvailable` = number | null
- `window.remotion_sampleRate` = number (renderer overrides if headless)
- `window.remotion_envVariables` = JSON string of env vars (renderer overrides if headless)
- `window.remotion_broadcastChannel` = new BroadcastChannel("remotion-video-frame-extraction")

**Delay-render state (initialized by core/delay-render.ts on page load):**
- `window.remotion_renderReady` = false (initially), then true when all delayRender handles cleared
- `window.remotion_delayRenderTimeouts` = {} (map of handle → {label, timeout, startTime})
- `window.remotion_delayRenderHandles` = [] (array of active handles)
- `window.remotion_cancelledError` = undefined | string (error stack, set if render cancelled)

**Player state (set by TimelineContext, line 101):**
- `window.remotion_isPlayer` = false (in Webpack bundle)

**Runtime state (set by renderer during frame navigation):**
- `window.remotion_attempt` = number (updated before each setFrame call)

#### Required Functions

**Must be defined by the React/Remotion app:**

1. `window.getStaticCompositions()` → Promise<VideoConfigWithSerializedProps[]>
   - No args
   - Returns array of {name, width, height, fps, durationInFrames, ...}
   - Used to verify it's a valid Remotion project
   - Called during initial page setup (renderer/set-props-and-env.ts:222–232)

2. `window.remotion_calculateComposition(id: string)` → Promise<CompositionMetadata>
   - Arg: composition ID
   - Returns: {width, height, fps, durationInFrames, defaultCodec, serializedResolvedPropsWithCustomSchema, serializedDefaultPropsWithCustomSchema, ...}
   - Called to get metadata for a specific composition (renderer/select-composition.ts:141)

3. `window.remotion_setFrame(frame: number, composition: string, attempt: number)` → void
   - Args: frame (0-based), composition ID, retry attempt (1-based)
   - Synchronously updates React state (TimelineContext.tsx:73–99)
   - Must propagate to useCurrentFrame() hook
   - Called for each frame in rendering sequence (renderer/seek-to-frame.ts:206)
   - Internally calls delayRender() to block until async updates complete

4. `window.remotion_setBundleMode(state: BundleState)` → void
   - Arg: {type: 'evaluation'} | {type: 'composition', compositionName: string}
   - Sets evaluation context for composition metadata calculation
   - Called during setup (renderer/select-composition.ts:113–115)

#### Polling Loop (Renderer)

In headless mode, renderer calls waitForReady() after setFrame():

```javascript
// Evaluates this until true or timeout
window.remotion_renderReady === true ? "ready" : 
window.remotion_cancelledError !== undefined ? "cancelled" : 
false
```

See renderer/seek-to-frame.ts:72 and web-renderer/wait-for-ready.ts for polling logic.

#### Summary

**For Vite-based Remotion:** Need to inject the HTML template's globals and implement the 4 required functions. The renderer doesn't care about bundler; it only cares about these window APIs and the ready-state mechanism (delayRender/continueRender).

## 2026-03-15

### Remotion Premounting API & Implementation (Internal vs Public)

Searched Remotion source for premount detection mechanism. **FINDING: No public hook exists** — `useContext(SequenceContext)` is internal API.

**Public interface:**
- `<Sequence premountFor={frames}>` prop (v4.0.140+, default changes to `fps` in v5.0)
- `premountFor` also on `<Series.Sequence>` and `<TransitionSeries.Sequence>`
- `styleWhilePremounted` CSS override applied during premount window
- `postmountFor` equivalent for after sequence ends

**How it works internally (Sequence.tsx:446–517):**
1. When `premountFor > 0` and not rendering (`!env.isRendering`), `<Sequence>` renders `<PremountedPostmountedSequence>` wrapper
2. Wrapper reads `PremountContext.premountFramesRemaining` (internal context)
3. Computes `premountingActive = frame < from && frame >= from - premountFor`
4. If premounting active: wraps children in `<Freeze frame={from}>`, applies `opacity: 0` + `pointerEvents: none` + `styleWhilePremounted`
5. Inner `<Sequence>` receives `_remotionInternalIsPremounting={premountingActive}` (internal prop)
6. Inner sequence's `SequenceContext` value has `premounting: boolean` field (line 249 Sequence.tsx)

**To detect premount state in components:**
- **No public API exists.** SequenceContext is not exported from remotion/index.ts
- Internal pattern: `const seq = useContext(SequenceContext); if (seq?.premounting) { ... }`
- This is private API; Remotion devs discourage direct usage
- **Workaround for egaki:** Can conditionally disable `pauseWhenBuffering` / `pauseWhenLoading` by detecting `from` time vs `useCurrentFrame()`, or implement custom premount wrapper with exported context

**For components inside premounted sequence:**
- Media tags (`Html5Video`, `OffthreadVideo`, `Img`, `Html5Audio`) auto-detect premounting and skip triggering buffer state
- Does NOT work if using custom media loading logic
- Documented in /docs/player/buffer-state: media tags read SequenceContext.premounting internally (see AudioForPreview.tsx, VideoForPreview.tsx)

**Key files:** Sequence.tsx (446–517), SequenceContext.tsx (14), PremountContext.tsx (13), premounting docs at remotion.dev/docs/player/premounting

## 2026-03-16

### Chromium HTML-in-canvas API is unstable across builds

Chrome 152.0.7959 changed `texElementImage2D` to a 3-arg form `(target, sizedInternalformat, element)` requiring RGBA8/SRGB8_ALPHA8/RGBA16F/RGBA32F; Chrome 149-151 use the 6-arg form from Remotion docs. Feature-detect via `gl.texElementImage2D.length <= 3` (see angled-screen-shader.tsx). The same Chrome build also broke Remotion 4.0.494's nested-capture probe, so web-renderer exports of nested `<HtmlInCanvas>` use the DOM composer; egaki survives that path via mirror canvas + visibility:visible override + scoped useDelayRender (see angled-screen-shader.tsx header).

### remotion < 4.0.491 blocks WebGL in HtmlInCanvas onInit

Remotion 4.0.475 acquired a `2d` context on the offscreen canvas before calling onInit, making `getContext('webgl2')` return null. Fixed by 4.0.494 (2d only acquired in defaultOnPaint). Workspace pins remotion at 4.0.494 now.

### useTweakpane now follows live props unless user-overridden

Params return the live schema value every render (animated props like translateX={interpolate(...)} work); a key freezes to the pane value only after the user touches that control. Pane refreshes are guarded because tweakpane's refresh() emits change events.

### Remotion HtmlInCanvas delayRender scoping bug (through 4.0.495)

HtmlInCanvasContent calls global delayRender() (window scope) but continues via scoped useDelayRender(); web-renderer's scaffold waitForReady only polls its own delayRenderScope, so exports never wait for nested canvas paints. Also scaffold's visibility:hidden wrapper suppresses paint records, making captureElementImage throw (silently swallowed). Worth reporting upstream.

### delayRender + HtmlInCanvas paint can deadlock exports

Any delayRender handle released from an HtmlInCanvas onPaint callback hangs the export if the canvas sits under a visibility:hidden ancestor (Chromium creates no paint records for hidden subtrees, so paint never fires). LayoutTransition ghosts/inactive instances hide via visibility:hidden (deadlock); remotion premount hides via opacity:0 (safe, paint still fires). Gate handle registration on getComputedStyle(canvas).visibility — see angled-screen-shader.tsx.

### Browser testing: use plain playwriter in the user's Chrome

HTML-in-canvas works in Tommy's regular Chrome, which has the playwriter extension. Never launch a separate browser (--user-data-dir/--remote-debugging-port) and never use PLAYWRITER_DIRECT, because direct CDP mode causes relay conflicts and lost sessions. Plain `playwriter session new` is the correct flow (also documented in AGENTS.md).
