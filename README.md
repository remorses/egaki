# egaki

Generate AI images from the terminal with one command.

`egaki` is a TypeScript CLI built on the Vercel AI SDK and goke. It supports
Google Imagen, Gemini image-capable models, and model discovery with pricing.

## Install

```bash
pnpm add -g egaki
```

## Quick start

```bash
egaki login
egaki image "a watercolor fox reading a map" -o fox.png
```

## CLI examples

### Generate from text

```bash
egaki image "cinematic mountain village at sunrise" -o village.png
egaki image "isometric floating city, detailed, soft colors" -m imagen-4.0-generate-001
```

### Edit with input image

```bash
egaki image "add a red scarf and make it winter" --input portrait.jpg -o portrait-winter.png
egaki image "turn this into a manga panel" --input https://example.com/photo.jpg -o manga.png
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
```

### Pipe output to other tools

```bash
egaki image "flat icon of a fox" --stdout | magick - -resize 512x512 fox-icon.png
```

### Discover models and pricing

```bash
egaki models
egaki models --provider google
egaki models --json
```

### Advanced examples

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

## Model input examples

Use `egaki models --json` to see the full list. These are practical examples of
which flags pair well with common models:

| Model ID | Best for | Example command |
| --- | --- | --- |
| `imagen-4.0-ultra-generate-001` | High-quality prompt-to-image with seed + ratio | `egaki image "luxury perfume ad on marble" -m imagen-4.0-ultra-generate-001 --aspect-ratio 3:4 --seed 7 -o perfume.png` |
| `gemini-3.1-flash-image-preview` | Fast, cheap text+image edits with wide aspect-ratio support | `egaki image "turn into manga splash page" -m gemini-3.1-flash-image-preview --input portrait.jpg --aspect-ratio 4:1 -o manga-wide.png` |
| `nano-banana-pro-preview` | Highest-fidelity Google text+image output | `egaki image "fashion editorial, dramatic rim light" -m nano-banana-pro-preview --input model.jpg --image-size 2K -o editorial.png` |
| `gpt-image-1.5` | OpenAI image generation with strong editing/inpainting support | `egaki image "replace background with neon city" -m gpt-image-1.5 --input product.png --mask bg-mask.png -o product-neon.png` |
| `black-forest-labs/flux-fill-pro` | Inpainting-focused Flux workflow on Replicate | `egaki image "restore damaged poster corners" -m black-forest-labs/flux-fill-pro --input poster.png --mask corners-mask.png -o restored.png` |
| `fal-ai/flux/schnell` | Very fast low-cost ideation batches | `egaki image "logo sketch, geometric fox" -m fal-ai/flux/schnell -n 8 -o fox-logo.png` |

## Feature support by model family

Quick rule of thumb for flags:

- **Google Imagen (`imagen-*`)**: supports `--seed`, `--aspect-ratio`, `--input`, `--mask`, `-n`
- **Google Gemini image models**: supports `--input`, `--aspect-ratio`, `--image-size`; usually no `--seed`
- **OpenAI image models**: strong editing and inpainting; size controls are model-specific
- **Flux/Fal/Replicate models**: broad aspect-ratio + seed support; editing/inpainting depends on exact model

### Subscription and usage

egaki supports **both** authentication modes:

- **BYOK (bring your own keys):** add provider keys with `egaki login` per provider.
- **Egaki subscription:** use one `egaki_...` key to access all supported models without managing keys for each provider.

```bash
# Subscribe and get a checkout URL
egaki subscribe --email user@example.com --plan pro

# Save your Egaki key after checkout
egaki login --provider egaki --key egaki_...

# BYOK example (direct provider key)
egaki login --provider google --key AIza...

# Check subscription usage / cancel
egaki usage
egaki unsubscribe
```

## Help

```bash
egaki --help
egaki image --help
```

## Auth and billing

- `egaki login` stores provider keys in `~/.config/egaki/credentials.json`.
- `egaki subscribe`, `egaki usage`, and `egaki unsubscribe` manage Egaki plans.

## License

MIT
