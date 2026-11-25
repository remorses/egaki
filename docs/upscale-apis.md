---
title: Image and video upscale APIs
description: Which hosted APIs upscale an existing image or video, checked 2026-11-25. Endpoint ids, max scale, prices, and which ones to wire into `egaki upscale` first given the keys we already have.
---

# Image and video upscale APIs

Checked on **2026-11-25** against model pages, official docs and pricing pages. fal prices also come from fal's `GET https://api.fal.ai/v1/models/pricing` endpoint (with our `FAL_KEY`). No paid test runs were made. Prices that no primary source confirmed are marked "unverified".

## Recommendation

Integrate these first. All of them use keys egaki already has.

1. **fal `fal-ai/seedvr/upscale/image`** (SeedVR2). Faithful, up to 10x or a target of 720p to 2160p, **$0.001 per output megapixel** (1024² to 4x = 16.8 MP costs about $0.017). The same API shape exists for video (`fal-ai/seedvr/upscale/video`). Uses `FAL_KEY`, which `separation-generate.ts` already reads. Best default.
2. **fal `topaz/upscale/image/precision`** (Topaz Gigapixel models). Industry reference quality, faithful, up to 4x, **$0.08 per started 24 MP** of output. Add `topaz/upscale/image/generative` (Wonder 3.5 / 4) as the "rebuild detail" option for small or blurry inputs. Same `FAL_KEY`.
3. **Keep GPT Image and Midjourney** (already in `cli/src/cli/upscale-generate.ts`). GPT Image re-renders the image. Via ChatGPT OAuth it costs nothing extra but the backend caps output at about 1.6 MP (tested); the 3840 px / 8.3 MP limit needs an `OPENAI_API_KEY`. Midjourney first fits the input to about 1 MP, then does 2x, so output is about 2048 px on the long edge.

For video, start with **fal `fal-ai/seedvr/upscale/video`** (cheap, temporally consistent) and **fal `topaz/upscale/video/precision`** (Proteus, $0.20 per 10 s at 1080p). `fal-ai/bytedance-upscaler/upscale/video` is the cheapest per second ($0.0072/s to 1080p).

**Vercel AI Gateway** (egaki gateway) now lists Topaz models (`topaz/wonder-3.5` image, `topaz/proteus` and `topaz/starlight-precise-2.6` video), but `/v1/models` reports no pricing for them. Usable later through the gateway once we record prices by hand.

## Images

Sample cost: 1024×1024 input, 4x, so 4096×4096 output (16.8 MP), unless the model has a fixed scale.

| Provider | Endpoint / model id | Max scale or output | Price | 1024² to 4x | Notes | Link |
|---|---|---|---|---|---|---|
| fal | `fal-ai/seedvr/upscale/image` | 1-10x, or target 720p/1080p/1440p/2160p | $0.001 / output MP | ~$0.017 | SeedVR2, faithful, cheapest | [page](https://fal.ai/models/fal-ai/seedvr/upscale/image) |
| fal | `fal-ai/seedvr/upscale/image/seamless` | same | $0.0025 / output MP | ~$0.042 | keeps tiling seamless (textures) | [page](https://fal.ai/models/fal-ai/seedvr/upscale/image/seamless) |
| fal | `topaz/upscale/image/precision` | 1-4x | $0.08 per started 24 MP | $0.08 | Standard V2, High Fidelity V3, Low Resolution V2, CGI, Text Refine, Faces | [page](https://fal.ai/models/topaz/upscale/image/precision) |
| fal | `topaz/upscale/image/generative` | 1-4x | $0.08 per started 8 MP (Wonder 3/3.5), per 4 MP (others) | $0.24 | Wonder 4/3.5/3, Redefine (prompt), Recovery | [page](https://fal.ai/models/topaz/upscale/image/generative) |
| fal | `topaz/upscale/image/creative` | 1-4x | $0.08 per started 2 MP | $0.72 | Bloom 2, for AI art | [page](https://fal.ai/models/topaz/upscale/image/creative) |
| fal | `topaz/upscale/image/transparent` | fixed 4x | $0.08 per started 24 MP | $0.08 | keeps alpha, PNG | [page](https://fal.ai/models/topaz/upscale/image/transparent) |
| fal | `fal-ai/topaz/upscale/image` | 1-4x | $0.08 up to 24 MP, $1.36 at 512 MP | $0.08 | legacy all-in-one Topaz endpoint, gone from fal search | [page](https://fal.ai/models/fal-ai/topaz/upscale/image) |
| fal | `fal-ai/recraft/upscale/crisp` | not stated (no scale param) | $0.004 / image | $0.004 | faithful, good for illustrations | [page](https://fal.ai/models/fal-ai/recraft/upscale/crisp) |
| fal | `fal-ai/recraft/upscale/creative` | not stated | $0.25 / image | $0.25 | regenerates detail and faces | [page](https://fal.ai/models/fal-ai/recraft/upscale/creative) |
| fal | `bria/increase-resolution` | 2x or 4x, up to 8192×8192 | $0.04 / image | $0.04 | no regeneration, licensed data | [page](https://fal.ai/models/bria/increase-resolution) |
| fal | `bria/upscale/creative` | 2x, up to 10 MP | $0.04 / image | n/a | creative, licensed data | [page](https://fal.ai/models/bria/upscale/creative) |
| fal | `fal-ai/ideogram/upscale` | up to 2x | $0.06 / image | n/a | optional prompt, resemblance, detail | [page](https://fal.ai/models/fal-ai/ideogram/upscale) |
| fal | `fal-ai/clarity-upscaler` | 1-4x | $0.03 / output MP | ~$0.50 | SD-based, creativity and resemblance sliders | [page](https://fal.ai/models/fal-ai/clarity-upscaler) |
| fal | `clarityai/crystal-upscaler` | 1-200x | $0.016 / output MP | ~$0.27 | portraits and faces | [page](https://fal.ai/models/clarityai/crystal-upscaler) |
| fal | `fal-ai/creative-upscaler` | 1-5x | $0.00125 / compute s (API) | unverified | SD 1.5 / SDXL, many knobs | [page](https://fal.ai/models/fal-ai/creative-upscaler) |
| fal | `fal-ai/esrgan` | 1-8x | $0.000575 / compute s (API), page says $0.00111 | ~cents | Real-ESRGAN, plain and fast | [page](https://fal.ai/models/fal-ai/esrgan) |
| fal | `fal-ai/aura-sr` | fixed 4x | $0.00111 / compute s (API) | ~cents | GAN, fast | [page](https://fal.ai/models/fal-ai/aura-sr) |
| fal | `fal-ai/ccsr`, `fal-ai/drct-super-resolution` | | | | **deprecated** on fal | |
| Topaz direct | Enhance API (Gigapixel, Wonder, Bloom) | up to 512 MP output | $0.10 / credit ($50/mo for 500), 1 credit per 24 MP | $0.10 | needs a Topaz subscription | [pricing](https://www.topazlabs.com/api), [docs](https://developer.topazlabs.com/) |
| Vercel AI Gateway | `topaz/wonder-3.5` | not reported | not reported by `/v1/models` (unverified) | unverified | `generateImage({ prompt: { images: [...] } })` | [page](https://vercel.com/ai-gateway/models/topaz/wonder-3.5) |
| Magnific (ex Freepik API) | `POST /v1/ai/image-upscaler` (Creative), `/v1/ai/image-upscaler-precision` | 2x, 4x, 8x, 16x | by output area: €0.10 (2x of 640×480) to €0.50 (8x) | ~€0.40 | prompt-guided creative or faithful | [creative](https://docs.magnific.com/api-reference/image-upscaler-creative/image-upscaler), [precision](https://docs.magnific.com/api-reference/image-upscaler-precision/image-upscaler) |
| Stability AI | `/v2beta/stable-image/upscale/fast` | fixed 4x, max 16 MP out, input ≤1 MP | $0.02 (2 credits) | n/a (input too big) | ~1 s | [docs](https://docs.stability.ai/api-reference/upscale/fast), [pricing](https://platform.stability.ai/pricing) |
| Stability AI | Conservative upscaler | 20-40x to 4 MP | $0.40 (40 credits) | n/a | minimal changes | [pricing](https://platform.stability.ai/pricing) |
| Stability AI | Creative upscaler (async) | to 4K | $0.60 (60 credits) | n/a | prompt-guided, for degraded inputs | [pricing](https://platform.stability.ai/pricing) |
| Recraft direct | `POST /v1/images/crispUpscale`, `/creativeUpscale` | input ≤16 MP, sides ≤4096 px | $0.004 crisp, $0.25 creative | $0.004 | same models as fal, needs Recraft token | [docs](https://www.recraft.ai/docs/api-reference/tools/upscale) |
| Google Vertex | `imagen-4.0-upscale-preview` | x2, x3, x4, output ≤17 MP | $0.06 / image | n/a (over 17 MP) | Vertex only, not on Gemini API key | [docs](https://cloud.google.com/vertex-ai/generative-ai/docs/image/upscale-image), [pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) |
| Ideogram direct | `POST /v2/image/upscale/{model}` | x2, x4, x8, max 8192 px edge | per output MP (unverified); v1 upscale $0.06 | unverified | hosts Topaz models and Nano Banana Pro | [docs](https://developer.ideogram.ai/v2/api-reference/images/upscale), [pricing](https://ideogram.ai/features/api-pricing) |
| Leonardo | `aurora-upscaler-precise`, `aurora-upscaler-creative` | 2, 3, 4, 5, 6, 8x | unverified | unverified | uploaded or generated images | [docs](https://docs.leonardo.ai/docs/pro-upscaler-precise) |
| Replicate | `nightmareai/real-esrgan` | not checked | $0.002 / image | $0.002 | no Replicate key | [page](https://replicate.com/nightmareai/real-esrgan) |
| Replicate | `philz1337x/clarity-upscaler` | | ~$0.016 / run | | GPU time | [page](https://replicate.com/philz1337x/clarity-upscaler) |
| Replicate | `philz1337x/crystal-upscaler` | | $0.05 (≤4.4 MP) to $3.20 (>110 MP) | $0.20 | tiered by output pixels | [page](https://replicate.com/philz1337x/crystal-upscaler) |
| Replicate | `recraft-ai/recraft-crisp-upscale` / `-creative-upscale` | | $0.006 / $0.30 | $0.006 | pricier than fal | [crisp](https://replicate.com/recraft-ai/recraft-crisp-upscale) |
| Replicate | `topazlabs/image-upscale` | up to 512 MP | $0.05 per unit (1 unit ≤24 MP) | $0.05 | cheapest Topaz route, no key | [page](https://replicate.com/topazlabs/image-upscale) |
| Replicate | `bria/increase-resolution` | 2x, 4x | $0.04 / image | $0.04 | | [page](https://replicate.com/bria/increase-resolution) |

### Generative "upscale by prompt"

These re-render the image at a larger size. They change details, so treat them as creative upscalers.

| Provider | Model | Max output | Price | Key we have | Link |
|---|---|---|---|---|---|
| OpenAI GPT Image | `gpt-image-2` family (custom `WIDTHxHEIGHT`) | API: edge ≤3840, multiples of 16, ratio ≤3:1, 655,360 to 8,294,400 px. ChatGPT backend: about 1.6 MP, size ignored | ChatGPT plan via Codex backend; API is token billed | ChatGPT OAuth | [docs](https://developers.openai.com/api/docs/guides/image-generation) |
| Google Gemini | `gemini-3-pro-image` (Nano Banana Pro), `image_size: "4K"` | 4K | $0.24 per 4K image | Gemini key | [docs](https://ai.google.dev/gemini-api/docs/image-generation), [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Google Gemini | `gemini-3.1-flash-image` (Nano Banana 2) | 4K | $0.151 per 4K image | Gemini key | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Midjourney | editor upload, then `v7_2x_subtle` / `v7_2x_creative` (also `v8r2_*`) | 2x of a ~1 MP frame | subscription GPU time | browser | `midjourney/src/midjourney.ts` `upscaleImage()` |
| xAI Grok | `grok-imagine-image` `resolution: "2k"` | 2k | | xAI | [docs](https://docs.x.ai/developers/model-capabilities/images/generation) |

## Video

Sample cost: 10 s clip, 30 fps, 1080p output (about 622 MP of frames) unless noted.

| Provider | Endpoint / model id | Max scale or output | Price | 10 s to 1080p | Notes | Link |
|---|---|---|---|---|---|---|
| fal | `fal-ai/seedvr/upscale/video` | 1-10x, or target up to 2160p | $0.001 / output MP (w×h×frames) | ~$0.62 | SeedVR2, temporally consistent | [page](https://fal.ai/models/fal-ai/seedvr/upscale/video) |
| fal | `openimaginglab/flashvsr-plus` | 1-4x, ~4K | $0.0005 / output MP | ~$0.31 | one-step diffusion, keeps audio | [page](https://fal.ai/models/openimaginglab/flashvsr-plus) |
| fal | `fal-ai/bytedance-upscaler/upscale/video` | 1080p, 2k, 4k, 6k, 8k | $0.0072/s at 1080p, $0.0288/s 4K; 2x for >30 fps; 10x in `pro` | $0.07 | cheapest per second | [page](https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video) |
| fal | `topaz/upscale/video/precision` | 1-4x | $0.20 / 10 s at 1080p, $0.60 at 4K | $0.20 | Proteus, Iris, Artemis, Gaia, Rhea | [page](https://fal.ai/models/topaz/upscale/video/precision) |
| fal | `topaz/upscale/video/generative` | 1-4x | $1.20 / 10 s to 1080p, $2.60 4K (Fast 2: half) | $1.20 | Starlight Precise 2.6, HQ, Mini, Sharp | [page](https://fal.ai/models/topaz/upscale/video/generative) |
| fal | `topaz/upscale/video/creative` | 1-4x | $3.00 / 10 s to 1080p, $5.00 4K | $3.00 | Astra 2, optional prompt | [page](https://fal.ai/models/topaz/upscale/video/creative) |
| fal | `fal-ai/topaz/upscale/video` | 1-4x | $0.02/s 720p-1080p, $0.08/s above | $0.20 | legacy all-in-one Topaz endpoint | [page](https://fal.ai/models/fal-ai/topaz/upscale/video) |
| fal | `fal-ai/video-upscaler` | 1-8x | $0.0008 / output MP | ~$0.50 | Real-ESRGAN per frame, no temporal model | [page](https://fal.ai/models/fal-ai/video-upscaler) |
| fal | `blackforestlabs/flux-video-upscale` | 1.5-3x, to 1080p/2K/4K | $0.084/s 1080p precise, $0.12/s creative | $0.84 | FLUX 3 based | [page](https://fal.ai/models/blackforestlabs/flux-video-upscale) |
| fal | `google/gemini-omni-flash/v1.2/upscale` | 720p, 1080p, 4k, clip ≤15 s | ~$0.041/s (720p→1080p), $0.1638/s to 4K | ~$0.41 | optional text instruction | [page](https://fal.ai/models/google/gemini-omni-flash/v1.2/upscale) |
| fal | `lightricks/ltx-2.5/upscale` | 1080p, 4k, 8k | $0.08/s of input at 1080p, $0.30 4K, $1.20 8K | $0.80 | H.264/HEVC input, keeps audio | [page](https://fal.ai/models/lightricks/ltx-2.5/upscale) |
| fal | `clarityai/crystal-video-upscaler` | 1-200x | $0.10 per output MP per second (×fps/30) | ~$2.07 | high fidelity | [page](https://fal.ai/models/clarityai/crystal-video-upscaler) |
| fal | `bria/video/increase-resolution` | 2x or 4x, up to 8K | $0.14 / s | $1.40 | licensed data | [page](https://fal.ai/models/bria/video/increase-resolution) |
| fal | `fal-ai/flashvsr/upscale/video`, `simalabs/sima-video-upscaler-lite` | | | | **deprecated** on fal | |
| Vercel AI Gateway | `topaz/proteus`, `topaz/starlight-precise-2.6` | `resolution` param | not reported (unverified) | unverified | `experimental_generateVideo` with `inputReferences` | [proteus](https://vercel.com/ai-gateway/models/topaz/proteus) |
| Topaz direct | Video API (Proteus, Starlight, Astra) | up to 4K | credits at $0.10 / credit, video credit rate unverified | unverified | | [pricing](https://www.topazlabs.com/api) |
| Replicate | `topazlabs/video-upscale` | to 4K, 60 fps | $0.08 / unit; 720p→1080p/30fps $0.093 per 5 s | ~$0.19 | no Replicate key | [page](https://replicate.com/topazlabs/video-upscale) |
| Replicate | `lucataco/real-esrgan-video` | | ~$0.14 / run | | GPU time | [page](https://replicate.com/lucataco/real-esrgan-video) |

## Details

### fal

All fal endpoints take `image_url` (or `video_url`) and run through the queue API, like the separation code. Data URLs work for small images; larger files should go through fal storage upload first.

Price units differ per endpoint: per output megapixel, per image, per "started N MP" block (Topaz), per compute second, or per output second. The `api.fal.ai/v1/models/pricing?endpoint_id=...` endpoint returns `unit_price` and `unit`, but Topaz rows say `0.01 / units`, so read the model page for the real rule. The pricing endpoint rate-limits fast (429 after about 10 calls).

`fal-ai/topaz/upscale/image` and `fal-ai/topaz/upscale/video` still answer, but fal search no longer lists them. The new split endpoints (`topaz/upscale/image/precision`, `generative`, `creative`, `transparent`) are the current ones.

Compute-second prices disagree between page and API for `fal-ai/esrgan` ($0.00111 page, $0.000575 API). The pages for `aura-sr` and `creative-upscaler` round to "$0".

### Topaz

Topaz is the quality reference. It is reachable four ways: fal (`topaz/...`), Replicate (`topazlabs/...`), Vercel AI Gateway (`topaz/...`), and Topaz's own API ($50/month minimum). Through fal it costs $0.08 per 24 MP block for precision models, so a 4x upscale of a 1024² image costs $0.08. That is the simplest route for egaki.

### Vercel AI Gateway

`curl -s https://ai-gateway.vercel.sh/v1/models` lists `topaz/wonder-3.5` (type image) and `topaz/proteus`, `topaz/starlight-precise-2.6` (type video). Their `pricing` object is empty and `/endpoints` returns all zeros. The gateway in `gateway/src/plans.ts` derives cost from the CLI catalog, so we would need a manual price before allowing these through the egaki gateway.

### Google

The Gemini API key has no upscale model (checked `GET /v1beta/models`). `imagen-4.0-upscale-preview` exists only on Vertex AI: factors `x2`, `x3`, `x4`, output must stay at or under 17 MP, $0.06 per image. We have no Vertex setup.

Gemini 3 image models can output 4K when given an input image and an "upscale this image" prompt. That re-renders the image, so it is a creative upscale. For video, Gemini Omni Flash 1.2 upscaling is reachable through fal (`google/gemini-omni-flash/v1.2/upscale`). The Gemini API docs only show `resolution: "1080p" | "4k"` for generated video, not an upscale-only mode.

### GPT Image

From the OpenAI image guide: custom sizes must be multiples of 16, edge at most 3840 px, long/short ratio at most 3:1, total pixels between 655,360 and 8,294,400. The guide says resolutions above 2560×1440 are experimental for GPT-Image-2.5. `gpt-image-2` always processes input images at high fidelity, which helps "same image, more pixels" prompts, but small text and faces can still change.

The ChatGPT subscription backend (`chatgpt.com/backend-api/codex`) ignores `size` and `quality`, on both the Responses tool and the newer `images/edits` endpoint. A 992×570 painting came back at 1655×950 for every requested size. See [chatgpt-codex-image-backend.md](chatgpt-codex-image-backend.md).

The `egaki upscale` prompt (`gptUpscalePrompt()` in `cli/src/cli/upscale-generate.ts`) follows the structure most upscale prompt guides share: the action with the target size, a keep list (composition, crop, colors, lighting, style, text, faces), the allowed improvements (edges, texture, remove blur, noise and JPEG artifacts), then a list of forbidden changes. Sources:

- [ChatGPT upscale prompt guide](https://chatgptprompt.in/blog/chatgpt-upscale-image-prompt-guide): action, preserve, improve, output.
- [SurePrompts photo enhance prompts](http://sureprompts.com/blog/chatgpt-photo-enhance-prompts): keep list first, "do not invent detail", no halos, no smoothing.
- [Media.io exact fidelity upscale prompt](https://www.media.io/ai/image-to-image/chatgpt-4k-prompts): "no relight, no reshape, no perspective shift, no stylization".

### Midjourney

docs.midjourney.com blocks non-browser clients (403), so this comes from our own `@egaki/midjourney` package. Midjourney only upscales its own jobs. `upscaleImage()` registers the input as an editor upload (`t: "uploaded"`), which fits it to a frame of about 1 MP, then runs `v7_2x_subtle` or `v7_2x_creative`. The input is downscaled first, so this is a poor choice for inputs already larger than about 1 MP.

### Stability, Magnific, Recraft, Ideogram, Leonardo

None of these keys are configured.

- **Stability**: Fast is cheap ($0.02) but input must be at most 1 MP and output is capped at 16 MP. Conservative and Creative cap at about 4 MP.
- **Magnific**: the Freepik API is now Magnific (`docs.freepik.com` redirects to `docs.magnific.com`). Prices are in euros and based on output area.
- **Recraft**: same crisp ($0.004) and creative ($0.25) prices as fal, so fal is the easier route.
- **Ideogram**: the v2 API hosts Topaz models and Nano Banana Pro behind `POST /v2/image/upscale/{model}`, billed per output MP. The per-MP rate was not on the pricing page.
- **Leonardo**: Pro Upscaler Precise and Creative (`aurora-upscaler-*`) accept uploaded images. Price was not on a public page (unverified).
