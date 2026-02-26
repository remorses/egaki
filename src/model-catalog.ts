// Single source of truth for all image generation models.
// Every model's provider, pricing, features, and generation strategy lives here.
// Other modules derive their data from this catalog — no separate registries.
//
// To add a model: add an entry to CATALOG with the right shared fragment spread.
// To update pricing: change the cost field on the model entry.
// To add a provider: create a new shared fragment and add models using it.

// ─── types ───────────────────────────────────────────────────────────────────

export type PerImageCost = {
  type: 'per-image'
  /** USD per image at default quality/resolution */
  perImage: number
}

export type PerTokenCost = {
  type: 'per-token'
  /** USD per million input tokens */
  inputPerM: number
  /** USD per million output tokens */
  outputPerM: number
}

export type ModelCost = PerImageCost | PerTokenCost

export type ModelFeatures = {
  /** supports input images for editing */
  editing: boolean
  /** supports mask for inpainting */
  inpainting: boolean
  /** supported aspect ratios */
  aspectRatios: string[]
  /** supported WIDTHxHEIGHT sizes (OpenAI models) */
  sizes?: string[]
  /** supports deterministic seed */
  seed: boolean
  /** supports generating n > 1 images */
  multipleImages: boolean
}

export type ModelEntry = {
  id: string
  name: string
  provider: string
  strategy: 'image' | 'text'
  cost: ModelCost
  features: ModelFeatures
}

// ─── shared fragments ────────────────────────────────────────────────────────
// Spread these into model entries to avoid repeating common fields.

const googleImagen = {
  provider: 'google',
  strategy: 'image' as const,
  features: {
    editing: true,
    inpainting: true,
    aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    seed: true,
    multipleImages: true,
  },
}

const googleText = {
  provider: 'google',
  strategy: 'text' as const,
  features: {
    editing: true,
    inpainting: false,
    aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '4:5', '5:4'],
    seed: false,
    multipleImages: false,
  },
}

const openaiImage = {
  provider: 'openai',
  strategy: 'image' as const,
}

const replicateImage = {
  provider: 'replicate',
  strategy: 'image' as const,
}

const falImage = {
  provider: 'fal',
  strategy: 'image' as const,
}

const fluxAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9', '9:21', '21:9']

// ─── catalog ─────────────────────────────────────────────────────────────────

export const CATALOG: ModelEntry[] = [
  // ── Google: Imagen ─────────────────────────────────────────────────────
  {
    id: 'imagen-4.0-generate-001',
    name: 'Imagen 4',
    ...googleImagen,
    cost: { type: 'per-image', perImage: 0.04 },
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    name: 'Imagen 4 Ultra',
    ...googleImagen,
    cost: { type: 'per-image', perImage: 0.06 },
  },
  {
    id: 'imagen-4.0-fast-generate-001',
    name: 'Imagen 4 Fast',
    ...googleImagen,
    cost: { type: 'per-image', perImage: 0.02 },
  },

  // ── Google: Gemini text+image ──────────────────────────────────────────
  {
    id: 'gemini-2.0-flash-exp-image-generation',
    name: 'Gemini 2.0 Flash (Image)',
    ...googleText,
    cost: { type: 'per-token', inputPerM: 0.1, outputPerM: 0.4 },
  },
  {
    id: 'gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    ...googleText,
    cost: { type: 'per-token', inputPerM: 0.3, outputPerM: 30 },
  },
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image',
    ...googleText,
    cost: { type: 'per-token', inputPerM: 1.25, outputPerM: 10 },
  },
  {
    id: 'nano-banana-pro-preview',
    name: 'Nano Banana Pro',
    ...googleText,
    cost: { type: 'per-token', inputPerM: 0.3, outputPerM: 30 },
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────
  {
    id: 'dall-e-2',
    name: 'DALL-E 2',
    ...openaiImage,
    cost: { type: 'per-image', perImage: 0.02 },
    features: {
      editing: true,
      inpainting: true,
      aspectRatios: [],
      sizes: ['256x256', '512x512', '1024x1024'],
      seed: false,
      multipleImages: true,
    },
  },
  {
    id: 'dall-e-3',
    name: 'DALL-E 3',
    ...openaiImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: [],
      sizes: ['1024x1024', '1792x1024', '1024x1792'],
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'gpt-image-1',
    name: 'GPT Image 1',
    ...openaiImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: true,
      inpainting: true,
      aspectRatios: [],
      sizes: ['1024x1024', '1536x1024', '1024x1536'],
      seed: false,
      multipleImages: true,
    },
  },
  {
    id: 'gpt-image-1-mini',
    name: 'GPT Image 1 Mini',
    ...openaiImage,
    cost: { type: 'per-image', perImage: 0.009 },
    features: {
      editing: true,
      inpainting: true,
      aspectRatios: [],
      sizes: ['1024x1024', '1536x1024', '1024x1536'],
      seed: false,
      multipleImages: true,
    },
  },
  {
    id: 'gpt-image-1.5',
    name: 'GPT Image 1.5',
    ...openaiImage,
    cost: { type: 'per-image', perImage: 0.034 },
    features: {
      editing: true,
      inpainting: true,
      aspectRatios: [],
      sizes: ['1024x1024', '1536x1024', '1024x1536'],
      seed: false,
      multipleImages: true,
    },
  },

  // ── Replicate ──────────────────────────────────────────────────────────
  {
    id: 'black-forest-labs/flux-1.1-pro',
    name: 'Flux 1.1 Pro',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'black-forest-labs/flux-1.1-pro-ultra',
    name: 'Flux 1.1 Pro Ultra',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.06 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'black-forest-labs/flux-2-pro',
    name: 'Flux 2 Pro',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.055 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'black-forest-labs/flux-2-dev',
    name: 'Flux 2 Dev',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.025 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'black-forest-labs/flux-dev',
    name: 'Flux Dev',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.025 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'black-forest-labs/flux-pro',
    name: 'Flux Pro',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.05 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'black-forest-labs/flux-schnell',
    name: 'Flux Schnell',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.003 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'black-forest-labs/flux-fill-pro',
    name: 'Flux Fill Pro',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.05 },
    features: {
      editing: true,
      inpainting: true,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'black-forest-labs/flux-fill-dev',
    name: 'Flux Fill Dev',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.025 },
    features: {
      editing: true,
      inpainting: true,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'ideogram-ai/ideogram-v2',
    name: 'Ideogram v2',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.08 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'ideogram-ai/ideogram-v2-turbo',
    name: 'Ideogram v2 Turbo',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'recraft-ai/recraft-v3',
    name: 'Recraft v3',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'recraft-ai/recraft-v3-svg',
    name: 'Recraft v3 SVG',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'stability-ai/stable-diffusion-3.5-large',
    name: 'SD 3.5 Large',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.035 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '9:21', '21:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'stability-ai/stable-diffusion-3.5-large-turbo',
    name: 'SD 3.5 Large Turbo',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.015 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '9:21', '21:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'stability-ai/stable-diffusion-3.5-medium',
    name: 'SD 3.5 Medium',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.025 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '9:21', '21:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'luma/photon',
    name: 'Luma Photon',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '9:21', '21:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'luma/photon-flash',
    name: 'Luma Photon Flash',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.02 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '9:21', '21:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'nvidia/sana',
    name: 'NVIDIA Sana',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.01 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: true,
      multipleImages: false,
    },
  },

  // ── Fal ────────────────────────────────────────────────────────────────
  {
    id: 'fal-ai/flux/schnell',
    name: 'Flux Schnell',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.003 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: true,
    },
  },
  {
    id: 'fal-ai/flux/dev',
    name: 'Flux Dev',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.025 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: true,
    },
  },
  {
    id: 'fal-ai/flux-general',
    name: 'Flux General',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.025 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: true,
    },
  },
  {
    id: 'fal-ai/flux-general/inpainting',
    name: 'Flux General Inpainting',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.025 },
    features: {
      editing: true,
      inpainting: true,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/flux-general/image-to-image',
    name: 'Flux General Image-to-Image',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.025 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/flux-pro/v1.1',
    name: 'Flux Pro 1.1',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/flux-pro/v1.1-ultra',
    name: 'Flux Pro 1.1 Ultra',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.06 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/flux-pro/kontext',
    name: 'Flux Kontext',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/flux-pro/kontext/max',
    name: 'Flux Kontext Max',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.08 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/flux-lora',
    name: 'Flux LoRA',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.025 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: true,
    },
  },
  {
    id: 'fal-ai/recraft/v3/text-to-image',
    name: 'Recraft v3',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/recraft/v3/image-to-image',
    name: 'Recraft v3 Image-to-Image',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/ideogram/character',
    name: 'Ideogram Character',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.08 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/imagen4/preview',
    name: 'Imagen 4 (Fal)',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/luma-photon',
    name: 'Luma Photon (Fal)',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/luma-photon/flash',
    name: 'Luma Photon Flash (Fal)',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.02 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/omnigen-v2',
    name: 'OmniGen v2',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.03 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/qwen-image',
    name: 'Qwen Image',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.03 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
]

// ─── lookup helpers ──────────────────────────────────────────────────────────

const catalogIndex = new Map(CATALOG.map((m) => [m.id, m]))

export function findModel(id: string): ModelEntry | undefined {
  return catalogIndex.get(id)
}
