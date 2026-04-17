# Changelog

All notable changes to this project will be documented in this file.

## 0.4.0

1. **ChatGPT login for OpenAI image generation** — use your ChatGPT subscription in `egaki` without a separate OpenAI platform API key:

   ```bash
   egaki login --provider chatgpt
   egaki image "a dreamy studio ghibli style bakery at sunrise" -m gpt-image-1.5 -o bakery.png
   ```

   OpenAI image requests authenticated this way now follow the same Codex backend flow used by ChatGPT instead of the normal Image API path.

2. **ChatGPT-backed image editing** — edit existing images with OpenAI image models through the ChatGPT/Codex backend:

   ```bash
   egaki image "change the red jacket to a blue jacket" -m gpt-image-1.5 --input portrait.png -o portrait-blue.png
   egaki image "turn this product shot into a clay render" -m gpt-image-1.5 --input product.png -o product-clay.png
   ```

   Multiple input images are supported. For this backend path, `egaki` now explicitly rejects unsupported options like `--seed`, `--mask`, and multi-image output instead of pretending they work.

3. **Aspect ratio support for ChatGPT image generation** — supported ChatGPT/OpenAI aspect ratios now map to the backend's real size controls:

   ```bash
   egaki image "wide landscape matte painting" -m gpt-image-1.5 --aspect-ratio 3:2 -o wide.png
   egaki image "book cover concept art" -m gpt-image-1.5 --aspect-ratio 2:3 -o cover.png
   ```

   Supported ratios on this path are `1:1`, `3:2`, and `2:3`.

4. **`egaki models` now shows login availability** — model discovery output includes whether each provider is currently usable from your configured credentials:

   ```bash
   egaki models
   egaki models --json | jq '.[] | {id, provider, auth}'
   ```

   The output now includes `auth.available` and `auth.source` (`env`, `stored`, `oauth`, or `none`) so you can see which model families are ready to use.

## 0.3.0

1. **Google Vertex AI provider** — use Google Cloud billing instead of AI Studio by
   prefixing model IDs with `vertex/`:

   ```bash
   egaki login --provider vertex --key AIza...
   egaki image "product shot on marble" -m vertex/imagen-4.0-generate-001 -o product.png
   egaki image "editorial portrait" -m vertex/gemini-3.1-flash-image-preview --aspect-ratio 4:5
   egaki video "storm over mountains" -m vertex/veo-3.1-fast-generate-001 --duration 6 -o storm.mp4
   ```

   Bare model IDs (e.g. `imagen-4.0-generate-001`) continue to route through Google AI
   Studio as before. `vertex/` prefix routes through `@ai-sdk/google-vertex` using your
   `GOOGLE_VERTEX_API_KEY`. The two providers are fully independent — having one key does
   not affect the other.

   Supported Vertex models:
   - `vertex/imagen-4.0-generate-001`, `vertex/imagen-4.0-ultra-generate-001`, `vertex/imagen-4.0-fast-generate-001`
   - `vertex/gemini-2.5-flash-image`, `vertex/gemini-3-pro-image-preview`, `vertex/gemini-3.1-flash-image-preview`
   - `vertex/veo-3.1-generate-001`, `vertex/veo-3.1-fast-generate-001`

2. **`egaki models --provider vertex`** — list only Vertex models:

   ```bash
   egaki models --provider vertex
   ```

3. **Fixed confusing error for Vertex without a key** — if you attempt a `vertex/` model
   without a `GOOGLE_VERTEX_API_KEY` configured, you now get a clear error pointing you
   to set one up instead of a cryptic upstream failure.

## 0.2.0

1. **New `egaki video` command** — generate videos from text prompts or still images.
   Full support for all AI Gateway video providers:

   ```bash
   egaki video "a paper boat drifting on a calm lake at sunrise" -o boat.mp4
   egaki video "timelapse of a stormy sea" -m google/veo-3.1-generate-001 --duration 8 -o storm.mp4
   egaki video "animate the clouds slowly" --input photo.jpg -m klingai/kling-v2.6-i2v -o animated.mp4
   ```

   Supported models: Google Veo 3.0/3.1, Kling v2.5/v2.6/v3.0, Bytedance Seedance,
   Alibaba Wan, xAI Grok video.

2. **Full video options** — `--duration`, `--resolution`, `--aspect-ratio`, `--fps`,
   `--seed`, `--count`, `--input` (image-to-video), `--stdout`, `--json`.

3. **`egaki models --type` filter** — filter model listing by modality:

   ```bash
   egaki models --type video
   egaki models --type image
   egaki models --type all   # default
   ```

   Video models show duration range, capabilities (t2v, i2v, r2v), and resolution tiers.

4. **Egaki subscription covers video** — all gateway video models work with your
   `egaki_...` key; usage is billed per-second based on model, resolution, and duration.

## 0.1.0

1. **New `egaki video` command** — generate videos from text prompts using AI models
   via `experimental_generateVideo`:

   ```bash
   egaki video "a paper boat drifting on a calm lake at sunrise" -o boat.mp4
   egaki video "timelapse of a stormy sea" -m google/veo-3.1-generate-001 --duration 8 -o storm.mp4
   ```

   Supports all major AI Gateway video models: Google Veo 3.0/3.1, Kling v2.5/v2.6/v3.0,
   Bytedance Seedance, Alibaba Wan, and xAI Grok video.

2. **Image-to-video support** — animate a still image with models that support `i2v`:

   ```bash
   egaki video "slowly animate the clouds" --input photo.jpg -m klingai/kling-v2.6-i2v -o animated.mp4
   ```

3. **New video options** — `--duration`, `--resolution`, `--aspect-ratio`, `--fps`,
   `--seed`, `--count`, `--input`, `--stdout`, `--json` for full control over generation.

4. **`egaki models --type` filter** — filter model listing by modality:

   ```bash
   egaki models --type video
   egaki models --type image
   egaki models --type all   # default
   ```

   Video models show duration range, capabilities (t2v, i2v, r2v), and resolution tiers.

5. **Egaki subscription now covers video** — all gateway video models work with your
   `egaki_...` key; usage is tracked per-second based on model tier and duration.

6. **AI SDK dependencies pinned to exact versions** — `ai`, `@ai-sdk/google`,
   `@ai-sdk/fal`, `@ai-sdk/openai`, `@ai-sdk/replicate` are now pinned so AI Gateway
   protocol changes can't silently break the CLI.

## 0.0.2

- Make subscribe messaging explicit about both auth modes.
- Clarify BYOK provider keys vs single Egaki subscription key in CLI + docs.
- Expand README with advanced usage and model-specific command examples.

## 0.0.1

- Initial public release of the `egaki` CLI.
- Image generation command with model selection and file/stdout output.
- Login, subscription, unsubscribe, usage, and models commands.
