// Single source of truth for all image and video generation models.
// Every model's provider, pricing, features, and generation strategy lives here.
// Other modules derive their data from this catalog — no separate registries.
//
// To add a model: add an entry to CATALOG with the right shared fragment spread.
// To update pricing: change the cost field on the model entry.
// To add a provider: create a new shared fragment and add models using it.
//
// Provider option schemas are sourced from the @ai-sdk/* packages and upstream API docs.
// Each shared fragment has a URL comment pointing to the source of truth so options
// are easy to verify and update when providers change their APIs.
//
// Sources:
//   xAI image:  node_modules/@ai-sdk/xai/dist/index.d.ts → xaiImageModelOptions
//               https://docs.x.ai/docs/api-reference#create-image
//   xAI video:  node_modules/@ai-sdk/xai/dist/index.d.ts → XaiVideoModelOptions
//               https://docs.x.ai/docs/api-reference#create-video
//   OpenAI:     node_modules/@ai-sdk/openai/dist/index.d.ts → imageGeneration args
//               https://platform.openai.com/docs/api-reference/images
//   Fal image:  https://ai-sdk.dev/providers/ai-sdk-providers/fal
//               node_modules/@ai-sdk/fal/dist/index.d.ts → FalImageModelOptions
//   Fal video:  node_modules/@ai-sdk/fal/dist/index.d.ts → FalVideoModelOptions
//               https://ai-sdk.dev/providers/ai-sdk-providers/fal

// ─── cost types ──────────────────────────────────────────────────────────────

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

export type VideoDurationPricingTier = {
  /** USD per second for this variant */
  costPerSecond: number
  /** Optional resolution discriminator (e.g. 720p, 1080p, 4k) */
  resolution?: string
  /** Optional mode discriminator (e.g. std, pro) */
  mode?: string
  /** Optional audio discriminator */
  audio?: boolean
  /** Optional discriminator for whether image/video input is present (i2v/r2v vs t2v) */
  hasVideoInput?: boolean
}

export type PerVideoSecondCost = {
  type: 'per-video-second'
  /** Fallback duration when request does not specify one (seconds) */
  defaultDurationSec: number
  tiers: VideoDurationPricingTier[]
}

export type UnknownCost = {
  type: 'unknown'
}

export type ModelCost = PerImageCost | PerTokenCost
export type VideoModelCost = PerVideoSecondCost | UnknownCost
export type AnyCost = ModelCost | VideoModelCost

// ─── provider option types ───────────────────────────────────────────────────
// Declares provider-specific options that can be passed via providerOptions.
// Lives in the catalog so CLI flag descriptions and validation are derived
// from a single source of truth.

export type ProviderOption = {
  /** CLI flag name, e.g. 'quality', 'output-format' */
  flag: string
  /** The key sent to providerOptions.{provider}.{key} */
  providerKey: string
  /** Human description for --help */
  description: string
  /** Enum values if constrained, shown in flag description */
  values?: string[]
  /** Server-side default when not specified */
  defaultValue?: string
  /** Value type */
  type: 'string' | 'number' | 'boolean'
  /** Whether this flag accepts multiple values (array) */
  array?: boolean
}

// ─── feature types ───────────────────────────────────────────────────────────

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

export type VideoModelFeatures = {
  /** Supports text prompt to video generation */
  textToVideo: boolean
  /** Supports image-to-video prompt object ({ image, text }) */
  imageToVideo: boolean
  /** Optional capabilities exposed by provider */
  capabilities: Array<'t2v' | 'i2v' | 'r2v' | 'motion-control' | 'editing' | 'extension'>
  /** Optional supported aspect ratios */
  aspectRatios?: string[]
  /** Optional supported resolutions */
  resolutions?: string[]
  /** Optional duration range in seconds */
  durationRangeSec?: { min: number; max: number }
  seed: boolean
  multipleVideos: boolean
}

// ─── entry types (discriminated union by strategy) ───────────────────────────

export type ImageModelEntry = {
  id: string
  name: string
  description?: string
  provider: string
  strategy: 'image' | 'text'
  /** Release date in YYYY-MM-DD or YYYY-MM format */
  released: string
  cost: ModelCost
  features: ModelFeatures
  /** Provider-specific options passable via providerOptions.{provider} */
  providerOptions?: ProviderOption[]
}

export type VideoModelEntry = {
  id: string
  name: string
  description?: string
  provider: string
  strategy: 'video'
  released: string
  cost: VideoModelCost
  features: VideoModelFeatures
  /** Provider-specific options passable via providerOptions.{provider} */
  providerOptions?: ProviderOption[]
}

/** @deprecated Use ImageModelEntry instead */
export type ModelEntry = ImageModelEntry

export type { SpeechModelEntry } from './speech-catalog.js'

export type AnyModelEntry = ImageModelEntry | VideoModelEntry

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

// Source: node_modules/@ai-sdk/openai/dist/index.d.ts → imageGeneration args
// Docs:   https://platform.openai.com/docs/api-reference/images/create
const openaiImageProviderOptions: ProviderOption[] = [
  { flag: 'quality', providerKey: 'quality', description: 'Image quality', values: ['auto', 'low', 'medium', 'high'], defaultValue: 'auto', type: 'string' },
  { flag: 'output-format', providerKey: 'outputFormat', description: 'Output format', values: ['png', 'jpeg', 'webp'], defaultValue: 'png', type: 'string' },
]

const openaiImage = {
  provider: 'openai',
  strategy: 'image' as const,
  providerOptions: openaiImageProviderOptions,
}

// GPT Image 2.5 models add `xhigh` and `max` quality levels.
// Docs: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
const openaiImage25ProviderOptions: ProviderOption[] = [
  { flag: 'quality', providerKey: 'quality', description: 'Image quality', values: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], defaultValue: 'auto', type: 'string' },
  { flag: 'output-format', providerKey: 'outputFormat', description: 'Output format', values: ['png', 'jpeg', 'webp'], defaultValue: 'png', type: 'string' },
]

const openaiImage25 = {
  ...openaiImage,
  providerOptions: openaiImage25ProviderOptions,
}

const replicateImage = {
  provider: 'replicate',
  strategy: 'image' as const,
}

// Source: node_modules/@ai-sdk/fal/dist/index.d.ts → FalImageModelOptions (lazy passthrough)
// Docs:   https://ai-sdk.dev/providers/ai-sdk-providers/fal#provider-options
const falImageProviderOptions: ProviderOption[] = [
  { flag: 'output-format', providerKey: 'outputFormat', description: 'Output format', values: ['png', 'jpeg'], type: 'string' },
  { flag: 'negative-prompt', providerKey: 'negativePrompt', description: 'What to avoid in the image', type: 'string' },
]

const falImage = {
  provider: 'fal',
  strategy: 'image' as const,
  providerOptions: falImageProviderOptions,
}

const bflImage = {
  provider: 'bfl',
  strategy: 'image' as const,
}

const recraftImage = {
  provider: 'recraft',
  strategy: 'image' as const,
}

// Source: node_modules/@ai-sdk/xai/dist/index.d.ts → xaiImageModelOptions
// Docs:   https://docs.x.ai/docs/api-reference#create-image
const xaiImageProviderOptions: ProviderOption[] = [
  { flag: 'quality', providerKey: 'quality', description: 'Image quality', values: ['low', 'medium', 'high'], defaultValue: 'medium', type: 'string' },
  { flag: 'resolution', providerKey: 'resolution', description: 'Output resolution', values: ['1k', '2k'], defaultValue: '1k', type: 'string' },
  { flag: 'output-format', providerKey: 'output_format', description: 'Output format', values: ['png', 'jpeg'], defaultValue: 'png', type: 'string' },
]

const xaiImage = {
  provider: 'xai',
  strategy: 'image' as const,
  providerOptions: xaiImageProviderOptions,
}

// Docs: https://docs.x.ai/developers/model-capabilities/images/generation
// quality is only honored by grok-imagine-image-2.0. 'auto' is the server default
// (low for generation, medium for editing), so egaki omits the field for 'auto'.
const xaiImage2ProviderOptions: ProviderOption[] = [
  { flag: 'quality', providerKey: 'quality', description: 'Image quality', values: ['auto', 'low', 'medium'], defaultValue: 'auto', type: 'string' },
  { flag: 'resolution', providerKey: 'resolution', description: 'Output resolution', values: ['1k', '2k'], defaultValue: '1k', type: 'string' },
  { flag: 'output-format', providerKey: 'output_format', description: 'Output format', values: ['png', 'jpeg'], defaultValue: 'png', type: 'string' },
]

// Source: node_modules/@ai-sdk/xai/dist/index.d.ts → XaiVideoModelOptions
// Docs:   https://docs.x.ai/docs/api-reference#create-video
const xaiVideoProviderOptions: ProviderOption[] = [
  { flag: 'resolution', providerKey: 'resolution', description: 'Output resolution', values: ['480p', '720p'], defaultValue: '720p', type: 'string' },
  { flag: 'mode', providerKey: 'mode', description: 'Video operation mode', values: ['edit-video', 'extend-video', 'reference-to-video'], type: 'string' },
  // video-url is not a CLI flag; it's set internally from --input in edit/extend modes.
  // Kept here so findProviderOption() can verify the model supports it and resolve the correct providerKey.
  { flag: 'video-url', providerKey: 'videoUrl', description: 'Source video URL for editing or extension (internal)', type: 'string' },
  { flag: 'reference-images', providerKey: 'referenceImageUrls', description: 'Reference images for R2V (1-7 files or URLs)', type: 'string', array: true },
]

// Docs: https://docs.x.ai/developers/model-capabilities/video/overview
// grok-imagine-video-1.5: T2V/I2V at native 1080p, R2V up to 720p with up to 14 references.
// No editing or extension. Preset voices (reference_audios), last_frame and keyframes exist
// on the REST API but are not exposed by @ai-sdk/xai yet.
const xaiVideo15ProviderOptions: ProviderOption[] = [
  { flag: 'resolution', providerKey: 'resolution', description: 'Output resolution (R2V is capped at 720p)', values: ['480p', '720p', '1080p'], defaultValue: '720p', type: 'string' },
  { flag: 'mode', providerKey: 'mode', description: 'Video operation mode', values: ['reference-to-video'], type: 'string' },
  { flag: 'reference-images', providerKey: 'referenceImageUrls', description: 'Reference images for R2V (1-14 files or URLs)', type: 'string', array: true },
]

// grok-imagine-video-1.5-lite: T2V/I2V only. 1080p is upscaled from 720p.
const xaiVideo15LiteProviderOptions: ProviderOption[] = [
  { flag: 'resolution', providerKey: 'resolution', description: 'Output resolution (1080p is upscaled from 720p)', values: ['480p', '720p', '1080p'], defaultValue: '720p', type: 'string' },
]

// Source: node_modules/@ai-sdk/bytedance/dist/index.d.ts → ByteDanceVideoProviderOptions
// Docs:   https://sdk.vercel.ai/docs/providers/bytedance
const bytedanceVideoProviderOptions: ProviderOption[] = [
  { flag: 'resolution', providerKey: 'resolution', description: 'Output resolution', values: ['480p', '720p', '1080p'], type: 'string' },
  { flag: 'reference-images', providerKey: 'referenceImages', description: 'Reference images for R2V (1-9 files or URLs, use @Image1 etc. in prompt)', type: 'string', array: true },
  { flag: 'watermark', providerKey: 'watermark', description: 'Add watermark to video', type: 'boolean' },
  { flag: 'generate-audio', providerKey: 'generateAudio', description: 'Generate synchronized audio', type: 'boolean' },
]

// Source: node_modules/@ai-sdk/fal/dist/index.d.ts → FalVideoModelOptions
// Docs:   https://ai-sdk.dev/providers/ai-sdk-providers/fal
const falVideoProviderOptions: ProviderOption[] = [
  { flag: 'negative-prompt', providerKey: 'negativePrompt', description: 'What to avoid in the video', type: 'string' },
]

const vertexImagen = {
  provider: 'vertex',
  strategy: 'image' as const,
  features: {
    ...googleImagen.features,
  },
}

const vertexText = {
  provider: 'vertex',
  strategy: 'text' as const,
  features: {
    ...googleText.features,
  },
}

const fluxAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9', '9:21', '21:9']

// ─── catalog ─────────────────────────────────────────────────────────────────

export const CATALOG: ModelEntry[] = [
  // ── Google: Imagen ─────────────────────────────────────────────────────
  {
    id: 'imagen-4.0-generate-001',
    name: 'Imagen 4',
    released: '2025-08-15',
    ...googleImagen,
    cost: { type: 'per-image', perImage: 0.04 },
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    name: 'Imagen 4 Ultra',
    released: '2025-08-15',
    ...googleImagen,
    cost: { type: 'per-image', perImage: 0.06 },
  },
  {
    id: 'imagen-4.0-fast-generate-001',
    name: 'Imagen 4 Fast',
    released: '2025-08-15',
    ...googleImagen,
    cost: { type: 'per-image', perImage: 0.02 },
  },

  // ── Google: Gemini text+image ──────────────────────────────────────────
  {
    id: 'gemini-2.0-flash-exp-image-generation',
    name: 'Gemini 2.0 Flash (Image)',
    released: '2025-03',
    ...googleText,
    cost: { type: 'per-token', inputPerM: 0.1, outputPerM: 0.4 },
  },
  {
    id: 'gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    released: '2025-08-26',
    ...googleText,
    cost: { type: 'per-token', inputPerM: 0.3, outputPerM: 30 },
  },
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image',
    released: '2025-11-20',
    ...googleText,
    cost: { type: 'per-token', inputPerM: 1.25, outputPerM: 10 },
  },
  {
    id: 'nano-banana-pro-preview',
    name: 'Nano Banana Pro',
    description:
      'Nano Banana Pro — the high-fidelity variant in the Nano Banana line, built on the ' +
      'Gemini Pro backbone. Best for complex scenes requiring maximum quality at the expense ' +
      'of higher cost and slower speed. Still the best fit for specialized high-fidelity tasks ' +
      'where Nano Banana 2 trades off some quality for much faster, cheaper generation.',
    released: '2025-11-20',
    ...googleText,
    cost: { type: 'per-token', inputPerM: 0.3, outputPerM: 30 },
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash Image (Nano Banana 2)',
    description:
      'Nano Banana 2 — high-efficiency successor in the Nano Banana line. Targets Pro-like ' +
      'quality with faster iteration and lower cost. Built on Gemini 3.1 Flash backbone. ' +
      'Key upgrades: consistent rendering of up to 5 characters per workflow, new native ' +
      'aspect ratios (4:1, 1:4, 8:1, 1:8), resolutions from 512px to 4K, improved text ' +
      'rendering and in-image localization. Nano Banana Pro remains the best fit for ' +
      'specialized high-fidelity tasks.',
    released: '2026-02-26',
    ...googleText,
    features: {
      ...googleText.features,
      aspectRatios: [
        ...googleText.features.aspectRatios,
        '4:1',
        '1:4',
        '8:1',
        '1:8',
      ],
    },
    cost: { type: 'per-token', inputPerM: 0.5, outputPerM: 3.0 },
  },

  // ── Vertex: Imagen ──────────────────────────────────────────────────────
  // Same models as Google AI Studio but routed through Vertex AI / Google Cloud billing.
  // Use `egaki login --provider vertex --key <key>` to configure.
  {
    id: 'vertex/imagen-4.0-generate-001',
    name: 'Imagen 4 (Vertex)',
    released: '2025-08-15',
    ...vertexImagen,
    cost: { type: 'per-image', perImage: 0.04 },
  },
  {
    id: 'vertex/imagen-4.0-ultra-generate-001',
    name: 'Imagen 4 Ultra (Vertex)',
    released: '2025-08-15',
    ...vertexImagen,
    cost: { type: 'per-image', perImage: 0.06 },
  },
  {
    id: 'vertex/imagen-4.0-fast-generate-001',
    name: 'Imagen 4 Fast (Vertex)',
    released: '2025-08-15',
    ...vertexImagen,
    cost: { type: 'per-image', perImage: 0.02 },
  },

  // ── Vertex: Gemini text+image ─────────────────────────────────────────
  {
    id: 'vertex/gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image (Vertex)',
    released: '2025-08-26',
    ...vertexText,
    cost: { type: 'per-token', inputPerM: 0.3, outputPerM: 30 },
  },
  {
    id: 'vertex/gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image (Vertex)',
    released: '2025-11-20',
    ...vertexText,
    cost: { type: 'per-token', inputPerM: 1.25, outputPerM: 10 },
  },
  {
    id: 'vertex/gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash Image (Vertex)',
    released: '2026-02-26',
    ...vertexText,
    features: {
      ...vertexText.features,
      aspectRatios: [
        ...vertexText.features.aspectRatios,
        '4:1',
        '1:4',
        '8:1',
        '1:8',
      ],
    },
    cost: { type: 'per-token', inputPerM: 0.5, outputPerM: 3.0 },
  },

  // ── BFL (AI Gateway) ───────────────────────────────────────────────────
  {
    id: 'flux-kontext-max',
    name: 'FLUX Kontext Max',
    released: '2025-06-12',
    ...bflImage,
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
    id: 'flux-kontext-pro',
    name: 'FLUX Kontext Pro',
    released: '2025-06-12',
    ...bflImage,
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
    id: 'flux-pro-1.0-fill',
    name: 'FLUX Pro 1.0 Fill',
    released: '2024-10-15',
    ...bflImage,
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
    id: 'flux-pro-1.1',
    name: 'FLUX Pro 1.1',
    released: '2024-10-01',
    ...bflImage,
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
    id: 'flux-pro-1.1-ultra',
    name: 'FLUX Pro 1.1 Ultra',
    released: '2024-11-06',
    ...bflImage,
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
    id: 'flux-2-pro',
    name: 'FLUX.2 Pro',
    released: '2025-12',
    ...bflImage,
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
    id: 'flux-2-max',
    name: 'FLUX.2 Max',
    released: '2025-12',
    ...bflImage,
    cost: { type: 'per-image', perImage: 0.07 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'flux-2-flex',
    name: 'FLUX.2 Flex',
    released: '2025-12',
    ...bflImage,
    cost: { type: 'per-image', perImage: 0.05 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'flux-2-klein-9b',
    name: 'FLUX.2 Klein 9B',
    released: '2025-12',
    ...bflImage,
    cost: { type: 'per-image', perImage: 0.015 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'flux-2-klein-4b',
    name: 'FLUX.2 Klein 4B',
    released: '2025-12',
    ...bflImage,
    cost: { type: 'per-image', perImage: 0.014 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },

  // ── Recraft (AI Gateway) ───────────────────────────────────────────────
  {
    id: 'recraft-v2',
    name: 'Recraft v2',
    released: '2024-08-19',
    ...recraftImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'recraft-v3',
    name: 'Recraft v3 (AI Gateway)',
    released: '2024-10-29',
    ...recraftImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'recraft-v4',
    name: 'Recraft v4',
    released: '2025-10-08',
    ...recraftImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'recraft-v4-pro',
    name: 'Recraft v4 Pro',
    released: '2025-10-08',
    ...recraftImage,
    cost: { type: 'per-image', perImage: 0.25 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },

  {
    id: 'recraft-v4.1',
    name: 'Recraft v4.1',
    released: '2026-05',
    ...recraftImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'recraft-v4.1-pro',
    name: 'Recraft v4.1 Pro',
    released: '2026-05',
    ...recraftImage,
    cost: { type: 'per-image', perImage: 0.25 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'recraft-v4.1-utility',
    name: 'Recraft v4.1 Utility',
    released: '2026-05',
    ...recraftImage,
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'recraft-v4.1-utility-pro',
    name: 'Recraft v4.1 Utility Pro',
    released: '2026-05',
    ...recraftImage,
    cost: { type: 'per-image', perImage: 0.25 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },

  // ── ByteDance Seedream (AI Gateway) ────────────────────────────────────
  {
    id: 'seedream-5.0-lite',
    name: 'Seedream 5.0 Lite',
    released: '2026-01',
    provider: 'bytedance',
    strategy: 'image' as const,
    cost: { type: 'per-image' as const, perImage: 0.035 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'seedream-4.5',
    name: 'Seedream 4.5',
    released: '2025-11',
    provider: 'bytedance',
    strategy: 'image' as const,
    cost: { type: 'per-image' as const, perImage: 0.04 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'seedream-4.0',
    name: 'Seedream 4.0',
    released: '2025-08',
    provider: 'bytedance',
    strategy: 'image' as const,
    cost: { type: 'per-image' as const, perImage: 0.03 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: false,
    },
  },

  // ── xAI (AI Gateway) ────────────────────────────────────────────────────
  {
    id: 'grok-imagine-image',
    name: 'Grok Imagine Image',
    released: '2026-03',
    ...xaiImage,
    cost: { type: 'per-image', perImage: 0.02 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: true,
    },
  },
  {
    id: 'grok-imagine-image-2.0',
    name: 'Grok Imagine Image 2.0',
    released: '2026-08',
    ...xaiImage,
    providerOptions: xaiImage2ProviderOptions,
    // $0.04 at low quality (what 'auto' serves for generation); medium is $0.06, 2k costs more.
    cost: { type: 'per-image', perImage: 0.04 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '21:9', '5:2'],
      seed: false,
      multipleImages: true,
    },
  },
  // xAI retires grok-imagine-image-quality on 2026-11-02. After that date, requests to
  // this slug are served by grok-imagine-image-2.0 with quality 'low'.
  {
    id: 'grok-imagine-image-quality',
    name: 'Grok Imagine Image Quality',
    released: '2026-04',
    ...xaiImage,
    cost: { type: 'per-image', perImage: 0.05 },
    features: {
      editing: true,
      inpainting: false,
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
      seed: false,
      multipleImages: true,
    },
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────
  {
    id: 'dall-e-2',
    name: 'DALL-E 2',
    released: '2022-11-03',
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
    released: '2023-10-03',
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
    released: '2025-04-23',
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
    released: '2025-10-06',
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
    released: '2025-12-16',
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
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    description:
      'State-of-the-art image generation model with token-based pricing. ' +
      'Cost varies by quality and size; $0.053 is the medium-quality 1024×1024 estimate.',
    released: '2026-04-21',
    ...openaiImage,
    // Token-based pricing: $30/1M output image tokens. Medium quality 1024×1024 ≈ $0.053.
    cost: { type: 'per-image', perImage: 0.053 },
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
    id: 'gpt-image-2.5-flare',
    name: 'GPT Image 2.5 Flare',
    description:
      'Fastest GPT Image 2.5 model for high-quality everyday generation and editing. ' +
      'Token rates match gpt-image-2; $0.053 is the medium-quality 1024×1024 estimate.',
    released: '2026-09-08',
    ...openaiImage25,
    // Token-based pricing: $30/1M output image tokens, same rates as gpt-image-2.
    cost: { type: 'per-image', perImage: 0.053 },
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
    id: 'gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    description:
      'Most capable GPT Image 2.5 model, for work where editing precision and reference ' +
      'fidelity matter most. Slower than Flare. Token rates match gpt-image-2; actual cost ' +
      'is usually higher because it spends more tokens per image.',
    released: '2026-09-08',
    ...openaiImage25,
    // Token-based pricing: $30/1M output image tokens, same rates as gpt-image-2.
    cost: { type: 'per-image', perImage: 0.053 },
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
    id: 'chatgpt-image-latest',
    name: 'ChatGPT Image',
    description:
      'Rolling-latest alias that tracks the newest ChatGPT image model. Currently points ' +
      'to gpt-image-2. Pricing may shift when the alias retargets to a newer model.',
    released: '2026-01',
    ...openaiImage,
    // Matches gpt-image-2 medium quality 1024×1024 estimate.
    cost: { type: 'per-image', perImage: 0.053 },
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
    released: '2024-10-01',
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
    released: '2024-11-06',
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
    released: '2025-11-25',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.015 },
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
    released: '2025-11-25',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.012 },
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
    released: '2024-08-01',
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
    released: '2024-08-01',
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
    id: 'black-forest-labs/flux-schnell',
    name: 'Flux Schnell',
    released: '2024-08-01',
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
    released: '2024-10-15',
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
    released: '2024-10-15',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.04 },
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
    released: '2024-08-19',
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
    released: '2024-08-19',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.05 },
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
    released: '2024-10-29',
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
    released: '2024-10-29',
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
    id: 'stability-ai/stable-diffusion-3.5-large',
    name: 'SD 3.5 Large',
    released: '2024-10-22',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.065 },
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
    released: '2024-10-22',
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
    id: 'stability-ai/stable-diffusion-3.5-medium',
    name: 'SD 3.5 Medium',
    released: '2024-10-29',
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
    id: 'luma/photon',
    name: 'Luma Photon',
    released: '2024-12-10',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.03 },
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
    released: '2024-12-10',
    ...replicateImage,
    cost: { type: 'per-image', perImage: 0.01 },
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
    released: '2024-11-27',
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
    released: '2024-08-01',
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
    released: '2024-08-01',
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
    released: '2025-01',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.075 },
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
    released: '2025-01',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.075 },
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
    released: '2025-01',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.075 },
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
    released: '2024-10-01',
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
    released: '2024-11-06',
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
    released: '2025-06-12',
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
    released: '2025-06-12',
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
    released: '2024-09',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.035 },
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
    released: '2024-10-29',
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
    released: '2024-10-29',
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
    released: '2025-03',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.10 },
    features: {
      editing: true,
      inpainting: true,
      aspectRatios: fluxAspectRatios,
      seed: true,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/imagen4/preview',
    name: 'Imagen 4 (Fal)',
    released: '2025-08-15',
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
    released: '2024-12-10',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.019 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/luma-photon/flash',
    name: 'Luma Photon Flash (Fal)',
    released: '2024-12-10',
    ...falImage,
    cost: { type: 'per-image', perImage: 0.005 },
    features: {
      editing: false,
      inpainting: false,
      aspectRatios: fluxAspectRatios,
      seed: false,
      multipleImages: false,
    },
  },
  {
    id: 'fal-ai/omnigen-v2',
    name: 'OmniGen v2',
    released: '2025-06',
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
    released: '2025-06',
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

// ─── video catalog ───────────────────────────────────────────────────────────

const commonVideoRatios = ['16:9', '9:16', '1:1', '4:3', '3:4']

export const VIDEO_CATALOG: VideoModelEntry[] = [
  {
    id: 'veo-3.1-generate-001',
    name: 'Veo 3.1',
    provider: 'google',
    strategy: 'video',
    released: '2026-01',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.2 },
        { resolution: '720p', audio: true, costPerSecond: 0.4 },
        { resolution: '1080p', audio: false, costPerSecond: 0.2 },
        { resolution: '1080p', audio: true, costPerSecond: 0.4 },
        { resolution: '4k', audio: false, costPerSecond: 0.4 },
        { resolution: '4k', audio: true, costPerSecond: 0.6 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p', '4k'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  {
    id: 'veo-3.1-fast-generate-001',
    name: 'Veo 3.1 Fast',
    provider: 'google',
    strategy: 'video',
    released: '2026-01',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.1 },
        { resolution: '720p', audio: true, costPerSecond: 0.15 },
        { resolution: '1080p', audio: false, costPerSecond: 0.1 },
        { resolution: '1080p', audio: true, costPerSecond: 0.15 },
        { resolution: '4k', audio: false, costPerSecond: 0.3 },
        { resolution: '4k', audio: true, costPerSecond: 0.35 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p', '4k'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  {
    id: 'veo-3.0-generate-001',
    name: 'Veo 3.0',
    provider: 'google',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.2 },
        { resolution: '720p', audio: true, costPerSecond: 0.4 },
        { resolution: '1080p', audio: false, costPerSecond: 0.2 },
        { resolution: '1080p', audio: true, costPerSecond: 0.4 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  {
    id: 'veo-3.0-fast-generate-001',
    name: 'Veo 3.0 Fast',
    provider: 'google',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.1 },
        { resolution: '720p', audio: true, costPerSecond: 0.15 },
        { resolution: '1080p', audio: false, costPerSecond: 0.1 },
        { resolution: '1080p', audio: true, costPerSecond: 0.15 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  // ── Vertex: Veo ──────────────────────────────────────────────────────
  {
    id: 'vertex/veo-3.1-generate-001',
    name: 'Veo 3.1 (Vertex)',
    provider: 'vertex',
    strategy: 'video',
    released: '2026-01',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.2 },
        { resolution: '720p', audio: true, costPerSecond: 0.4 },
        { resolution: '1080p', audio: false, costPerSecond: 0.2 },
        { resolution: '1080p', audio: true, costPerSecond: 0.4 },
        { resolution: '4k', audio: false, costPerSecond: 0.4 },
        { resolution: '4k', audio: true, costPerSecond: 0.6 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p', '4k'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  {
    id: 'vertex/veo-3.1-fast-generate-001',
    name: 'Veo 3.1 Fast (Vertex)',
    provider: 'vertex',
    strategy: 'video',
    released: '2026-01',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.1 },
        { resolution: '720p', audio: true, costPerSecond: 0.15 },
        { resolution: '1080p', audio: false, costPerSecond: 0.1 },
        { resolution: '1080p', audio: true, costPerSecond: 0.15 },
        { resolution: '4k', audio: false, costPerSecond: 0.3 },
        { resolution: '4k', audio: true, costPerSecond: 0.35 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p', '4k'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  {
    id: 'grok-imagine-video',
    name: 'Grok Imagine Video',
    provider: 'xai',
    strategy: 'video',
    released: '2026-03',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', costPerSecond: 0.05 },
        { resolution: '720p', costPerSecond: 0.07 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v', 'editing', 'extension', 'r2v'],
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
      resolutions: ['480p', '720p'],
      durationRangeSec: { min: 1, max: 15 },
      seed: false,
      multipleVideos: false,
    },
    providerOptions: xaiVideoProviderOptions,
  },
  {
    id: 'grok-imagine-video-1.5',
    name: 'Grok Imagine Video 1.5',
    provider: 'xai',
    strategy: 'video',
    released: '2026-05',
    // Source: https://ai-gateway.vercel.sh/v1/models (spacexai/grok-imagine-video-1.5)
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', costPerSecond: 0.08 },
        { resolution: '720p', costPerSecond: 0.14 },
        { resolution: '1080p', costPerSecond: 0.25 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v', 'r2v'],
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'],
      resolutions: ['480p', '720p', '1080p'],
      durationRangeSec: { min: 1, max: 15 },
      seed: false,
      multipleVideos: false,
    },
    providerOptions: xaiVideo15ProviderOptions,
  },
  {
    id: 'grok-imagine-video-1.5-lite',
    name: 'Grok Imagine Video 1.5 Lite',
    provider: 'xai',
    strategy: 'video',
    released: '2026-10-08',
    // Source: https://ai-gateway.vercel.sh/v1/models (spacexai/grok-imagine-video-1.5-lite)
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', costPerSecond: 0.02 },
        { resolution: '720p', costPerSecond: 0.03 },
        { resolution: '1080p', costPerSecond: 0.14 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v'],
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'],
      resolutions: ['480p', '720p', '1080p'],
      durationRangeSec: { min: 1, max: 15 },
      seed: false,
      multipleVideos: false,
    },
    providerOptions: xaiVideo15LiteProviderOptions,
  },
  // ── Kling (AI Gateway) ──────────────────────────────────────────────
  // Source: https://ai-gateway.vercel.sh/v1/models (klingai/* entries)
  {
    id: 'kling-v3.0-t2v',
    name: 'Kling v3.0 T2V',
    provider: 'klingai',
    strategy: 'video',
    released: '2026-02',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { mode: 'std', audio: false, costPerSecond: 0.168 },
        { mode: 'std', audio: true, costPerSecond: 0.308 },
        { mode: 'pro', audio: false, costPerSecond: 0.224 },
        { mode: 'pro', audio: true, costPerSecond: 0.392 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p', '4k'],
      durationRangeSec: { min: 3, max: 15 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'kling-v3.0-i2v',
    name: 'Kling v3.0 I2V',
    provider: 'klingai',
    strategy: 'video',
    released: '2026-02',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { mode: 'std', audio: false, costPerSecond: 0.168 },
        { mode: 'std', audio: true, costPerSecond: 0.308 },
        { mode: 'pro', audio: false, costPerSecond: 0.224 },
        { mode: 'pro', audio: true, costPerSecond: 0.392 },
      ],
    },
    features: {
      textToVideo: false,
      imageToVideo: true,
      capabilities: ['i2v', 'r2v'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p', '4k'],
      durationRangeSec: { min: 3, max: 15 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'kling-v3.0-motion-control',
    name: 'Kling v3.0 Motion Control',
    provider: 'klingai',
    strategy: 'video',
    released: '2026-03',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { mode: 'std', costPerSecond: 0.126 },
        { mode: 'pro', costPerSecond: 0.168 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v', 'motion-control'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'kling-v2.6-t2v',
    name: 'Kling v2.6 T2V',
    provider: 'klingai',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { mode: 'std', costPerSecond: 0.042 },
        { mode: 'pro', audio: false, costPerSecond: 0.07 },
        { mode: 'pro', audio: true, costPerSecond: 0.14 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: commonVideoRatios,
      durationRangeSec: { min: 5, max: 10 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'kling-v2.6-i2v',
    name: 'Kling v2.6 I2V',
    provider: 'klingai',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { mode: 'std', costPerSecond: 0.042 },
        { mode: 'pro', audio: false, costPerSecond: 0.07 },
        { mode: 'pro', audio: true, costPerSecond: 0.14 },
      ],
    },
    features: {
      textToVideo: false,
      imageToVideo: true,
      capabilities: ['i2v'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 5, max: 10 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'kling-v2.6-motion-control',
    name: 'Kling v2.6 Motion Control',
    provider: 'klingai',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { mode: 'std', costPerSecond: 0.07 },
        { mode: 'pro', costPerSecond: 0.112 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v', 'motion-control'],
      aspectRatios: commonVideoRatios,
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'kling-v2.5-turbo-t2v',
    name: 'Kling v2.5 Turbo T2V',
    provider: 'klingai',
    strategy: 'video',
    released: '2025-09',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { mode: 'std', costPerSecond: 0.042 },
        { mode: 'pro', costPerSecond: 0.07 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: commonVideoRatios,
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'kling-v2.5-turbo-i2v',
    name: 'Kling v2.5 Turbo I2V',
    provider: 'klingai',
    strategy: 'video',
    released: '2025-09',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { mode: 'std', costPerSecond: 0.042 },
        { mode: 'pro', costPerSecond: 0.07 },
      ],
    },
    features: {
      textToVideo: false,
      imageToVideo: true,
      capabilities: ['i2v'],
      aspectRatios: commonVideoRatios,
      seed: false,
      multipleVideos: false,
    },
  },
  // ── Alibaba Wan (AI Gateway) ──────────────────────────────────────────
  {
    id: 'wan-v2.6-t2v',
    name: 'Wan v2.6 T2V',
    provider: 'alibaba',
    strategy: 'video',
    released: '2026-01',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '720p', costPerSecond: 0.1 },
        { resolution: '1080p', costPerSecond: 0.15 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 2, max: 15 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'wan-v2.6-i2v',
    name: 'Wan v2.6 I2V',
    provider: 'alibaba',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '720p', costPerSecond: 0.1 },
        { resolution: '1080p', costPerSecond: 0.15 },
      ],
    },
    features: {
      textToVideo: false,
      imageToVideo: true,
      capabilities: ['i2v'],
      aspectRatios: commonVideoRatios,
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 2, max: 15 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'wan-v2.6-i2v-flash',
    name: 'Wan v2.6 I2V Flash',
    provider: 'alibaba',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '720p', costPerSecond: 0.05 },
        { resolution: '1080p', costPerSecond: 0.075 },
      ],
    },
    features: {
      textToVideo: false,
      imageToVideo: true,
      capabilities: ['i2v'],
      aspectRatios: commonVideoRatios,
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 2, max: 15 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'wan-v2.6-r2v',
    name: 'Wan v2.6 R2V',
    provider: 'alibaba',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '720p', costPerSecond: 0.1 },
        { resolution: '1080p', costPerSecond: 0.15 },
      ],
    },
    features: {
      textToVideo: false,
      imageToVideo: false,
      capabilities: ['r2v'],
      aspectRatios: commonVideoRatios,
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 2, max: 10 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'wan-v2.6-r2v-flash',
    name: 'Wan v2.6 R2V Flash',
    provider: 'alibaba',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '720p', costPerSecond: 0.05 },
        { resolution: '1080p', costPerSecond: 0.075 },
      ],
    },
    features: {
      textToVideo: false,
      imageToVideo: false,
      capabilities: ['r2v'],
      aspectRatios: commonVideoRatios,
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 2, max: 10 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'wan-v2.5-t2v-preview',
    name: 'Wan v2.5 T2V Preview',
    provider: 'alibaba',
    strategy: 'video',
    released: '2025-09',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', costPerSecond: 0.05 },
        { resolution: '720p', costPerSecond: 0.1 },
        { resolution: '1080p', costPerSecond: 0.15 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      resolutions: ['480p', '720p', '1080p'],
      seed: false,
      multipleVideos: false,
    },
  },
  // ── ByteDance Seedance (AI Gateway) ─────────────────────────────────
  // Source: https://ai-gateway.vercel.sh/v1/models/bytedance/seedance-2.0/endpoints
  // Pricing from capabilities.pricing.variants (per-second, resolution-based).
  // Seedance 2.0 uses C-Dense unified multimodal architecture: text, image, audio, video inputs.
  // Reference images for r2v must be passed as URLs (max 9 images, 300-6000px, max 30MB each).
  // Reference images in prompts use @Image1, @Image2, etc. syntax.
  {
    id: 'seedance-2.0',
    name: 'Seedance 2.0',
    description:
      'ByteDance C-Dense multimodal video model. Supports text, image, audio, and video inputs. ' +
      'Native audio generation with lip-sync. Up to 720p, 4-15s.',
    provider: 'bytedance',
    strategy: 'video',
    released: '2026-04',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '480p', hasVideoInput: false, costPerSecond: 0.07 },
        { resolution: '480p', hasVideoInput: true, costPerSecond: 0.12 },
        { resolution: '720p', hasVideoInput: false, costPerSecond: 0.15 },
        { resolution: '720p', hasVideoInput: true, costPerSecond: 0.26 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v', 'r2v'],
      aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      resolutions: ['480p', '720p'],
      durationRangeSec: { min: 4, max: 15 },
      seed: false,
      multipleVideos: false,
    },
    providerOptions: bytedanceVideoProviderOptions,
  },
  {
    id: 'seedance-2.0-fast',
    name: 'Seedance 2.0 Fast',
    description:
      'Faster variant of Seedance 2.0 with same capabilities but lower latency and cost.',
    provider: 'bytedance',
    strategy: 'video',
    released: '2026-04',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '480p', hasVideoInput: false, costPerSecond: 0.05 },
        { resolution: '480p', hasVideoInput: true, costPerSecond: 0.09 },
        { resolution: '720p', hasVideoInput: false, costPerSecond: 0.12 },
        { resolution: '720p', hasVideoInput: true, costPerSecond: 0.20 },
      ],
    },
    providerOptions: bytedanceVideoProviderOptions,
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v', 'r2v'],
      aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      resolutions: ['480p', '720p'],
      durationRangeSec: { min: 4, max: 15 },
      seed: false,
      multipleVideos: false,
    },
  },

  {
    id: 'seedance-v1.5-pro',
    name: 'Seedance v1.5 Pro',
    description:
      'V2A native audio-video joint generation. Synchronized audio output for professional video creation.',
    provider: 'bytedance',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', audio: false, costPerSecond: 0.0121 },
        { resolution: '480p', audio: true, costPerSecond: 0.0241 },
        { resolution: '720p', audio: false, costPerSecond: 0.0259 },
        { resolution: '720p', audio: true, costPerSecond: 0.0518 },
        { resolution: '1080p', audio: false, costPerSecond: 0.0583 },
        { resolution: '1080p', audio: true, costPerSecond: 0.1166 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v'],
      aspectRatios: commonVideoRatios,
      resolutions: ['480p', '720p', '1080p'],
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'seedance-v1.0-pro',
    name: 'Seedance v1.0 Pro',
    description:
      'Multi-shot storytelling model. Smooth, detailed, cinematic 1080p HD videos.',
    provider: 'bytedance',
    strategy: 'video',
    released: '2025-06',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', costPerSecond: 0.0243 },
        { resolution: '720p', costPerSecond: 0.0515 },
        { resolution: '1080p', costPerSecond: 0.1224 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v'],
      aspectRatios: commonVideoRatios,
      resolutions: ['480p', '720p', '1080p'],
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'seedance-v1.0-pro-fast',
    name: 'Seedance v1.0 Pro Fast',
    description:
      'Cost-efficient fast variant of Seedance 1.0 Pro.',
    provider: 'bytedance',
    strategy: 'video',
    released: '2025-10',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', costPerSecond: 0.0097 },
        { resolution: '720p', costPerSecond: 0.0206 },
        { resolution: '1080p', costPerSecond: 0.049 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v'],
      aspectRatios: commonVideoRatios,
      resolutions: ['480p', '720p', '1080p'],
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'seedance-v1.0-lite-t2v',
    name: 'Seedance v1.0 Lite T2V',
    description:
      'Lightweight text-to-video model. Balances quality and speed with strong semantic understanding.',
    provider: 'bytedance',
    strategy: 'video',
    released: '2025-06',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', costPerSecond: 0.0175 },
        { resolution: '720p', costPerSecond: 0.0371 },
        { resolution: '1080p', costPerSecond: 0.0881 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: commonVideoRatios,
      resolutions: ['480p', '720p', '1080p'],
      durationRangeSec: { min: 3, max: 12 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'seedance-v1.0-lite-i2v',
    name: 'Seedance v1.0 Lite I2V',
    description:
      'Lightweight image-to-video model. Generates video from image/text with reference image support.',
    provider: 'bytedance',
    strategy: 'video',
    released: '2025-06',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', costPerSecond: 0.0175 },
        { resolution: '720p', costPerSecond: 0.0371 },
        { resolution: '1080p', costPerSecond: 0.0881 },
      ],
    },
    features: {
      textToVideo: false,
      imageToVideo: true,
      capabilities: ['i2v', 'r2v'],
      aspectRatios: commonVideoRatios,
      resolutions: ['480p', '720p', '1080p'],
      durationRangeSec: { min: 3, max: 12 },
      seed: false,
      multipleVideos: false,
    },
    providerOptions: bytedanceVideoProviderOptions,
  },
  // ── Fal video models ─────────────────────────────────────────────────
  {
    id: 'luma-ray-2',
    name: 'Luma Ray 2 (Fal)',
    provider: 'fal',
    strategy: 'video',
    released: '2025-11',
    cost: { type: 'unknown' },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v'],
      aspectRatios: commonVideoRatios,
      seed: true,
      multipleVideos: false,
    },
    providerOptions: falVideoProviderOptions,
  },
  {
    id: 'minimax-video',
    name: 'MiniMax Video (Fal)',
    provider: 'fal',
    strategy: 'video',
    released: '2025-10',
    cost: { type: 'unknown' },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: commonVideoRatios,
      seed: false,
      multipleVideos: false,
    },
    providerOptions: falVideoProviderOptions,
  },
  {
    id: 'hunyuan-video',
    name: 'Hunyuan Video (Fal)',
    provider: 'fal',
    strategy: 'video',
    released: '2025-09',
    cost: { type: 'unknown' },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v'],
      aspectRatios: commonVideoRatios,
      seed: true,
      multipleVideos: false,
    },
    providerOptions: falVideoProviderOptions,
  },
]

// ─── provider option helpers ─────────────────────────────────────────────────

/**
 * Collect the valid values for a CLI flag across all providers in the catalog.
 * Returns a map of provider name → enum values array. Only includes providers
 * that declare values for the given flag. Used by cli.ts to auto-generate
 * flag descriptions like "xAI: low, medium, high. OpenAI: auto, low, medium, high".
 */
export function getProviderValuesForFlag(
  flag: string,
  catalogs: AnyModelEntry[][] = [CATALOG, VIDEO_CATALOG],
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const catalog of catalogs) {
    for (const entry of catalog) {
      if (!entry.providerOptions) continue
      for (const opt of entry.providerOptions) {
        if (opt.flag === flag && opt.values?.length && !result.has(entry.provider)) {
          result.set(entry.provider, opt.values)
        }
      }
    }
  }
  return result
}

/**
 * Build a human-readable description suffix listing provider-specific values
 * for a flag. Includes default values when available.
 * Example: "xai: low, medium, high (default: medium). openai: auto, low, medium, high (default: auto)"
 */
export function describeProviderValues(
  flag: string,
  catalogs?: AnyModelEntry[][],
): string {
  const allCatalogs = catalogs ?? [CATALOG, VIDEO_CATALOG]
  // collect {provider → {values, defaultValue}} for this flag
  const providerInfo = new Map<string, { values: string[]; defaultValue?: string }>()
  for (const catalog of allCatalogs) {
    for (const entry of catalog) {
      if (!entry.providerOptions) continue
      for (const opt of entry.providerOptions) {
        if (opt.flag === flag && opt.values?.length && !providerInfo.has(entry.provider)) {
          providerInfo.set(entry.provider, {
            values: opt.values,
            defaultValue: opt.defaultValue,
          })
        }
      }
    }
  }
  if (providerInfo.size === 0) return ''
  return [...providerInfo.entries()]
    .map(([provider, info]) => {
      const vals = info.values.join(', ')
      const def = info.defaultValue ? ` (default: ${info.defaultValue})` : ''
      return `${provider}: ${vals}${def}`
    })
    .join('. ')
}

/**
 * Find the ProviderOption definition for a given flag and provider from a model entry.
 * Returns undefined if the model doesn't support this flag.
 */
export function findProviderOption(
  entry: AnyModelEntry,
  flag: string,
): ProviderOption | undefined {
  return entry.providerOptions?.find((opt) => opt.flag === flag)
}

// ─── lookup helpers ──────────────────────────────────────────────────────────

const imageCatalogIndex = new Map(CATALOG.map((m) => [m.id, m]))
const videoCatalogIndex = new Map(VIDEO_CATALOG.map((m) => [m.id, m]))

export function findModel(id: string): ImageModelEntry | undefined {
  return imageCatalogIndex.get(id)
}

export function findVideoModel(id: string): VideoModelEntry | undefined {
  return videoCatalogIndex.get(id)
}

export function findAnyModel(id: string): AnyModelEntry | undefined {
  return imageCatalogIndex.get(id) ?? videoCatalogIndex.get(id)
}

// Re-export speech catalog for convenience in CLI code that needs all catalogs.
export { SPEECH_CATALOG, findSpeechModel } from './speech-catalog.js'

// Re-export transcription catalog.
export { TRANSCRIPTION_CATALOG, findTranscriptionModel } from './transcription-catalog.js'
export type { TranscriptionModelEntry } from './transcription-catalog.js'
