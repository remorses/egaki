## Always read the README first

Before creating a video, editing MDX, or using the CLI in any project folder,
read the README for all user-facing documentation:

```bash
curl -s https://raw.githubusercontent.com/remorses/egaki/main/README.md
```

The README covers all MDX video syntax, animation primitives, easing presets,
LayoutTransition, captions, voice cloning, media components, and CSS rules.
This AGENTS.md only contains internal development rules and architecture details.

## Deploying the website

The website deploys via Cloudflare Workers (wrangler), not Holocron deploy.
Run production deploys from the `website/` directory:

```bash
cd website && pnpm deploy:prod
```

`pnpm deploy` targets the isolated preview Worker. Never use `holocron deploy`
for this project.

## Strada observability

The gateway and website Workers initialize `@strada.sh/sdk` at module scope.
Any error caught and handled inline must call `captureException` with a
`route` or `handler` tag because top-level error handlers cannot see it.
Use `getLogger()` for structured logs instead of `console.error` or
`console.warn`, which only reach Cloudflare's platform logs.

## Code style

**Never use `textShadow`.** It looks bad in video. This applies to all components,
examples, and MDX content.

**Never scale scenes below 1.** The outer `<Scale>` wrapper on a scene must
always go from `1` to a larger value (e.g. `1` to `1.3`), never from a value
below 1 (e.g. `0.9` to `1.1`). When the scale is below 1, the composition
shrinks and exposes the black background behind it. Use `from={1} to={1.2}` or
`from={1} to={1.35}` for ambient zoom drift on scenes.

**Inline single-use values.** Do not extract constants for objects, numbers, strings, or
expressions that are only used once. Inline them at the usage site. Named constants should
only exist when the value is used in multiple places or when the name carries important
semantic meaning that the raw value does not convey. This applies to all egaki component
files, example recreations, and video templates.

**Import easings from egaki, never from Remotion.** `egaki/video` exports `cubicBezier()`,
`EASE` (preset curves at intensity 50), continuous preset functions like
`smoothEasing(intensity)`, `impulseOvershoot(intensity)`, and primitives like
`polybezier()`. **Always use `cubicBezier()` from `egaki/video` instead of
`Easing.bezier()` from `remotion`.** The egaki version attaches `BEZIER_POINTS`
metadata to the returned function, which lets the tweakpane bezier blade show and
edit the exact curve. `Easing.bezier()` returns an opaque function that the blade
cannot inspect, so curves created with it fall back to a default in the UI.

When a component needs `cubicBezier(0.5, 0, 0, 1)` that is `EASE.smooth`;
`cubicBezier(0.9, 0, 0, 1)` is `smoothEasing(100)`. Always check `EASE.*` and the
`*Easing(intensity)` functions before defining a local easing constant. Only define
a local curve when it is a project-specific Jitter extraction that has no matching
egaki preset.

## HMR-safe global state (server code only)

The Vite plugin explicitly invalidates RSC/SSR modules on user file changes
(`hotUpdate` in `vite-plugin.ts`), so server-side module-level state resets
mid-session. Any mutable state in server code (`app.tsx`, `server-components.tsx`,
files without `'use client'`) that must survive these invalidations must be
stored on `globalThis` with a `??=` initializer:

```ts
const generationQueue: Map<string, Promise<string>> =
  (globalThis as any).__egakiGenerationQueue ??= new Map()
```

Client-side code (`'use client'` files like `mdx-client.tsx`, `tweakpane-hook.tsx`,
`code-block.tsx`, etc.) does NOT need this pattern. React Fast Refresh patches
component functions in place without re-running module scope.

## `useSyncExternalStore` pattern

All three arguments (`subscribe`, `getSnapshot`, `getServerSnapshot`) must be
module-level constants, never inline closures. `getSnapshot` must return the
**same reference** when the derived value hasn't changed. Cache the last snapshot
at module level and shallow-compare before returning. See `cli/src/vite/store.ts`
for the canonical pattern.

## Conventions

**CLI framework:** Built with [goke](https://github.com/remorses/goke), a type-safe CLI
framework for TypeScript. Commands, options, and help text are defined in `cli/src/cli.ts`
using goke's API.

**Model discovery:** `egaki --help` shows commands and flags, but does **not** list
all valid model IDs. Use `egaki models --json` for exact model IDs.

**Always use egaki CLI for media tasks.** Never use raw `curl`, provider SDKs, or
system-installed tools (like local `demucs`, `whisper`, `ffmpeg`-based TTS) for tasks
that egaki already handles.

**Error handling:** This project uses [errore](https://errore.org). Functions return
`Error | T` unions instead of throwing. Check errors with `instanceof Error`.

**Do NOT wrap goke command action handlers in try/catch.** Goke catches errors inside
`.action()` callbacks. Use errore's return-based error handling instead.

## Vercel AI SDK image generation docs

Before making changes to image generation logic, read the relevant AI SDK docs.
Append `.md` to any URL below to get clean markdown as plain text.

- https://ai-sdk.dev/docs/ai-sdk-core/image-generation
- https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-image
- https://ai-sdk.dev/docs/reference/ai-sdk-core/wrap-image-model
- https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-no-image-generated-error
- https://ai-sdk.dev/docs/troubleshooting/high-memory-usage-with-images
- https://ai-sdk.dev/cookbook/guides/google-gemini-image-generation

## ChatGPT OAuth image generation

ChatGPT OAuth image generation in `egaki` mirrors the Codex backend flow, not
the normal OpenAI Image API. See `docs/chatgpt-codex-image-backend.md` before
changing this path.

Important Codex sources:

- https://github.com/openai/codex/blob/main/codex-rs/tools/src/tool_spec.rs
- https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs
- https://github.com/openai/codex/blob/main/codex-rs/core/tests/common/responses.rs

The key detail: ChatGPT-auth image requests go to
`https://chatgpt.com/backend-api/codex/responses` with the built-in
`image_generation` tool and user `input_image` content items for image-to-image.

## Egaki Gateway (Cloudflare Worker)

The `gateway/` directory contains a Cloudflare Worker that proxies AI requests
through the Vercel AI Gateway. It handles Stripe subscriptions, API key validation,
and dollar-based usage tracking.

**Model costs are derived from the catalog.** `gateway/src/plans.ts` imports
`CATALOG` from `cli/src/model-catalog.ts` directly. Wrangler's bundler resolves the
cross-directory import at build time, so there's no duplication. When you add or
update models in the catalog, the gateway picks up the costs automatically.

**Deploy:** `pnpm run deploy` targets preview; `pnpm run deploy:prod` targets production.

**Secrets are managed by Sigillo.** Both `gateway/` and `website/` are linked
to the single Sigillo `website` project. Package scripts inject `dev` secrets
with `sigillo run`; no `.env` or `.dev.vars` files should exist. Run
`pnpm secrets` inside either package to sync its `prod` secrets to Cloudflare.

Gateway secrets: `AI_GATEWAY_API_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `STRADA_TOKEN`.
Both packages sync the complete environment to their Cloudflare Worker.

## Vercel AI Gateway models endpoint

The AI Gateway exposes a public models catalog at:

```
GET https://ai-gateway.vercel.sh/v1/models
```

No auth required. Returns JSON with all available models, capabilities, and pricing.
Use this to discover new models and update `cli/src/model-catalog.ts`.

When updating model support in the CLI, always:

1. Check `https://ai-gateway.vercel.sh/v1/models` for new model IDs.
2. Add missing image-capable models to `cli/src/model-catalog.ts`.
3. If `/v1/models` lacks per-image pricing, source price from provider docs and
   record it manually in the catalog.

**Current limitation (as of Feb 2026):** Pure image models (`type: "image"`) return
`"input": "0", "output": "0"`. Per-image costs must be sourced manually from provider
pricing pages.

```bash
# Fetch all models
curl -s https://ai-gateway.vercel.sh/v1/models | jq '.'

# List all image-capable model IDs
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '.data[] | select(.tags | index("image-generation")) | "\(.id) (\(.type))"'

# List all video-capable model IDs
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '.data[] | select(.type == "video") | "\(.id) (\(.type)) tiers=\((.pricing.video_duration_pricing // []) | length)"'

# Inspect endpoint-level provider details for one model
curl -s https://ai-gateway.vercel.sh/v1/models/google/veo-3.1-generate-001/endpoints | jq '.'
```

## AI Gateway wire format source of truth

When parsing AI Gateway request payloads in `gateway/src/worker.ts`, do not guess
provider-specific fields. Use the `@ai-sdk/gateway` source code as the source of truth
for what gets sent over the wire.

```bash
npx opensrc @ai-sdk/gateway
```

Then read these files in `opensrc/repos/github.com/vercel/ai/packages/gateway/src/`:

- `gateway-video-model.ts` — exact request body for `/video-model`
- `gateway-image-model.ts` — exact request body for `/image-model`
- `gateway-language-model.ts` — exact request body/headers for `/language-model`
- `gateway-video-model.test.ts` — request/response examples

For video specifically, the current body fields are:
`prompt`, `n`, `aspectRatio`, `resolution`, `duration`, `fps`, `seed`, `providerOptions`, `image`.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

### Fetching Additional Source Code

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

## `<Server>` implementation internals

How it works internally:

- app.tsx finds `<Server>` nodes (`findServerNodes`) and **dynamically imports** exactly
  the modules referenced inside them (`collectServerImportSources` scans JSX names +
  expression identifiers inside `<Server>` subtrees and matches them against MDX import
  statements). There is no static rsc module map; paths resolve at request time.
- **Bare specifiers work**: app.tsx resolves them to file paths via
  `createRequire(projectRoot)`, then imports through the RSC module runner. Requires
  safe-mdx >= 1.11.2.
- Each node's children render server-side and become `serverSlots` keyed by the node's
  **start line**.
- The MDX string sent to the client has each `<Server>` block **blanked to `<Server />`
  with newline padding** (`blankServerContents`), preserving line counts for slot keys
  and sourcemaps.
- On the client, `Server` reads `ServerSlotsContext` and matches via `data-markdown-line`.
- Import statements are filtered **per-statement** to each environment's resolvable
  modules (`filterImportNodesToModules`).

Limitations:
- `<Server>` inside imported `.mdx` files is ignored (warns)
- Imported `.mdx` files inside `<Server>` are not supported
- Components reaching `<Server>` only through element variables are not detected

## Vite plugin internals

**Vite plugin** (`src/vite/vite-plugin.ts`): accepts `{ entry: './video.mdx' }`,
generates virtual modules for the MDX source, user imports (eager glob of all
`.tsx/.ts` in project root), and the Spiceflow app entry. Auto-injects
`spiceflowPlugin` and `@vitejs/plugin-react`.

**HMR**: entry MDX edits invalidate virtual modules and send `rsc:update`;
user `.tsx`/`.ts`/imported-`.mdx` edits stay in the client module graph.
Component files get React Fast Refresh, everything else propagates through
`virtual:egaki-modules` to `mdx-client.tsx` via `import.meta.hot.accept`.

**Components** (`components.tsx`): ported from [remocn](https://github.com/kapishdima/remocn).
Includes `BlurReveal`, `MaskedSlideReveal`, `StaggeredFadeUp`, `ShimmerSweep`.

## Predictable end position for entrance animations

When animating scale or translate as an **entrance effect**, interpolate from a
negative offset to 0 (or 1) instead of from 1 (or 0) to a target. The final
resting position is the natural layout position, making it trivial to match across
consecutive scenes or compose with other animations.

```tsx
const zoomIn = interpolate(frame, [0, 45], [1, 1.35], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: EASE.cinematic,
})
const drift = interpolate(frame, [0, 90], [-0.08, 0], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
})
const s = Math.round((zoomIn + drift) * 1000) / 1000
```

## LayoutTransition implementation

Implementation lives in `cli/src/vite/layout-transition.tsx` (`LayoutTransition`,
`LayoutTransitionProvider`, `LayoutGhost`, `LayoutAnimationLayer`) and
`cli/src/vite/player-page.tsx` (`SectionWithLayoutTransition`, ghost mounting).

**Seek-safe by design.** No temporal state is used. The previous section is
re-rendered in a hidden ghost container pinned at its last frame via Remotion
`<Freeze>`; the animation layer measures ghost vs visible positions every frame
and derives FLIP transforms from the current frame. Seeking always produces the
correct frame.

**Visual style interpolation.** During the transition, LayoutTransition interpolates:
- **Border radius**: counter-scaled by the projection delta
- **Background color**: RGB linear interpolation
- **Box shadow**: offsets and blur counter-scaled by FLIP scale factor
- **Opacity**: linear interpolation when source/target differ

**Constraints:**
- Wrapped child must be flow content (not full-frame `AbsoluteFill`)
- Ghost stays mounted for first 3 seconds (`GHOST_WINDOW_SECONDS`)
- Inactive intra-scene instances use `visibility: hidden` (keeps layout footprint)

## Client-side rendering internals

egaki renders via `@remotion/web-renderer` (WebCodecs, no FFmpeg) with
`allowHtmlInCanvas: true` (Chromium's `drawElementImage` API).

- **`getRemotionEnvironment().isRendering` does NOT work** with client-side
  rendering. Use `useIsExporting()` hook (reads `ExportContext`).
- HtmlInCanvas is **Chromium-only**. Single-threaded rendering.

<details>
<summary>Walk renderer CSS limitations (NOT applicable to egaki)</summary>

- `backdrop-filter`, `mix-blend-mode`, `background-blend-mode`
- `z-index`, `perspective`, `perspective-origin`, `transform-style`
- `text-decoration`, `writing-mode`, `object-position`
- `inset` box shadows and shadow spread radius
- `background-image` with anything other than `linear-gradient`
- `mask-image` with anything other than `linear-gradient`
- `clip-path: url()`, `filter: url()`, `corner-shape`
- Filters in Safari/WebKit
</details>

## Framer Motion implementation internals

### How it works

The Vite plugin checks for `motion-dom` in `node_modules` at `configResolved`.
When detected, `virtual:egaki-modules` gets a side-effect import for
`motion-timing.ts` prepended before user modules. This module deletes
`Element.prototype.animate` before Motion's memoized WAAPI support check runs,
sets `MotionGlobalConfig.useManualTiming`, patches `JSAnimation.prototype`
(`play`, `finish`, `stop`), and exposes `prepareTime(ms)`/`seekTo(ms)` on `globalThis`.

`MotionTimingSync` wraps each section and the preamble. It publishes the current
local section time via `useInsertionEffect()`, then calls `seekTo(ms)` from
`useLayoutEffect()`. Preamble and section animations share one registry without
resetting each other via scope IDs on DOM elements.

### Hard-won implementation lessons

- **Import motion timing before user modules.** WAAPI must be disabled before any
  Motion component creates animations.
- **`resolve.dedupe` for motion packages.** Always added (not gated by `hasMotion`).
- **`stop()` is a per-instance arrow function.** Must wrap per-instance inside `play()`.
- **`anim.sample(ms)` doesn't flush DOM.** Must call `owner.render()` after sampling.
- **`useLayoutEffect`, not render-time.** Motion creates animations during layout effects.
- **Prune stale animations.** `getLiveAnimations()` prunes on every seekTo call.
- **Stop driver in `finish()`.** Otherwise finished animations leak drivers.
- **Sample newly created animations relative to their scope.** Read nearest
  `data-egaki-motion-scope-id` ancestor on `play()`.

### Key files

| File | Role |
|---|---|
| `cli/src/vite/motion-timing.ts` | JSAnimation patching, animation registry, `seekTo()` |
| `cli/src/vite/mdx-video.tsx` | `MotionTimingSync` component |
| `cli/src/vite/vite-plugin.ts` | Detection, WAAPI script injection, conditional import |

### Zero overhead

If `motion` is not installed: no `<script>` injected, no `motion-timing.ts`
imported, `MotionTimingSync` is a passthrough. `motion-timing.ts` is excluded
from tsc (optional peer deps).

## Porting Framer shader components

Framer shader modules (`defineShader()` from `framer`) can be ported to egaki
using `defineShader()` from `cli/src/vite/shader-renderer.tsx`.

### Workflow

1. **Fetch the Framer module source.** URL looks like
   `https://framerusercontent.com/modules/.../ComponentName.js`.
2. **Create a new file** in `cli/src/vite/` with `'use client'` and the
   original URL as a comment.
3. **Extract the GLSL fragment body.** Store as `const FRAGMENT_SOURCE`.
4. **Map property controls to `defineShader` config.**

   | Framer ControlType | defineShader type | Tweakpane UI |
   |---|---|---|
   | `ControlType.Number` | `{ type: 'number', defaultValue, min, max, step }` | Slider |
   | `ControlType.Number` with `hidden: true` | Same + `hidden: true` | Props only |
   | `ControlType.Array` of `ControlType.Color` | `{ type: 'array', control: { type: 'color' }, maxCount, defaultValue }` | Color pickers |

5. **Export typed props interface** and the component.
6. **Wire into MDX built-ins** in `mdx-video.tsx`.
7. **Update the snapshot**: `cd cli && npx vitest run -u`.
8. **Create an example project** in `{name}-example/`.

### Rules

- All props must appear in tweakpane.
- Preserve original defaults exactly.
- No Framer dependency; use `defineShader()` from `shader-renderer.tsx`.
- Source URL in comments.
- Time is frame-based (`u_time = frame / fps`).
- `preserveDrawingBuffer: true` is already set.

Reference: `cli/src/vite/bands-shader.tsx`.

## `cachedGenerate` internals

**Config options:**
- `namespace` (required) — filesystem path and progress key
- `prefixFrom(params)` (required) — human-readable filename prefix
- `generate(params)` (required) — the actual work
- `serialize(result, params)` (required) — `{ bytes, extension }` or `{ json, extension: '.json' }`
- `cacheKey(params)` (optional) — extract cache-relevant subset
- `deserialize({ urlPath, filePath })` (optional) — defaults to `{ src: urlPath }`
- `modelFrom(params)` (optional) — model ID for progress display

**Features:**
- Auto cache key (Uint8Array values hashed to 8-char hex, undefined stripped)
- Namespace isolation: `public/generated/{namespace}/`
- Dedup: concurrent calls with same key return same promise
- Stale management: old files with same prefix but different hash move to `stale/`
- Progress tracking drives the player toolbar
- `.getCacheInfo(params)` for sync cache checks in RSC streaming
- Params must be JSON-serializable (no Date, Map, Set)

## Key files

| File | Role |
|---|---|
| `cli/src/cli/cached-generate.ts` | `cachedGenerate()` HOF, progress registry, `getCacheInfo()` |
| `cli/src/cli/cache-utils.ts` | Deterministic keys, file lookup, stale management, dedup queue |
| `cli/src/vite/vite-plugin.ts` | Vite plugin entry, virtual modules, HMR |
| `cli/src/vite/app.tsx` | Spiceflow RSC server: MDX string + `<Server>` slot rendering |
| `cli/src/vite/mdx-client.tsx` | Client MDX app: parsing, sections, safe-mdx rendering |
| `cli/src/vite/mdx-parse.ts` | Environment-agnostic section splitting and duration parsing |
| `cli/src/vite/server-mdx.ts` | `<Server>` parsing: slot extraction, blanking, import detection |
| `cli/src/vite/server-components.tsx` | Built-in server components (`egaki/text-to-speech`) |
| `cli/src/vite/mdx-video.tsx` | Client animation wrappers, easing presets, `MDX_BUILTIN_COMPONENTS`, `MotionTimingSync` |
| `cli/src/vite/layout-transition.tsx` | `LayoutTransition` FLIP animation system |
| `cli/src/vite/keyframes.tsx` | `keyframes()` evaluator, Lottie converters |
| `cli/src/vite/media-components.tsx` | Ghost-aware `Img`/`Audio`/`Video`, `ExportContext` |
| `cli/src/vite/components.tsx` | Visual components (remocn ports) |
| `cli/src/vite/player-page.tsx` | Client Player wrapper + export UI |
| `cli/src/vite/render-client.ts` | In-browser MP4 export via `@remotion/web-renderer` |
| `cli/src/vite/sdk.ts` | Agent SDK singleton (`window.egakiSDK`) |

## Testing the MDX video engine

After changes to parsing, rendering, `<Server>` slots, the Vite plugin, or
built-in MDX scope, run **both** unit tests and the integration example.

**Unit tests**:

```bash
cd cli && pnpm test
```

Main suite: `cli/src/vite/mdx-video.test.tsx`, `cli/src/vite/easing-curves.test.ts`.

**Example app + e2e**:

```bash
cd example-video && pnpm run test-e2e
```

Playwright starts Vite on port **5199**, runs `example-video/e2e/hmr.test.ts`
serially. Reuses an existing server on 5199 when not in CI.

## Browser testing: use the user's Canary via normal playwriter

The user's Chrome Canary is ALREADY fully set up: canvas-draw-element flag
enabled and the playwriter extension installed. To test AngledScreen,
HtmlInCanvas, exports, or anything else in the browser:

- Use plain `playwriter session new` and pick the Canary browser from the
  picker if multiple browsers are listed.
- NEVER launch a separate Canary instance with `--user-data-dir` /
  `--remote-debugging-port` / `--enable-blink-features`.
- NEVER use `PLAYWRITER_DIRECT` or `--direct` CDP mode. The extension flow
  is the correct path; direct mode causes relay conflicts and lost sessions.
- There is no missing Chrome flag to work around. Do not assume the flag is
  absent — it is enabled in the user's Canary.

## Agent SDK (`window.egakiSDK`)

The SDK singleton is mounted on `window.egakiSDK` when the player page loads.
Agents call it via Playwriter's `page.evaluate()`.

### Player controls

```js
playwriter -s 1 -e 'await state.page.evaluate(() => window.egakiSDK.seekTo(120))'
playwriter -s 1 -e 'console.log(await state.page.evaluate(() => window.egakiSDK.getCurrentFrame()))'
playwriter -s 1 -e 'await state.page.evaluate(() => window.egakiSDK.play())'
```

### Screenshot a frame

```js
playwriter -s 1 -e "$(cat <<'EOF'
const dataUrl = await state.page.evaluate(() => window.egakiSDK.screenshot({ frame: 60 }))
const buf = Buffer.from(await (await fetch(dataUrl)).arrayBuffer())
require("node:fs").writeFileSync("/tmp/frame-60.png", buf)
EOF
)"
```

### Export a video segment

```js
playwriter -s 1 -e 'await state.page.evaluate(() => window.egakiSDK.export({ frameRange: [0, 90], path: "clip.mp4" }))'
```

### Get composition info

```js
playwriter -s 1 -e 'console.log(await state.page.evaluate(() => window.egakiSDK.getInfo()))'
// { totalDuration, fps, width, height, sectionCount, sections, durationSeconds, currentFrame, isPlaying }
```

### Filmstrip

```js
playwriter -s 1 -e "$(cat <<'EOF'
const dataUrl = await state.page.evaluate(() =>
  window.egakiSDK.filmstrip({ scenes: [0, 1], framesPerScene: 2 })
)
const buf = Buffer.from(await (await fetch(dataUrl)).arrayBuffer())
require("node:fs").writeFileSync("/tmp/filmstrip.png", buf)
EOF
)"
```

### Get element position

```js
playwriter -s 1 -e "$(cat <<'EOF'
const pos = await state.page.evaluate(() => {
  window.egakiSDK.seekTo(0)
  return window.egakiSDK.getElementPosition(document.querySelector('.hero-logo'))
})
console.log(pos)
EOF
)"
```

### SDK methods summary

**Player controls** (synchronous):
`seekTo(frame)`, `getCurrentFrame()`, `play()`, `pause()`, `toggle()`, `isPlaying()`

**Element position** (synchronous):
`getElementPosition(element)` — maps DOM element to composition coordinates.

**Rendering** (async, returns data URL strings):
- `screenshot(options?)` — one frame
- `screenshotCurrentFrame(options?)` — current player frame
- `filmstrip(options)` — equidistant frames composited into grid
- `export(options?)` — video via `renderMediaOnWeb()`, optional download

**Info**: `getInfo()` — returns composition metadata and sections.

## Remotion resources

- **Remotion GitHub**: https://github.com/remotion-dev/remotion
- **Remotion docs**: https://www.remotion.dev/docs
- **Remotion LLM system prompt**: https://www.remotion.dev/llms.txt
- **AI code generation guide**: https://www.remotion.dev/docs/ai/generate

### Browser rendering (`@remotion/web-renderer`)

- **Overview**: https://www.remotion.dev/docs/client-side-rendering
- **`renderMediaOnWeb()` API**: https://www.remotion.dev/docs/web-renderer/render-media-on-web
- **HTML-in-canvas**: https://www.remotion.dev/docs/client-side-rendering/html-in-canvas
- **Progress tracker**: https://github.com/remotion-dev/remotion/issues/5913

To read the source:

```bash
bunx opensrc path remotion-dev/remotion
# then read from: packages/web-renderer/
```

## Docs

- **[Lottie to Remotion conversion](docs/lottie-to-remotion.md)**: keyframe/easing model,
  field mapping, overshoot, hold keyframes, conversion algorithm.

## Midjourney CDN URLs

Midjourney's CDN (`cdn.midjourney.com`) is behind Cloudflare bot protection.
`curl` and other non-browser HTTP clients receive a challenge page. Use the URL
directly as `src` in components; the browser can solve the challenge at runtime.

## MDX LSP autocomplete internals

The global `MDXProvidedComponents` type is declared in
`cli/src/vite/mdx-provided-components.ts` and derives from `MDX_BUILTIN_COMPONENTS`
in `mdx-video.tsx`, so adding a new component to the runtime map automatically
makes it available in the LSP.

`tsc` cannot check `.mdx` files. TypeScript plugins are editor-only.
A dedicated `@mdx-js/cli` is tracked at https://github.com/mdx-js/mdx-analyzer/issues/292.
