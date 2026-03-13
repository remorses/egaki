# Changelog

All notable changes to this project will be documented in this file.

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
