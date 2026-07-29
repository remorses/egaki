<div align='center' class='hidden'>
    <br/>
    <br/>
    <h3>egaki</h3>
    <p>AI image and video generation from the terminal. MDX-to-video framework built on Remotion.</p>
    <br/>
    <br/>
</div>

`egaki` is a TypeScript CLI built on the Vercel AI SDK and goke. It supports
Google Imagen, Gemini image-capable models, video generation (Veo, Kling, Wan,
Bytedance Seedance, xAI Grok), and model discovery with pricing.

It also includes a **MDX-to-video framework** built on Remotion: write MDX with
headings as section boundaries, use built-in animation primitives, easing presets,
layout transitions, captions, and TTS. Export to MP4 directly in the browser.

## Install

```bash
pnpm add -g egaki
```

## Quick start

```bash
egaki login
egaki image "a watercolor fox reading a map" -o fox.png
egaki video "a paper boat drifting on a calm lake at sunrise" -o boat.mp4
```

### Quick start with ChatGPT auth

```bash
egaki login --provider chatgpt
egaki image "a dreamy studio ghibli style bakery at sunrise" -m gpt-image-1.5 -o bakery.png
egaki image "change the red jacket to a blue jacket" -m gpt-image-1.5 --input portrait.png -o portrait-blue.png
```

## CLI examples

### Generate an image from text

```bash
egaki image "cinematic mountain village at sunrise" -o village.png
egaki image "isometric floating city, detailed, soft colors" -m imagen-4.0-generate-001
```

### Edit with an input image

```bash
egaki image "add a red scarf and make it winter" --input portrait.jpg -o portrait-winter.png
egaki image "turn this into a manga panel" --input https://example.com/photo.jpg -o manga.png
egaki image "change the red square to a blue square" -m gpt-image-1.5 --input input.png -o output.png
```

### Inpainting with a mask

```bash
egaki image "replace the sky with dramatic storm clouds" --input landscape.png --mask mask.png -o storm.png
```

### Generate multiple images

```bash
egaki image "minimal logo concepts for a cat cafe" -n 4 -o logo.png
```

### Control composition

```bash
egaki image "cyberpunk alley at night" --aspect-ratio 16:9
egaki image "polaroid-style travel photo" --aspect-ratio 4:5
egaki image "wide landscape matte painting" -m gpt-image-1.5 --aspect-ratio 3:2 -o wide.png
```

### Use Google Cloud billing via Vertex AI

```bash
egaki login --provider vertex --key AIza...
egaki image "editorial sneaker photo on white seamless" -m vertex/imagen-4.0-generate-001 -o sneaker.png
egaki video "storm over mountains" -m vertex/veo-3.1-fast-generate-001 --duration 6 -o storm.mp4
```

### Pipe image output to other tools

```bash
egaki image "flat icon of a fox" --stdout | magick - -resize 512x512 fox-icon.png
```

---

### Generate a video from text

```bash
egaki video "a paper boat drifting on a calm lake at sunrise" -o boat.mp4
egaki video "timelapse of a stormy sea, cinematic" -m veo-3.1-generate-001 --duration 8 -o storm.mp4
```

### Generate with a cheap model

```bash
# Kling v2.5 Turbo — fast and inexpensive
egaki video "a cat walking on a rooftop at night" -m klingai/kling-v2.5-turbo-t2v --duration 5 -o cat.mp4
```

### Image-to-video

```bash
# Animate a still image (model must support i2v)
egaki video "slowly animate the clouds" --input photo.jpg -m klingai/kling-v2.6-i2v -o animated.mp4
```

### Control resolution and aspect ratio

```bash
egaki video "aerial drone shot over a city grid" \
  -m veo-3.1-fast-generate-001 \
  --aspect-ratio 16:9 \
  --resolution 1080p \
  --duration 6 \
  -o city.mp4
```

### Generate multiple videos

```bash
egaki video "waves crashing on cliffs at golden hour" -n 2 -o waves.mp4
# writes waves.mp4 and waves-1.mp4
```

### Pipe video output to other tools

```bash
egaki video "looping rain animation" --stdout | ffmpeg -i pipe:0 -vf fps=12 rain.gif
```

---

### xAI Grok image generation

```bash
# Basic text-to-image
egaki image "a fox wearing armor in a misty forest" -m grok-imagine-image -o fox.png

# High quality + 2K resolution
egaki image "product photo of a ceramic vase on linen" \
  -m grok-imagine-image-quality \
  --quality high \
  --resolution 2k \
  -o vase.png

# Edit an existing image
egaki image "add dramatic storm clouds to the sky" \
  -m grok-imagine-image \
  --input landscape.jpg \
  -o landscape-storm.png

# Generate multiple variations
egaki image "abstract geometric pattern" -m grok-imagine-image -n 3 -o pattern.png
# writes pattern-0.png, pattern-1.png, pattern-2.png

# Control aspect ratio and output format
egaki image "vertical phone wallpaper, aurora borealis" \
  -m grok-imagine-image \
  --aspect-ratio 9:16 \
  --output-format jpeg \
  -o wallpaper.jpg
```

### xAI Grok video generation

```bash
# Basic text-to-video
egaki video "a paper airplane gliding through clouds" \
  -m grok-imagine-video \
  --duration 5 \
  -o airplane.mp4

# Text-to-video with resolution and aspect ratio
egaki video "cinematic drone shot over a city at sunset" \
  -m grok-imagine-video \
  --duration 8 \
  --resolution 720p \
  --aspect-ratio 16:9 \
  -o city.mp4

# Image-to-video (animate a still image)
egaki video "slowly pan across the scene with gentle wind" \
  -m grok-imagine-video \
  --input photo.jpg \
  --duration 5 \
  -o animated.mp4

# Video editing (modify an existing video — pass the source via --input)
egaki video "make it look like a watercolor painting" \
  -m grok-imagine-video \
  --mode edit-video \
  --input ./original.mp4 \
  -o edited.mp4

# Video extension (continue from last frame)
egaki video "the camera keeps moving forward" \
  -m grok-imagine-video \
  --mode extend-video \
  --input ./clip.mp4 \
  -o extended.mp4

# Reference-to-video (R2V): generate a video guided by 1-7 reference images.
# The images act as style and content references (not as the first frame).
# Accepts local files or URLs; local files are uploaded automatically.
egaki video "the model walks down a white runway wearing the outfit from the reference" \
  -m grok-imagine-video \
  --mode reference-to-video \
  --reference-images ./model-face.jpg \
  --reference-images ./outfit.jpg \
  --duration 8 \
  -o runway.mp4

# Low-res draft for quick iteration
egaki video "test animation concept" \
  -m grok-imagine-video \
  --duration 3 \
  --resolution 480p \
  -o draft.mp4
```

### xAI Grok auth

```bash
# Option 1: direct API key
egaki login --provider xai --key xai-...

# Option 2: Grok Build subscription (browser OAuth)
egaki login --provider xai-oauth

# Check auth status
egaki login --show
```

---

### Discover models and pricing

```bash
egaki models
egaki models --type video
egaki models --type image
egaki models --provider google
egaki models --json
```

---

### Advanced image examples

```bash
# Deterministic result (models that support seed)
egaki image "studio product shot of a ceramic mug" \
  -m imagen-4.0-generate-001 \
  --seed 42 \
  -o mug-seed-42.png

# High quality Gemini image generation with 4K output
egaki image "architectural concept art, brutalist library interior" \
  -m gemini-2.5-flash-image \
  --image-size 4K \
  --aspect-ratio 16:9 \
  -o library-4k.png

# Multi-reference edit (pass --input multiple times)
egaki image "blend style from first image and color palette from second" \
  --input style-reference.jpg \
  --input palette-reference.jpg \
  -m nano-banana-pro-preview \
  -o hybrid-style.png

# JSON mode for automation/pipelines
egaki image "futuristic sneaker concept" \
  -m gpt-image-1.5 \
  --json \
  -o sneaker.png

# Batch generation with indexed output names
egaki image "mascot variations, flat vector look" \
  -m gpt-image-1-mini \
  -n 6 \
  -o mascot.png
# writes mascot-0.png ... mascot-5.png
```

## Model quick reference

### Image models

| Model ID | Best for | Example command |
| --- | --- | --- |
| `imagen-4.0-ultra-generate-001` | High-quality prompt-to-image with seed + ratio | `egaki image "luxury perfume ad on marble" -m imagen-4.0-ultra-generate-001 --aspect-ratio 3:4 --seed 7 -o perfume.png` |
| `gemini-3.1-flash-image-preview` | Fast, cheap text+image edits with wide aspect-ratio support | `egaki image "turn into manga splash page" -m gemini-3.1-flash-image-preview --input portrait.jpg --aspect-ratio 4:1 -o manga-wide.png` |
| `nano-banana-pro-preview` | Highest-fidelity Google text+image output | `egaki image "fashion editorial, dramatic rim light" -m nano-banana-pro-preview --input model.jpg --image-size 2K -o editorial.png` |
| `gpt-image-1.5` | OpenAI image generation with strong editing/inpainting | `egaki image "replace background with neon city" -m gpt-image-1.5 --input product.png --mask bg-mask.png -o product-neon.png` |
| `fal-ai/flux/schnell` | Very fast low-cost ideation batches | `egaki image "logo sketch, geometric fox" -m fal-ai/flux/schnell -n 8 -o fox-logo.png` |

### Video models

| Model ID | Best for | Example command |
| --- | --- | --- |
| `veo-3.1-generate-001` | Highest quality video with audio, up to 4K | `egaki video "rainy Tokyo street at night" -m veo-3.1-generate-001 --duration 8 -o tokyo.mp4` |
| `veo-3.1-fast-generate-001` | Fast Veo with 720p-4K, good for iteration | `egaki video "abstract paint patterns" -m veo-3.1-fast-generate-001 --duration 5 -o paint.mp4` |
| `vertex/veo-3.1-generate-001` | Same as above, routed through Vertex AI | `egaki video "rainy Tokyo street" -m vertex/veo-3.1-generate-001 --duration 8 -o tokyo.mp4` |
| `klingai/kling-v2.5-turbo-t2v` | Cheap, fast Kling text-to-video | `egaki video "a paper boat on a pond" -m klingai/kling-v2.5-turbo-t2v --duration 5 -o boat.mp4` |
| `bytedance/seedance-v1.5-pro` | Bytedance, audio support, three resolutions | `egaki video "timelapse of clouds above mountains" -m bytedance/seedance-v1.5-pro -o clouds.mp4` |
| `grok-imagine-video` | xAI video with editing, extension, R2V | `egaki video "a dog catching a frisbee" -m grok-imagine-video --duration 5 -o dog.mp4` |

## Feature support by model family

- **Google Imagen (`imagen-*`)**: supports `--seed`, `--aspect-ratio`, `--input`, `--mask`, `-n`
- **Google Gemini image models**: supports `--input`, `--aspect-ratio`, `--image-size`; usually no `--seed`
- **OpenAI image models**: strong editing and inpainting; size controls are model-specific
- **BFL image models (`flux-*`)**: Kontext/Pro variants via AI Gateway subscription
- **Recraft models (`recraft-*`)**: v2/v3/v4 families available via AI Gateway subscription
- **xAI image models (`grok-imagine-*`)**: `--quality`, `--resolution`, `--output-format`, `--input` for editing, `-n` for batches. Auth via API key or Grok Build OAuth
- **Vertex models (`vertex/*`)**: same models as Google AI Studio, routed through Vertex AI / Google Cloud billing
- **Google Veo video models**: up to 4K, audio optional, duration 4-8s
- **Kling video models**: mode (std/pro), audio on v2.6+, image-to-video support
- **Bytedance Seedance**: 480p-1080p, audio support on v1.5-pro
- **xAI Grok video (`grok-imagine-video`)**: 480p-720p, 1-15s, i2v, video editing, video extension, R2V from reference images

## Subscription and usage

egaki supports **both** authentication modes:

- **BYOK (bring your own keys):** add provider keys with `egaki login` per provider.
- **ChatGPT auth:** log in with `egaki login --provider chatgpt` to use the ChatGPT/Codex backend for supported OpenAI image generation and editing flows.
- **xAI Grok Build auth:** log in with `egaki login --provider xai-oauth` to use your Grok Build subscription for xAI image and video generation.
- **Egaki subscription:** use one `egaki_...` key to access all supported models without managing keys for each provider.
- **Google vs Vertex:** bare model IDs (e.g. `imagen-4.0-generate-001`) use Google AI Studio. Prefix with `vertex/` (e.g. `vertex/imagen-4.0-generate-001`) to route through Vertex AI / Google Cloud billing.

```bash
# Subscribe and get a checkout URL (plans: plus $29/mo, pro $99/mo)
egaki subscribe --email user@example.com --plan plus

# Subscribe without email prefill
egaki subscribe --plan pro

# Save your Egaki key after checkout
egaki login --provider egaki --key egaki_...

# BYOK examples (direct provider keys)
egaki login --provider google --key AIza...
egaki login --provider vertex --key AIza...

# ChatGPT OAuth for Codex-backed image generation/editing
egaki login --provider chatgpt
egaki image "turn this product shot into a clay render" -m gpt-image-1.5 --input product.png -o product-clay.png

# Check subscription usage / cancel
egaki usage
egaki unsubscribe
```

## CLI commands

| Command | What it does |
|---|---|
| `egaki dev` | Zero-config MDX video dev server (just pass an .mdx file) |
| `egaki image` | Generate/edit images (Imagen, Gemini, GPT, Fal, xAI) |
| `egaki video` | Generate videos (Veo, Kling, Wan, Seedance, xAI) |
| `egaki speech` | Text-to-speech (OpenAI, ElevenLabs, Cartesia) |
| `egaki demucs` | Stem separation via fal.ai (no local torch needed) |
| `egaki bpm` | Detect BPM of audio (local, no API needed) |
| `egaki loudness` | Measure perceived loudness in LUFS (local, no API needed) |
| `egaki voice clone` | Clone a voice from audio (Cartesia, ElevenLabs) |
| `egaki transcribe` | Speech-to-text (OpenAI, ElevenLabs, Deepgram, Groq, Cartesia) |
| `egaki models` | List available models with pricing |

Audio workflow example:

```bash
# 1. Separate vocals from a song
egaki demucs song.mp3 --stems vocals -o stems/

# 2. Clone the voice from the isolated vocals
egaki voice clone stems/song-vocals.mp3 --name "Singer" --json

# 3. Generate TTS with the cloned voice
egaki speech "Your text here." --voice <voice-id> -m sonic-3.5 -o output.mp3

# 4. Transcribe audio to get word timestamps
egaki transcribe recording.mp3 -m whisper-1

# 5. Detect BPM for beat-synced videos
egaki bpm soundtrack.mp3 --json
```

## BPM detection

Detect the tempo of any audio file locally. No API call, runs in milliseconds.

```bash
egaki bpm song.mp3
# BPM: 120
# Interval: 0.500s

egaki bpm track.wav --json
# { "bpm": 120, "intervalInSeconds": 0.5 }

# Pipe from ffmpeg
ffmpeg -i video.mp4 -f mp3 - | egaki bpm --stdin
```

Use the detected BPM in your MDX video frontmatter to lock scene cuts to the beat:

```mdx
---
fps: 30
bpm: 129
---

<Audio src="/soundtrack.mp3" />

# Verse duration=8beats
```

BPM detection requires `node-web-audio-api` (optional dependency). If missing,
the command tells you how to install it:

```bash
pnpm add node-web-audio-api
```

## Loudness measurement

Measure perceived loudness in LUFS using K-weighting and two-pass gating
inspired by EBU R128. Useful for checking if your audio matches platform
targets before compositing.

```bash
egaki loudness narration.mp3
# Integrated: -14.2 LUFS
# Max: -8.1 LUFS
# Min: -28.4 LUFS
# Range: 20.3 LU

egaki loudness track.wav --json
```

Common targets: YouTube/Spotify -14 LUFS, Apple Music -16 LUFS, podcasts -16 to -18 LUFS.

Same `node-web-audio-api` optional dependency as BPM detection.

## Help

```bash
egaki --help
egaki image --help
egaki video --help
egaki models --help
```

## Auth and billing

- `egaki login` stores provider keys in `~/.config/egaki/credentials.json`.
- `egaki subscribe`, `egaki usage`, and `egaki unsubscribe` manage Egaki plans.
- Video costs are tracked per-second based on model, resolution, and duration.

---

# MDX Video Framework

Write MDX with headings as section boundaries; each heading becomes a timed
Remotion `Series.Sequence`. Frontmatter sets global `fps` and `bpm`. Export
to MP4 directly in the browser via WebCodecs.

## Getting started

The fastest way is **zero setup**: point `egaki dev` at an `.mdx` file. No
package.json, vite.config.ts, or npm install needed — react, remotion, and
vite all come from the egaki CLI's own installation.

```bash
egaki dev video.mdx          # serve one file, random free port
egaki dev                    # serve current dir (auto-discovers video.mdx)
egaki dev intro.mdx --port 5199 --open
```

`egaki dev` creates a small `node_modules` in the folder containing symlinks
into the CLI's install (marked with a `.egaki-shim` file, safe to delete).
This also makes editor TypeScript resolution work in the scratch folder.

Create `video.mdx`:

```mdx
---
fps: 30
bpm: 120
---

# Intro duration=3s

<TranslateX from={-140} to={0} duration={0.5 * FPS}>
  <div style={{ fontSize: 72, fontWeight: 900, color: 'white' }}>
    Hello World
  </div>
</TranslateX>

# Outro duration=2s

<Opacity from={1} to={0} duration={0.5 * FPS} startInFrames={-0.5 * FPS}>
  <div style={{ fontSize: 48, color: 'white' }}>Goodbye</div>
</Opacity>
```

Run `egaki dev video.mdx` and open the printed URL to see the player with
controls and export.

### Full project setup (optional)

For a real project with its own dependency versions, create a package and a
vite config instead:

```bash
mkdir my-video && cd my-video
pnpm init
pnpm add egaki remotion @remotion/media react react-dom vite
```

Create `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { video } from 'egaki/vite'

export default defineConfig({
  plugins: [video({ entry: './video.mdx' })],
})
```

Run `vite` (or a `dev` script) and open the browser.

## How it works

```
MDX file
  │
  ▼
app.tsx (server, Spiceflow RSC)
  └── passes the raw MDX source string to the client via RSC flight
        │
        ▼
mdx-client.tsx ('use client', runs in the browser)
  ├── safe-mdx parses AST, resolves user imports
  ├── splits into MdxSection[] by headings, parses durations
  ├── renders each section to JSX (client-side React)
  └── renders PlayerPage with the sections
        │
        ▼
player-page.tsx (client)
  ├── wraps sections in Remotion <Series> / <Series.Sequence>
  ├── renders interactive <Player> with controls
  └── "Export MP4" button ► @remotion/web-renderer (WebCodecs, in-browser)
```

MDX renders fully on the client. Expression props can be functions
(`easing={x => x}`), and user `.tsx` components don't need a `'use client'`
directive.

## Sections and duration

Each `#` heading creates a new section. Set duration with a unit suffix:

| Unit | Example | Meaning |
|---|---|---|
| `s` | `duration=3.5s` | Seconds (multiplied by fps) |
| `beats` / `beat` | `duration=8beats` | Beats (using frontmatter `bpm`) |
| `frames` / `frame` / `f` | `duration=90frames` | Raw frames |
| *(bare number)* | `duration=90` | Raw frames |

```mdx
---
fps: 30
bpm: 120
---

# Intro duration=3s

# Verse duration=8beats

# Bridge duration=90frames

# Outro duration=2s
```

Heading durations are parsed from raw text, **not** MDX expressions.
`duration={33 * BEAT}` does not work; use `duration=33beats` instead.

### Auto-duration from media

When a heading does **not** set an explicit `duration`, the section uses the
maximum duration of any `<Audio>` or `<Video>` element inside it (including
positive `startInFrames` offset). The longest media wins. If no media is
present and no duration is set, the section falls back to a default frame count.

**Pitfall:** if you want a section's duration to match a short audio clip,
never place a long-running video or full-length soundtrack `<Audio>` inside
that section. Place long-running media in the **preamble** (before the first
heading) so it plays across all sections without affecting any section's
auto-duration.

## `FPS` and `BEAT` scope variables

MDX expressions have access to `FPS` and `BEAT` as global scope variables,
derived from frontmatter `fps` and `bpm`. No import needed.

- **`FPS`** = frames per second (default 30). Use to convert seconds to frames.
- **`BEAT`** = frames per beat, computed as `fps / (bpm / 60)`. At 120bpm/30fps = 15 frames.

```mdx
---
fps: 30
bpm: 120
---

# Intro duration=2s

<TranslateX from={-140} to={0} duration={0.5 * FPS} startInFrames={0.3 * FPS}>
  <div style={{ fontSize: 72, color: 'white' }}>Hello</div>
</TranslateX>

# Verse duration={8 * BEAT}

<Opacity from={0} to={1} duration={2 * BEAT}>
  Content appears over 2 beats
</Opacity>
```

**Always use `FPS` instead of raw frame numbers.** Raw frame literals like
`duration={20}` break when the export fps changes (e.g. 30fps preview vs
60fps final render). This applies to `duration`, `startInFrames`, and any
frame-based value.

```mdx
<!-- correct -->
<TranslateX from={-140} to={0} duration={0.5 * FPS} cutInMotion={0.1}>

<!-- wrong, breaks at different fps -->
<TranslateX from={-140} to={0} duration={15}>
```

### Beat-synced music

Align the beat grid to the actual track: detect the track's BPM with
`egaki bpm`, find the time of its **first downbeat**, then trim so the
downbeat lands on frame 0.

```bash
egaki bpm music.mp3 --json
# { "bpm": 129.2, "intervalInSeconds": 0.464 }
```

```mdx
---
fps: 30
bpm: 129.2
---

{/* First downbeat at 0.372s → trim 11 frames so the grid starts on a beat. */}
<Audio src="/music.mp3" trimBefore={11} volume={0.5} />
```

To tighten pacing without breaking beat sync, raise the frontmatter `bpm`
and speed the music up to match:

```mdx
---
bpm: 140
---

<Audio src="/music.mp3" trimBefore={11} playbackRate={140 / 129.2} />
```

Scene cuts stay locked to the musical beat while every scene gets shorter.

## Preamble

Content **before the first `#` heading** is the **preamble**. It renders at
the Remotion composition level, outside the `<Series>` that sequences sections.
Preamble content persists across all sections for the entire video duration, and
renders in the background behind section content.

Use the preamble for:
- **Soundtracks**: `<Audio src="/music.mp3" />` plays for the full video
- **Ambient background video**: `<Video src="/bg.mp4" />` loops behind all sections
- **Global background**: a `<Background>` with a shader or static color
- **Persistent overlays**: watermarks, logos

```mdx
---
fps: 30
bpm: 120
---

<Audio src="/soundtrack.mp3" />
<Video src="/ambient-bg.mp4" objectFit="cover" />

# First Section duration=5s

This content appears on top of the ambient background video.
```

## Animation primitives

Built-in components available in MDX without imports: `Opacity`, `Scale`,
`TranslateX`, `TranslateY`, `Blur`. Each animates one CSS property from
`from` to `to` over `duration` frames.

**Enter vs exit** is inferred from `startInFrames`: positive or zero = enter
(offset from section start), negative = exit (offset from section end).

```mdx
# Scene duration=3s

<!-- Enter: slide in from left over 0.5s -->
<TranslateX from={-140} to={0} duration={0.5 * FPS}>
  <div style={{ fontSize: 72, fontWeight: 900, color: 'white' }}>Title</div>
</TranslateX>

<!-- Exit: fade out over last 0.5s of the section -->
<Opacity from={1} to={0} duration={0.5 * FPS} startInFrames={-0.5 * FPS}>
  <div style={{ color: 'white' }}>Subtitle</div>
</Opacity>
```

### `inline` prop

By default, primitives use `<Fill>` wrapper (full-frame AbsoluteFill). Pass
`inline` to wrap in a plain `<div>` instead, so the element stays in flow
layout (flex, grid, etc.).

Use `inline` when animating elements **inside** a layout (cards, list items,
flex children). Nest multiple `inline` primitives to compose animations:

```tsx
<Scale from={0.8} to={1} duration={30} easing={impulseOvershoot(71)} inline>
  <Opacity from={0} to={0.5} duration={20} easing={(t) => t} inline>
    <div style={{ width: 100 }}>Content</div>
  </Opacity>
</Scale>
```

**Never use `%` widths/heights on children of `inline` primitives.** The
`inline` wrapper has no intrinsic size, so percentage values resolve to 0.
Use `px` or `em` instead.

### Sequential animations

When an element has two animations at different times (e.g. a shrink-in
followed by a pulse), nest two wrappers. Each applies independently:

```tsx
<Scale from={1.7} to={1} duration={msToFrame(1490, fps)} easing={EASE.smooth} inline>
  <Scale from={1} to={1.1} duration={msToFrame(3572 - 1632, fps)}
         startInFrames={msToFrame(1632, fps)} easing={impulseOvershoot(96)} inline>
    <div style={{ width: '38%', aspectRatio: '675 / 392' }}>Card</div>
  </Scale>
</Scale>
```

### `style` prop for layout

The `style` prop on `inline` primitives is essential for flex/grid
participation. Use it to set dimensions, overflow, border-radius:

```tsx
<Scale from={0} to={1} duration={24} easing={EASE.smooth} inline
  style={{ width: '100%', height: '100%', borderRadius: '20%', overflow: 'hidden' }}>
  <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
</Scale>
```

### `cutInMotion`

Use `cutInMotion` (0-1) to clip the animation at the scene boundary for
conveyor-belt transitions. The scene cuts while text is still in motion, and
the next scene's text appears already mid-slide.

Pattern:
- **First scene**: enter with no `cutInMotion`, exit with `cutInMotion={0.3}`
- **Middle scenes**: enter with `cutInMotion={0.1}`, exit with `cutInMotion={0.2}`
- **Last scene**: exit with small `cutInMotion={0.1}`

```mdx
# First Scene duration=3s
<TranslateX from={-140} to={0} duration={0.7 * FPS}>
  <TranslateX from={0} to={140} duration={0.7 * FPS} startInFrames={-0.7 * FPS} cutInMotion={0.3}>
    <div style={{ fontSize: 72, fontWeight: 900, color: 'white' }}>Title</div>
  </TranslateX>
</TranslateX>

# Middle Scene duration=3s
<TranslateX from={-140} to={0} duration={0.5 * FPS} cutInMotion={0.1}>
  <TranslateX from={0} to={140} duration={0.6 * FPS} startInFrames={-0.6 * FPS} cutInMotion={0.2}>
    <div style={{ fontSize: 72, fontWeight: 900, color: 'white' }}>Title</div>
  </TranslateX>
</TranslateX>
```

See `example-cut-in-motion/` and `example-shader/` for working demos.

### Composing enter and exit moves

Combine primitives for entrances and exits with real presence: a scene-level
`Scale` for the camera push, plus `TranslateY`/`TranslateX` for the element
move. Enter animations should end at the natural position (`to={0}` or
`to={1}`) so the resting frame is predictable.

```mdx
# Hook duration=8beats

<Scale from={1} to={1.5} duration={8 * BEAT}>
<Background>
  <WaveGradientShader style={{ width: '100%', height: '100%' }} />
</Background>

<TranslateY from={80} to={0} duration={0.6 * FPS}>
  <TranslateY from={0} to={-80} duration={0.5 * FPS} startInFrames={-0.5 * FPS} cutInMotion={0.3}>
    <div style={{ fontSize: 92, color: 'white' }}>Title</div>
  </TranslateY>
</TranslateY>
</Scale>
```

**Go big.** Subtle values read as accidental drift; large values read as
intentional motion. Prefer `Scale from={1} to={1.5}` over `1.05`, translate
distances of 80-260px over 10-20px, and pair them with short durations
(0.4-0.7s) and strong easings. Reserve subtle magnitudes (+0.05 scale) for
ambient drift layered under the main move, not for the move itself.

### Typewriter text

Reveal text character by character, synced to the voiceover's word
timestamps (see "Syncing animations to word timestamps"). Two details make
it look right:

- **Lay out the full text invisibly** and reveal characters on top, so
  centered lines never shift while typing.
- **Render the caret absolutely positioned** (zero width) so it never
  wraps lines or pushes layout.

```tsx
function Typewriter({ words, fontSize }: { words: { text: string; startSec: number; endSec: number }[]; fontSize: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  return (
    <div style={{ position: 'relative', fontSize, color: 'white', textAlign: 'center' }}>
      {/* ghost copy keeps the layout stable */}
      <span style={{ visibility: 'hidden' }}>{words.map((w) => w.text).join(' ')}</span>
      <span style={{ position: 'absolute', inset: 0 }}>
        {words.map((w, i) => {
          const chars = w.text.length
          const shown = t < w.startSec ? 0 : t >= w.endSec ? chars
            : Math.ceil(((t - w.startSec) / (w.endSec - w.startSec)) * chars)
          return <span key={i}>{w.text.slice(0, shown)}{i < words.length - 1 && shown === chars ? ' ' : ''}</span>
        })}
        <span style={{ position: 'absolute', width: 0 }}>|</span>
      </span>
    </div>
  )
}
```

## `<Fill>`

A full-frame layer like Remotion's `AbsoluteFill` but with better defaults
for video content. Children **stretch horizontally** to fill the frame and
**center vertically**. Available in MDX without imports. Accepts `style` to
override alignment. Prefer `<Fill>` over raw `<AbsoluteFill>`.

## `<AngledScreen>`

WebGL 3D screen with **true depth-of-field**. Children DOM is captured per
frame (HTML-in-canvas) and rendered as a perspective-tilted plane in a
fragment shader: parts of the plane further from the camera get progressively
more bokeh blur, plus fog toward `backgroundColor` and subtle film grain.
Available in MDX without imports:

```mdx
# Hero duration=5s

<AngledScreen rotateX={9} rotateY={-17} translateZ={120} backgroundColor="#0a0608">
  <Img src="/screenshot.png" style={{ width: '100%', borderRadius: 14 }} />
</AngledScreen>
```

Depth of field uses the exact **Three.js BokehShader** algorithm with the same
defaults as the original plugin, so the cinematic look is on by default: blur
grows linearly with distance from the focus plane and saturates at `maxBlur`,
sampled with a 41-tap ring kernel in screen space (plane edges melt into the
background where out of focus).

Props: `perspective` (camera distance px, default 1200), `rotateX`/`rotateY`/`rotateZ`
(degrees, CSS semantics), `translateX` (px horizontal shift), `translateZ` (px
toward camera), `bokeh` (default true),
`aperture` (shallower DOF with bigger values, default 0.5), `maxBlur` (blur
saturation cap in screen-UV units, default 0.12), `focus` (focus distance as a
fraction of `perspective`; default 0 = auto: near side sharp, blur ramps
progressively from mid-image to the far edge), `fog` (fade to
background with depth, default 0.35), `grainIntensity` (default 0.02),
`chromaticAberration` (radial R/B split, stronger in the bokeh, default 0.45),
`backgroundColor`, `width`/`height` (content wrapper size, default `80%`/`auto`),
`debug` (grayscale depth view). All props are editable live in the tweakpane panel.

Bokeh uses a **sparse 6-blade hexagonal iris** (13 weighted taps) so the aperture
shape reads as hard disks instead of a smooth gaussian. Raise
`chromaticAberration` for purple/cyan fringing like a real lens.

The defaults need no tuning: the near half stays sharp and only the far side
melts. Raise `aperture` for an earlier, heavier falloff, or set an explicit
`focus` to place the sharp plane manually (Three.js BokehPass semantics).

Requires Chrome 149+ with `chrome://flags/#canvas-draw-element` enabled.
When unsupported it falls back automatically to `BasicAngledScreen`, the
**deprecated** CSS-only predecessor (same transform props, directional
`backdrop-filter` blur instead of true depth-of-field). Don't use it
directly in new videos; the fallback is automatic.

## Easing presets

Import from `egaki/video`. **Always use `cubicBezier()` from `egaki/video`
instead of `Easing.bezier()` from `remotion`**, because the egaki version
attaches metadata that lets the tweakpane UI show and edit the curve.

### `springFromDuration` and `dspring`

Use these instead of raw `spring({ config: { damping, stiffness, mass } })`.

```tsx
import { spring } from 'remotion'
import { springFromDuration, dspring, EASE } from 'egaki/video'

// springFromDuration returns a config object for Remotion's spring()
const scale = spring({ frame, fps, config: springFromDuration(0.5, 0.3) })

// dspring is the shorthand that calls spring() internally
const opacity = dspring(frame, fps, 0.6, 0.25)  // 600ms, subtle bounce
const pop = dspring(frame, fps, 0.4)              // 400ms, no bounce
```

**`bounce` parameter**: 0 = no overshoot, 0.25 = subtle Apple-like, 0.5 = playful, 1 = maximum bounce.

### `EASE` presets

```tsx
import { EASE, smoothEasing, bounceEasing } from 'egaki/video'
import { interpolate } from 'remotion'

const x = interpolate(frame, [0, 60], [0, 500], {
  easing: EASE.smooth,
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
})
```

**Bezier presets** (clean curves, no overshoot):
`smooth`, `natural`, `decelerate`, `accelerate`

**Spring/bounce presets** (values can exceed 0-1):
`elasticSnap`, `bounce`, `bounceAnticipate`, `bounceThrow`, `overshoot`,
`overshootElastic`, `overshootBouncy`, `decelerateOvershoot`, `decelerateElastic`,
`naturalThrow`, `accelerateImpulse`, `accelerateElastic`, `impulseSlow`,
`impulseOvershoot`

### Continuous intensity functions

Each preset also has a continuous function that takes any intensity 0-100:

```tsx
import { overshoot, naturalThrow } from 'egaki/video'

const scale = interpolate(frame, [0, 30], [0, 1], {
  easing: overshoot(63),
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
})
```

All 14 presets: `naturalThrow`, `decelerateOvershoot`, `decelerateElastic`,
`accelerateImpulse`, `accelerateElastic`, `elasticSnap`, `bounce`,
`bounceAnticipate`, `bounceThrow`, `impulseSlow`, `impulseOvershoot`,
`overshoot`, `overshootElastic`, `overshootBouncy`.

### Curve engine primitives

For building custom curves:

```tsx
import { cubicBezier, polybezier, pathPreset } from 'egaki/video'

// Analytic cubic-bezier y(x) solver
const ease = cubicBezier(0.5, 0, 0, 1)

// Multi-segment curve from control points
const throwCurve = polybezier([
  { x: 0, y: 0, upper: 0.7 },
  { x: 0.33, y: -0.2, lower: 0.8, upper: 0.8 },
  { x: 0.67, y: 1.3, lower: 0.1, upper: 0.1 },
  { x: 1, y: 1, lower: 0.8 },
])

// Intensity-parameterized preset
const myPreset = pathPreset({
  0: [
    { x: 0, y: 0, upper: 0 },
    { x: 0.4, y: 1.05, lower: 0.8, upper: 0.2 },
    { x: 1, y: 1, lower: 0.7 },
  ],
  100: [
    { x: 0, y: 0, upper: 0 },
    { x: 0.15, y: 1.8, lower: 0.8, upper: 0.1 },
    { x: 1, y: 1, lower: 0.8 },
  ],
})
const easing = myPreset(35)
```

## LayoutTransition

`<LayoutTransition id="x">` makes an element animate from its position in the
previous section to its new position in the current section. Matching is by
`id`.

```mdx
# Scene 1 duration=3s

<LayoutTransition id="title">**Hello**</LayoutTransition>

# Scene 2 duration=3s

<LayoutTransition id="title" duration={25} bounce={0.2}>**Hello**</LayoutTransition>
<LayoutTransition id="subtitle">**World**</LayoutTransition>
```

**Props**: `id` (required), `duration` (frames, default 20), `bounce`
(spring bounce 0-1, default 0.15), `easing` (custom easing function,
overrides `bounce`), `mode` (`'both' | 'position' | 'size'`, default `'both'`).

During the transition, `LayoutTransition` automatically interpolates border
radius, background color, box shadow, and opacity between old and new elements.

### Intra-scene transitions with `showFrom` / `showUpTo`

`LayoutTransition` also works **within a single section**. Use `showFrom` and
`showUpTo` props (frame numbers) to create time-windowed instances of the same
`id`. Only one instance is visible at a time; the element FLIP-animates between
them.

```mdx
# Active Item duration=6s

<div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <LayoutTransition id="dot" showFrom={0} showUpTo={2 * FPS} duration={18} bounce={0.2}>
      <Dot />
    </LayoutTransition>
    <span>First item</span>
  </div>
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <LayoutTransition id="dot" showFrom={2 * FPS} showUpTo={4 * FPS} duration={18} bounce={0.2}>
      <Dot />
    </LayoutTransition>
    <span>Second item</span>
  </div>
</div>
```

Demo: `example-layout-transition/` project.

## `<Server>` component slots

`<Server>` is a **reserved MDX element** marking a subtree as React Server
Components. Its children render server-side (async allowed, fs/API access)
and get spliced into the client tree as a slot.

```mdx
import { AsyncStats } from './async-stats'
import { TextToSpeech } from 'egaki/text-to-speech'

# Analytics duration=6s

<Opacity from={0} to={1} duration={15}>
  <Server>
    <AsyncStats />
    <TextToSpeech text="Analytics that build themselves." />
  </Server>
</Opacity>
```

Rules:
- Files referenced inside `<Server>` execute in the RSC env. **`*.server.{ts,tsx}`
  files** are excluded from the client bundle automatically.
- Each `<Server>` must start on its **own line**.
- Inside `<Server>` normal RSC rules apply: no function props into client refs,
  no Remotion hooks (built-ins like `Opacity` work as client refs).
- Bare specifiers work (`import { TextToSpeech } from 'egaki/text-to-speech'`).

## Generated media in `.server.tsx` files

`GeneratedImage`, `GeneratedVideo`, and `GeneratedSpeech` can be used inside
`.server.tsx` files for type-safe composition with custom logic.

**Import from `egaki/generate-media`** (not `egaki/video`). The `egaki/video`
exports are client stubs that return `null`.

```tsx
// hero-scene.server.tsx
import { GeneratedImage } from 'egaki/generate-media'
import { Opacity, Fill } from 'egaki/video'

export async function HeroScene() {
  return (
    <Fill>
      <Opacity from={0} to={1} duration={20}>
        <GeneratedImage
          prompt="a magical forest with glowing mushrooms"
          seed={99}
          model="imagen-4.0-generate-001"
          style={{ width: '80%', margin: 'auto', borderRadius: 16 }}
        />
      </Opacity>
    </Fill>
  )
}
```

```mdx
import { HeroScene } from './hero-scene.server'

# Scene duration=5s

<HeroScene />
```

Components imported from `.server.*` files are **automatically wrapped in
`<Server>`** by the MDX parser. No manual `<Server>` block needed.

See `generated-media-example/` for a working demo.

## Media components

`<Video>` and `<Audio>` from `@remotion/media` are available in MDX.
Both accept `startInFrames` (in frames) to offset playback.

- **Positive** `startInFrames`: delays playback from section start.
  `<Video src="/clip.mp4" startInFrames={1 * FPS} />` plays after 1 second.
- **Negative** `startInFrames`: offsets from section end.
  `<Audio src="/sfx.mp3" startInFrames={-2 * FPS} />` plays 2 seconds before end.

### Gaps before and after audio

A gap **before** is a positive `startInFrames`. A gap **after** happens
automatically when the clip is shorter than the section; use a negative
`startInFrames` to anchor the clip to the cut, or `trimAfter` to cut the
source early.

```mdx
{/* 0.4s breath after the cut, then the voice starts */}
<GeneratedSpeech text="..." startInFrames={0.4 * FPS} />

{/* whoosh that ends exactly at the scene cut */}
<Audio src="/whoosh.mp3" startInFrames={-1 * FPS} />

{/* play only the first 2s of a longer clip */}
<Audio src="/tail.mp3" trimAfter={2 * FPS} />
```

### `objectFit` for full-frame media

`<Video>` and `<Img>` from `egaki/video` support `objectFit` as a component prop:

```tsx
<Fill>
  <Video src="/bg.mp4" muted loop objectFit="cover" />
</Fill>
```

| Value | Behavior |
|---|---|
| `"cover"` | Fills the container, crops overflow |
| `"fill"` | Stretches to fill, ignores aspect ratio |
| `"contain"` | Fits inside with letterboxing |
| `"none"` | No resizing, centered at native size |

**Never use raw `<img>` tags.** Always use `<Img>` from `egaki/video`, which
calls `delayRender()` while the image loads. A raw `<img>` renders a blank
frame during export.

### Import rules

Do **NOT** import `<Audio>`, `<Video>`, or `<OffthreadVideo>` from `remotion`.
Always import `<Audio>` and `<Video>` from `@remotion/media`.

| Component | Import from | Works? |
|---|---|---|
| `<Audio>` | `@remotion/media` | Yes |
| `<Video>` | `@remotion/media` | Yes |
| `<Audio>` / `<Video>` | `remotion` | No (throws in web-renderer) |
| `<OffthreadVideo>` | `remotion` | No |

## `useAbsoluteCurrentFrame`

Remotion's `useCurrentFrame()` returns the frame relative to the current
section (resets to 0 at each boundary). `useAbsoluteCurrentFrame()` returns
the **absolute frame** across the entire composition.

```tsx
import { useAbsoluteCurrentFrame } from 'egaki/video'
import { useVideoConfig } from 'remotion'

function GlobalTimer() {
  const absoluteFrame = useAbsoluteCurrentFrame()
  const { fps } = useVideoConfig()
  const elapsedSeconds = (absoluteFrame / fps).toFixed(1)
  return <span>{elapsedSeconds}s</span>
}
```

Use this for preamble overlays, cross-section sync, or global elapsed time.

## `useTweakpane`

Registers tweakable parameters in a shared tweakpane pane (top-right in the
player). When the component unmounts, its folder is removed.

```tsx
import { useTweakpane } from 'egaki/video'

export function MyComponent(props: MyComponentProps) {
  const { children, style } = props

  const tp = useTweakpane('MyComponent', {
    blur: { value: props.blur ?? 12, min: 0, max: 50, step: 0.5 },
    visible: props.visible ?? true,
    label: props.label ?? 'Hello',
    color: props.color ?? '#ff0055',
    offset: props.offset ?? { x: 50, y: 25 },
  })

  return <div style={{ filter: `blur(${tp.blur}px)`, color: tp.color }}>
    {children}
  </div>
}
```

Pass props as defaults so tweakpane overrides them live. A "Copy changes"
button serializes all modified params as structured markdown.

## `resolveAssetPath`

Resolves file paths in server components so `/image.png` maps to
`{projectRoot}/public/image.png`. Import from `egaki/generate-media`.

## `cachedGenerate`

A higher-order function that wraps any async function with filesystem caching,
deduplication, stale management, and progress tracking. All built-in generate
functions use it. Available for user code via `import { cachedGenerate } from 'egaki/cached-generate'`.

```ts
import { cachedGenerate } from 'egaki/cached-generate'

const cachedExplore = cachedGenerate({
  namespace: 'explore',
  prefixFrom: (p) => p.query,
  generate: async (params) => fetchExploreApi(params.query),
  serialize: (result) => ({ json: result, extension: '.json' }),
  deserialize: ({ filePath }) => JSON.parse(fs.readFileSync(filePath, 'utf-8')),
})
```

Files go to `public/generated/{namespace}/`. Errors are not cached; failed
calls retry on next invocation.

## Captions

Word-by-word captions synced to narration audio. Workflow: transcribe audio
to get word timestamps, convert to frame delays, render a Caption component.

### Transcription

```bash
egaki transcribe audio.mp3 --model whisper-1
```

**Models with word timestamps**: `whisper-1` (OpenAI), `ink-whisper`
(Cartesia, cheapest), `scribe_v1` (ElevenLabs), `nova-3` (Deepgram),
`whisper-large-v3`, `whisper-large-v3-turbo`, `distil-whisper-large-v3-en`
(Groq, fastest).

### Frame delays

Use each word's `startSecond` with `FPS`:

```mdx
<Caption words={[
  { word: "Just", delay: 0 },
  { word: "quit", delay: 0.26 * FPS },
  { word: "your", delay: 0.48 * FPS },
]} />
```

**Re-transcribe after regenerating TTS.** When you regenerate audio, all
word timestamps change. Always re-run `egaki transcribe` and update delays.

### Default caption style

Film-style subtitles at the bottom of the frame:

```tsx
<AbsoluteFill style={{
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  padding: '0 80px 120px',
}}>
  <span style={{
    fontSize: 42,
    fontWeight: 400,
    color: '#f5d442',
    fontFamily: '"Georgia", "Times New Roman", serif',
    textAlign: 'center',
    lineHeight: 1.4,
    letterSpacing: '0.01em',
    maxWidth: '70%',
  }}>
    {words.map((w, i) => (
      <span key={i} style={{ opacity: frame >= w.delay ? 1 : 0 }}>
        {i > 0 ? ' ' : ''}{w.word}
      </span>
    ))}
  </span>
</AbsoluteFill>
```

**Style rules:**
- Georgia serif, `fontWeight: 400`, soft yellow `#f5d442`
- 42px for 1080x1920 vertical; scale proportionally for other resolutions
- Bottom of screen via `alignItems: 'flex-end'` with `padding-bottom: 120px`
- `maxWidth: '70%'` to prevent captions spanning full width
- No text shadow, no uppercase, no fade animation; instant `opacity: 0/1`
- **No layout shift**: render ALL words always, toggle visibility with
  `opacity`, never conditional rendering

Reference examples: `example-sun-montage/` (film-style),
`example-bible-montage/` (editorial cascade with font rotation),
`example-captions/` (TikTok highlight style using `@remotion/captions`).

## Voice cloning and TTS

### Audio separation

```bash
egaki demucs song.mp3 --stems vocals,other -o stems/
```

### Voice cloning

```bash
# Cartesia (default, instant, free, up to 10s)
egaki voice clone stems/vocals.mp3 --name "my-voice" --language en --json

# ElevenLabs (better for noisy audio)
egaki voice clone stems/vocals.mp3 --provider elevenlabs --name "my-voice" --remove-background-noise --json
```

### TTS generation

```bash
egaki speech "Your text here." --voice <voice-id> --model sonic-3.5 -o public/voice.mp3
```

**Speed control**: Cartesia supports `--speed 0.6` to `1.5`. Default is 1.0.

### Inserting pauses

**Cartesia (sonic-3.5):** Use SSML `<break>` tags.

```
Playwriter lets you control Chrome from code. <break time="400ms"/> Install the extension.
```

**ElevenLabs (eleven_v3):** Use plain-text pause tags.

```
But there's a catch. [long pause] Introducing Cloud Browsers.
```

### Using TTS in videos

Place audio in `public/` and reference with `<Audio>`. For voiceover over
the whole video, put it in the preamble. For section narration, put it
inside the section.

```mdx
<Audio src="/voice-intro.mp3" />

# Scene duration=5s

<Caption words={[...]} />
```

### Voiceover pacing

Give every section its own `<GeneratedSpeech>` and make sure the speech
**never overruns the section**. Check with ffprobe:

```bash
for f in public/generated/audio/*.wav; do
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"
done
```

- **Overrun** → add a beat to the section or shorten the copy.
- **Dead air** → shorten the section or lengthen the copy.
- Don't fit VO with the TTS `speed` option: models treat it as a hint, so
  output duration is nonlinear and varies per generation. Don't use audio
  `playbackRate` either; it shifts pitch.
- `seed={2}` rerolls a generation whose length landed wrong.
- `startInFrames={0.4 * FPS}` adds a breath after a cut so narration
  doesn't run back to back across scenes.

### Syncing animations to word timestamps

Transcribe the generated speech to drive typewriter reveals or per-word
highlights:

```bash
egaki transcribe public/generated/audio/hook-*.wav -m scribe_v1 -o words.json
```

The output `segments` array has `startSecond`/`endSecond` per word. Feed
those into your component and reveal each word at `startSec * FPS`.
Re-transcribe whenever the VO text, speed, or seed changes.

## DimOverlay pattern

When a preamble `<Video>` plays behind section content, use `DimOverlay` to
darken and blur the video:

```mdx
# Scene duration=10s

<Background>
  <div style={{ width: '100%', height: '100%', backdropFilter: 'blur(20px)' }}>
    <DimOverlay darkness={0.8} duration={22} />
  </div>
</Background>
```

See `sun-montage-example/components.tsx` for the implementation.

## Masked word-by-word text reveal

A staggered slide-up animation where each word is clipped by an `overflow: hidden`
container and slides into view with `translateY`:

```tsx
function MaskedWordsText({ text, startSec }: { text: string; startSec: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <>
      {text.split(' ').map((word, i) => {
        const wordStart = (startSec + i * 0.061) * fps
        const progress = interpolate(frame, [wordStart, wordStart + 0.607 * fps], [0, 1], {
          easing: EASE.smooth,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        return (
          <span key={i}>
            <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top' }}>
              <span style={{ display: 'inline-block', transform: `translateY(${(1 - progress) * 100}%)` }}>
                {word}
              </span>
            </span>
            {i < text.split(' ').length - 1 ? ' ' : null}
          </span>
        )
      })}
    </>
  )
}
```

See `testimonial-example/components.tsx` for a working implementation.

## Frosted glass with `backdrop-filter`

Use `backdrop-filter: blur()` with a semi-transparent `backgroundColor`.
This works because egaki uses HtmlInCanvas which supports all CSS features.

```tsx
<div style={{
  backdropFilter: 'blur(54.5px)',
  WebkitBackdropFilter: 'blur(54.5px)',
  backgroundColor: 'rgba(255, 255, 255, 0.13)',
  borderRadius: '6%',
}} />
```

## Subpixel jitter prevention

Two rules when animating `transform: scale()` or `translateX/Y()`:

1. **Add `willChange: 'transform'`** to promote the layer to its own compositor surface.
2. **Round values to 3 decimal places**: `Math.round(value * 1000) / 1000`.

```tsx
const scale = interpolate(frame, [0, 90], [1, 1.35], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: EASE.cinematic,
})
const s = Math.round(scale * 1000) / 1000

<div style={{
  transform: `scale(${s})`,
  transformOrigin: '60% 45%',
  willChange: 'transform',
}}>
```

**Never** use `clamp` on slow, continuous animations (scrolling, panning, drift).
Clamping freezes the output at the boundary. Only use `clamp` for bounded
animations (opacity 0-1, progress bars).

## Light-leak overlay transitions

Overlay a short light-sweep clip (black background, bright streaks) at the
**end** of each scene so the flash lands right at the cut. With
`mixBlendMode: 'screen'` black becomes transparent and only the streaks
overlay the scene; a contrast crush removes the grey veil from compression
noise.

Find the clip's flash peak once with
`ffmpeg -i clip.mp4 -vf signalstats -f null -` (look for max `YAVG`), then
position the peak ~2 frames before the section end:

```tsx
function LightSwipe({ src, peakSec }: { src: string; peakSec: number }) {
  const { durationInFrames, fps } = useVideoConfig()
  const from = Math.max(0, durationInFrames - Math.round(peakSec * fps) - 2)
  return (
    <Sequence from={from} layout="none">
      <Fill style={{ pointerEvents: 'none' }}>
        <Video src={src} muted style={{
          width: '100%', height: '100%', objectFit: 'cover',
          mixBlendMode: 'screen', filter: 'brightness(0.75) contrast(2.2)',
        }} />
      </Fill>
    </Sequence>
  )
}
```

## Screen recordings in scenes

Prep recordings with ffmpeg before dropping them in: crop to the exact app
window (no desktop background), retime with `setpts` to fit the section,
and strip audio.

```bash
ffmpeg -i raw.mov -vf "crop=2048:1152:256:144,setpts=PTS/2.2,scale=1600:900" \
  -an -r 30 -c:v libx264 -crf 18 public/recordings/demo.mp4
```

Two presentations that work well:

- **Windowed**: rounded corners, spring entrance, and an ambient glow on a
  black scene (dark drop shadows are invisible on black; use a faint
  colored `boxShadow` glow instead).
- **Full-bleed**: `objectFit: 'cover'` filling the frame, wrapped in a slow
  scale drift so it never feels static.

## Zoom and ambient drift

### Zoom at a specific point

```tsx
const scale = interpolate(frame, [0, 90], [1, 1.2], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: EASE.cinematic,
})

<div style={{
  transform: `scale(${Math.round(scale * 1000) / 1000})`,
  transformOrigin: '55% 35%',
  willChange: 'transform',
}}>
```

### Ambient drift

No scene should feel static. Layer a **slow linear animation** over the full
scene duration on top of entrance effects. Keep magnitude small: +0.05 to
+0.10 for scale, 10-30px for translate. Interpolate from a negative offset
to 0 so the final frame is predictable.

```tsx
// Entrance: fast zoom-in over 1.5s
const zoomIn = interpolate(frame, [0, 45], [1, 1.35], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: EASE.cinematic,
})

// Ambient drift: slow linear scale over full 3s scene
const drift = interpolate(frame, [0, 90], [-0.08, 0], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
})

const s = Math.round((zoomIn + drift) * 1000) / 1000
```

## Premounting video sequences

When building montages in TSX, use `<Series>` with `premountFor` to preload
the next clip before the cut:

```tsx
import { Series } from 'remotion'
import { Video, Fill } from 'egaki/video'

<Series>
  <Series.Sequence durationInFrames={45}>
    <Fill><Video src="/clip-01.mp4" muted loop objectFit="cover" /></Fill>
  </Series.Sequence>
  <Series.Sequence premountFor={60} durationInFrames={45}>
    <Fill><Video src="/clip-02.mp4" muted loop objectFit="cover" /></Fill>
  </Series.Sequence>
</Series>
```

In MDX sections this is handled automatically (1 second premount).

## Framer Motion integration

egaki auto-detects `motion` in your project and bridges it with Remotion's
frame-based rendering. `motion.div`, springs, variants, staggered children,
and keyframes work inside MDX sections. Animations are frame-deterministic
and support backward scrubbing.

**Limitations:**
- `AnimatePresence` / exit animations won't replay on backward seek
- `layout` prop is not seekable
- `layoutId` / shared layout does not work; use egaki's `<LayoutTransition>`
- `whileInView`, `whileHover`, drag, tap are not deterministic
- Zero overhead when `motion` is not installed

## CSS rules

- **Never use viewport-relative units** (`vw`, `vh`, `vmin`, `vmax`). Remotion
  compositions have a fixed pixel size; viewport units resolve against the
  browser window. Use `%`, `px`, or `em` instead.
- **All CSS features work** including `perspective`, `transform-style: preserve-3d`,
  `backdrop-filter`, `mask-image`, `mix-blend-mode`, `filter`, `clip-path`.
  egaki uses HtmlInCanvas (Chromium's `drawElementImage`).
- **Export is Chromium-only.** Keep the tab in the foreground during export
  (background tabs throttle `requestAnimationFrame`).
- **Scene-level `<Scale>` must wrap `<Background>` too**, and must never go
  below 1 (e.g. use `from={1} to={1.2}`). Scaling below 1 shrinks the
  composition and exposes the black background behind it.

## MDX LSP autocomplete

Every egaki video project can have MDX LSP support so built-in components
get autocomplete with prop types.

1. **`@mdx-js/typescript-plugin`** installed as a devDependency.
2. **`tsconfig.json`** with the plugin registered:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@mdx-js/typescript-plugin" }]
  },
  "mdx": { "checkMdx": true },
  "include": ["**/*.ts", "**/*.tsx", "**/*.d.ts", "**/*.mdx"]
}
```

3. **`egaki-env.d.ts`** in the project root (auto-generated on first run):

```ts
import 'egaki/mdx-components'
```

**VS Code**: install the [MDX extension](https://marketplace.visualstudio.com/items?itemName=unifiedjs.vscode-mdx).
**Zed**: install [zed-mdx](https://github.com/srazzak/zed-mdx) and enable TypeScript in settings.

## Agent skill

This package ships a skill file that teaches AI coding agents how and when to
use it. Install it with:

```bash
npx -y skills add remorses/egaki
```

## License

MIT
