// Programmatic API for egaki image and video generation.
// Returns Error | Result (errore style) instead of process.exit/console.error.
//
// Two variants for each function:
//   - `generateImage(opts)` — cached, writes to public/generated/, returns { src: string }
//   - `generateImageUncached(opts)` — raw, returns bytes in GenerateImageResult
//
// The CLI uses *Uncached variants. The cached variants are for the Vite MDX
// video framework and .server.tsx components.
//
// Usage:
//   import { generateImage, generateImageUncached } from 'egaki/generate'
//   const cached = await generateImage({ prompt: 'a sunset' })
//   if (!(cached instanceof Error)) cached.src // '/generated/image/sunset-a1b2c3d4.png'
//   const raw = await generateImageUncached({ prompt: 'a sunset' })
//   if (!(raw instanceof Error)) raw.images[0].uint8Array // raw bytes
import {
  generateImage as aiGenerateImage,
  generateText,
  experimental_generateVideo as aiGenerateVideo,
} from 'ai'
import type { XaiImageModelOptions, XaiVideoModelOptions } from '@ai-sdk/xai'
import type { GoogleImageModelOptions, GoogleLanguageModelOptions, GoogleVideoModelOptions } from '@ai-sdk/google'
import type { GoogleVertexImageModelOptions, GoogleVertexVideoModelOptions } from '@ai-sdk/google-vertex'
import type { FalImageModelOptions, FalVideoModelOptions } from '@ai-sdk/fal'
import type { ByteDanceVideoProviderOptions } from '@ai-sdk/bytedance'
import { createParser, type EventSourceMessage } from 'eventsource-parser'
import {
  injectCredentialsToEnv,
  getChatGptAuth,
  saveChatGptAuth,
} from './credentials.js'
import {
  getModelConfig,
  createImageModel,
  createTextModel,
  createVideoModel,
  shouldUseResponsesApi,
  DEFAULT_MODEL,
  DEFAULT_VIDEO_MODEL,
  ValidationError,
} from './models.js'

export { ValidationError }
import { getValidChatGptAuth } from './chatgpt-auth.js'

// ─── autocomplete-friendly union types ───────────────────────────────────────
// `(string & {})` lets users pass arbitrary strings (new models, custom
// endpoints) while still providing autocomplete for known values.

/** Image model IDs from the catalog. Accepts arbitrary strings too. */
export type ImageModelId =
  | 'imagen-4.0-generate-001' | 'imagen-4.0-ultra-generate-001' | 'imagen-4.0-fast-generate-001'
  | 'gemini-2.0-flash-exp-image-generation' | 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' | 'gemini-3.1-flash-image-preview'
  | 'vertex/imagen-4.0-generate-001' | 'vertex/imagen-4.0-ultra-generate-001' | 'vertex/imagen-4.0-fast-generate-001'
  | 'vertex/gemini-2.5-flash-image' | 'vertex/gemini-3-pro-image-preview' | 'vertex/gemini-3.1-flash-image-preview'
  | 'flux-kontext-max' | 'flux-kontext-pro' | 'flux-pro-1.0-fill' | 'flux-pro-1.1' | 'flux-pro-1.1-ultra'
  | 'flux-2-pro' | 'flux-2-max' | 'flux-2-flex' | 'flux-2-klein-9b' | 'flux-2-klein-4b'
  | 'recraft-v2' | 'recraft-v3' | 'recraft-v4' | 'recraft-v4-pro' | 'recraft-v4.1' | 'recraft-v4.1-pro' | 'recraft-v4.1-utility' | 'recraft-v4.1-utility-pro'
  | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0'
  | 'grok-imagine-image' | 'grok-imagine-image-quality'
  | 'dall-e-2' | 'dall-e-3' | 'gpt-image-1' | 'gpt-image-1-mini' | 'gpt-image-1.5' | 'gpt-image-2' | 'chatgpt-image-latest'
  | (string & {})

/** Video model IDs from the catalog. Accepts arbitrary strings too. */
export type VideoModelId =
  | 'veo-3.1-generate-001' | 'veo-3.1-fast-generate-001' | 'veo-3.0-generate-001' | 'veo-3.0-fast-generate-001'
  | 'vertex/veo-3.1-generate-001' | 'vertex/veo-3.1-fast-generate-001'
  | 'grok-imagine-video' | 'grok-imagine-video-1.5'
  | 'kling-v3.0-t2v' | 'kling-v3.0-i2v' | 'kling-v3.0-motion-control' | 'kling-v2.6-t2v' | 'kling-v2.6-i2v' | 'kling-v2.6-motion-control'
  | 'kling-v2.5-turbo-t2v' | 'kling-v2.5-turbo-i2v'
  | 'wan-v2.6-t2v' | 'wan-v2.6-i2v' | 'wan-v2.6-i2v-flash' | 'wan-v2.6-r2v' | 'wan-v2.6-r2v-flash' | 'wan-v2.5-t2v-preview'
  | 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-v1.5-pro' | 'seedance-v1.0-pro' | 'seedance-v1.0-pro-fast' | 'seedance-v1.0-lite-t2v' | 'seedance-v1.0-lite-i2v'
  | 'luma-ray-2' | 'minimax-video' | 'hunyuan-video'
  | (string & {})

/** Common aspect ratios across providers. */
export type AspectRatio =
  | '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | '2:3' | '3:2' | '4:5' | '5:4' | '9:21' | '21:9'
  | (string & {})

/** Image quality presets (varies by provider). */
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'standard' | (string & {})

/** Image output formats. */
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | (string & {})

// ─── public types ────────────────────────────────────────────────────────────

export type GeneratedFile = {
  uint8Array: Uint8Array
  mediaType: string
}

export interface GenerateImageOptions {
  prompt: string
  /** Model ID. Defaults to DEFAULT_MODEL if omitted. */
  model?: ImageModelId
  count?: number
  aspectRatio?: AspectRatio
  seed?: number
  inputImages?: Uint8Array[]
  maskImage?: Uint8Array
  allowPeople?: boolean
  quality?: ImageQuality
  resolution?: string
  outputFormat?: ImageOutputFormat
  negativePrompt?: string
  /** Only for text-model image generation (Gemini). */
  imageSize?: '1K' | '2K' | '4K'
}

export interface GenerateImageResult {
  images: GeneratedFile[]
  model: string
  cost: number | null
  usage?: { inputTokens?: number; outputTokens?: number }
  warnings?: unknown[]
  /** Text response from text-model path (Gemini). */
  text?: string
  /** Revised prompt from ChatGPT Responses API path. */
  revisedPrompt?: string | null
}

export interface GenerateVideoOptions {
  prompt: string
  /** Model ID. Defaults to DEFAULT_VIDEO_MODEL if omitted. */
  model?: VideoModelId
  count?: number
  aspectRatio?: AspectRatio
  resolution?: string
  duration?: number
  fps?: number
  seed?: number
  inputImage?: Uint8Array
  mode?: 'edit-video' | 'extend-video' | 'reference-to-video'
  /** URL for video editing/extension input. Must be a URL (not a local path). */
  videoUrl?: string
  /** Reference image URLs for r2v generation. Must be URLs (not local paths). */
  referenceImages?: string[]
  negativePrompt?: string
}

export interface GenerateVideoResult {
  videos: GeneratedFile[]
  model: string
  cost: number | null
  warnings?: unknown[]
  /** Raw responses from the AI SDK (provider-specific). */
  responses?: unknown[]
}

// ─── OpenAI provider options type (not exported by @ai-sdk/openai) ───────────

type OpenAIImageProviderOptions = {
  quality?: 'standard' | 'low' | 'medium' | 'high' | 'auto'
  outputFormat?: 'png' | 'jpeg' | 'webp'
  outputCompression?: number
  size?: `${number}x${number}`
  partialImages?: number | null
  background?: 'auto' | 'opaque' | 'transparent'
}

// ─── type-safe provider option builders ──────────────────────────────────────

type ProviderOptionsResult = Record<string, Record<string, string | number | boolean | string[] | null | undefined | Record<string, string | number | boolean | null | undefined>>>

export function buildImageProviderOptions(
  provider: string,
  opts: {
    aspectRatio?: `${number}:${number}`
    allowPeople: boolean
    quality?: string
    resolution?: string
    outputFormat?: string
    negativePrompt?: string
  },
): ProviderOptionsResult {
  switch (provider) {
    case 'google': {
      const googleOpts = {
        ...(opts.allowPeople ? { personGeneration: 'allow_all' as const } : {}),
        ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio as GoogleImageModelOptions['aspectRatio'] } : {}),
      } satisfies GoogleImageModelOptions
      return { google: googleOpts }
    }
    case 'vertex': {
      const vertexOpts = {
        ...(opts.allowPeople ? { personGeneration: 'allow_all' as const } : {}),
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
      } satisfies GoogleVertexImageModelOptions
      return { vertex: vertexOpts }
    }
    case 'xai': {
      const xaiOpts = {
        ...(opts.quality ? { quality: opts.quality as XaiImageModelOptions['quality'] } : {}),
        ...(opts.resolution ? { resolution: opts.resolution as XaiImageModelOptions['resolution'] } : {}),
        ...(opts.outputFormat ? { output_format: opts.outputFormat } : {}),
      } satisfies XaiImageModelOptions
      return { xai: xaiOpts }
    }
    case 'openai': {
      const openaiOpts = {
        ...(opts.quality ? { quality: opts.quality as OpenAIImageProviderOptions['quality'] } : {}),
        ...(opts.outputFormat ? { outputFormat: opts.outputFormat as OpenAIImageProviderOptions['outputFormat'] } : {}),
      } satisfies OpenAIImageProviderOptions
      return { openai: openaiOpts }
    }
    case 'fal': {
      const falOpts = {
        ...(opts.outputFormat ? { outputFormat: opts.outputFormat } : {}),
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
      } satisfies FalImageModelOptions
      return { fal: falOpts }
    }
    default:
      return {}
  }
}

export function buildVideoProviderOptions(
  provider: string,
  opts: {
    resolution?: string
    mode?: string
    videoUrl?: string
    referenceImages?: string[]
    negativePrompt?: string
    model: string
  },
): ProviderOptionsResult | undefined {
  switch (provider) {
    case 'xai': {
      const base = {
        ...(opts.resolution ? { resolution: opts.resolution as '480p' | '720p' } : {}),
      }
      if (opts.mode === 'edit-video' && opts.videoUrl) {
        const xaiOpts = { ...base, mode: 'edit-video' as const, videoUrl: opts.videoUrl } satisfies XaiVideoModelOptions
        return { xai: xaiOpts }
      }
      if (opts.mode === 'extend-video' && opts.videoUrl) {
        const xaiOpts = { ...base, mode: 'extend-video' as const, videoUrl: opts.videoUrl } satisfies XaiVideoModelOptions
        return { xai: xaiOpts }
      }
      if (opts.mode === 'reference-to-video' && opts.referenceImages) {
        const xaiOpts = { ...base, mode: 'reference-to-video' as const, referenceImageUrls: opts.referenceImages } satisfies XaiVideoModelOptions
        return { xai: xaiOpts }
      }
      if (Object.keys(base).length === 0) return undefined
      const xaiOpts = { ...base } satisfies XaiVideoModelOptions
      return { xai: xaiOpts }
    }
    case 'bytedance': {
      const bytedanceOpts = {
        ...(opts.resolution ? { resolution: opts.resolution } : {}),
        ...(opts.referenceImages ? { referenceImages: opts.referenceImages } : {}),
      } satisfies ByteDanceVideoProviderOptions
      if (Object.keys(bytedanceOpts).length === 0) return undefined
      return { bytedance: bytedanceOpts }
    }
    case 'fal': {
      const falOpts = {
        ...(opts.resolution ? { resolution: opts.resolution } : {}),
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
      } satisfies FalVideoModelOptions
      if (Object.keys(falOpts).length === 0) return undefined
      return { fal: falOpts }
    }
    case 'google': {
      const googleOpts = {
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
      } satisfies GoogleVideoModelOptions
      if (Object.keys(googleOpts).length === 0) return undefined
      return { google: googleOpts }
    }
    case 'vertex': {
      const vertexOpts = {
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
      } satisfies GoogleVertexVideoModelOptions
      if (Object.keys(vertexOpts).length === 0) return undefined
      return { vertex: vertexOpts }
    }
    default:
      return undefined
  }
}

// ─── cost calculation ────────────────────────────────────────────────────────

export function calculateCost(
  cost: {
    type: 'per-image'
    perImage: number
  } | {
    type: 'per-token'
    inputPerM: number
    outputPerM: number
  } | {
    type: 'per-video-second'
    defaultDurationSec: number
    tiers: Array<{ resolution?: string; costPerSecond: number; hasVideoInput?: boolean }>
  } | {
    type: 'unknown'
  },
  usage: {
    inputTokens?: number
    outputTokens?: number
    imagesGenerated?: number
    videosGenerated?: number
    durationSeconds?: number
    resolution?: string
    hasVideoInput?: boolean
  },
  count: number = 1,
): number | null {
  if (cost.type === 'per-image') {
    return cost.perImage * count
  }
  if (cost.type === 'per-token' && usage.inputTokens != null && usage.outputTokens != null) {
    return (
      (usage.inputTokens * cost.inputPerM + usage.outputTokens * cost.outputPerM) / 1_000_000
    )
  }
  if (cost.type === 'per-video-second') {
    const durationSec = usage.durationSeconds ?? cost.defaultDurationSec
    const resolution = normalizeResolutionKey(usage.resolution)
    const hasVideoInput = usage.hasVideoInput ?? false
    const tier =
      cost.tiers.find((t) =>
        normalizeResolutionKey(t.resolution) === resolution &&
        (t.hasVideoInput == null || t.hasVideoInput === hasVideoInput),
      ) ??
      cost.tiers.find((t) => normalizeResolutionKey(t.resolution) === resolution) ??
      cost.tiers[0]
    if (!tier) {
      return null
    }
    return tier.costPerSecond * durationSec * count
  }
  return null
}

function normalizeResolutionKey(input?: string): string | undefined {
  if (!input) return undefined
  const normalized = input.trim().toLowerCase()
  if (normalized === '1920x1080') return '1080p'
  if (normalized === '1280x720') return '720p'
  if (normalized === '854x480' || normalized === '848x480') return '480p'
  return normalized
}

// ─── image byte helpers ──────────────────────────────────────────────────────

function inferImageMediaType(image: Uint8Array): string {
  if (image.length >= 8 && image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47) {
    return 'image/png'
  }
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    image.length >= 12 &&
    image[0] === 0x52 && image[1] === 0x49 && image[2] === 0x46 && image[3] === 0x46 &&
    image[8] === 0x57 && image[9] === 0x45 && image[10] === 0x42 && image[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (
    image.length >= 6 &&
    image[0] === 0x47 && image[1] === 0x49 && image[2] === 0x46 && image[3] === 0x38
  ) {
    return 'image/gif'
  }
  return 'image/png'
}

function imageBytesToDataUrl(image: Uint8Array): string {
  const mediaType = inferImageMediaType(image)
  return `data:${mediaType};base64,${Buffer.from(image).toString('base64')}`
}

function isAspectRatio(input: string): input is `${number}:${number}` {
  return /^\d+:\d+$/.test(input)
}

// ─── aspect ratio fallback for models without native support ─────────────────
//
// OpenAI image models (gpt-image-*, dall-e-*) reject `aspectRatio`: the AI SDK
// pushes an "unsupported: aspectRatio" warning and the request falls back to a
// square image. They accept a fixed `size` list instead, and they also honour a
// plain-language ratio statement in the prompt text when picking the framing.
// So for these models we do both: snap to the closest supported size AND state
// the ratio in the prompt. The prompt hint matters because the supported sizes
// are coarse (only 3:2 / 1:1 / 2:3), so a request like 16:9 has no exact match
// and the composition has to come from the prompt.
//
// Models with a non-empty `features.aspectRatios` keep the native flag.

const OPENAI_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const

function ratioValue(aspectRatio: `${number}:${number}`): number | undefined {
  const [w, h] = aspectRatio.split(':').map(Number)
  if (!w || !h) return undefined
  return w / h
}

function orientationLabel(ratio: number): 'landscape' | 'portrait' | 'square' {
  if (ratio > 1.02) return 'landscape'
  if (ratio < 0.98) return 'portrait'
  return 'square'
}

/** Pick the supported WIDTHxHEIGHT whose ratio is closest to the requested one. */
function closestSize(
  aspectRatio: `${number}:${number}`,
  sizes: readonly string[],
): `${number}x${number}` | undefined {
  const target = ratioValue(aspectRatio)
  if (target === undefined || sizes.length === 0) return undefined

  let best: string | undefined
  let bestDistance = Infinity
  for (const size of sizes) {
    const [w, h] = size.split('x').map(Number)
    if (!w || !h) continue
    // Compare in log space so 2x-too-wide and 2x-too-tall are equally far off.
    const distance = Math.abs(Math.log(w / h) - Math.log(target))
    if (distance < bestDistance) {
      bestDistance = distance
      best = size
    }
  }
  return best as `${number}x${number}` | undefined
}

/**
 * Translate an aspect ratio request into a prompt prefix + concrete `size` for
 * models that have no native aspect ratio parameter.
 */
export function aspectRatioFallback(
  prompt: string,
  aspectRatio: `${number}:${number}` | undefined,
  sizes: readonly string[],
): { prompt: string; size?: `${number}x${number}` } {
  if (!aspectRatio) return { prompt }
  const ratio = ratioValue(aspectRatio)
  if (ratio === undefined) return { prompt }
  return {
    prompt: `Image aspect ratio: ${aspectRatio}, ${orientationLabel(ratio)} orientation. ${prompt}`,
    size: closestSize(aspectRatio, sizes),
  }
}

/** Convert any thrown value into an Error instance. */
function toError(err: unknown): Error {
  if (err instanceof Error) return err
  return new Error(String(err))
}

// ─── generateImage ───────────────────────────────────────────────────────────

/**
 * Generate images from a text prompt. Auto-detects which generation strategy
 * to use (image API, text model, or ChatGPT Responses API) based on model ID.
 * Shares credentials and subscription with the CLI.
 */
export async function generateImageUncached(opts: GenerateImageOptions): Promise<Error | GenerateImageResult> {
  injectCredentialsToEnv()

  const model = opts.model ?? DEFAULT_MODEL
  const count = opts.count ?? 1
  const config = getModelConfig(model)
  if (config instanceof Error) return config

  const parsedAspectRatio = opts.aspectRatio && isAspectRatio(opts.aspectRatio)
    ? opts.aspectRatio
    : undefined
  const inputImages = opts.inputImages ?? []

  // ChatGPT OAuth + OpenAI image models → Responses API path
  const useResponsesApi = config.strategy === 'image' && shouldUseResponsesApi(model)

  if (useResponsesApi) {
    return generateWithResponsesApi({
      prompt: opts.prompt,
      model,
      count,
      aspectRatio: parsedAspectRatio,
      seed: opts.seed,
      maskImage: opts.maskImage,
      inputImages,
    })
  }

  if (config.strategy === 'image') {
    return generateWithImageModel({
      prompt: opts.prompt,
      model,
      count,
      aspectRatio: parsedAspectRatio,
      seed: opts.seed,
      inputImages,
      maskImage: opts.maskImage,
      allowPeople: opts.allowPeople ?? false,
      quality: opts.quality,
      resolution: opts.resolution,
      outputFormat: opts.outputFormat,
      negativePrompt: opts.negativePrompt,
    })
  }

  // Text model path (Gemini multimodal)
  return generateWithTextModelPath({
    prompt: opts.prompt,
    model,
    inputImages,
    imageSize: opts.imageSize,
    aspectRatio: opts.aspectRatio,
  })
}

// ─── generateVideo ───────────────────────────────────────────────────────────

/**
 * Generate videos from a text prompt (or image+text for i2v models).
 * Shares credentials and subscription with the CLI.
 */
export async function generateVideoUncached(opts: GenerateVideoOptions): Promise<Error | GenerateVideoResult> {
  injectCredentialsToEnv()

  const model = opts.model ?? DEFAULT_VIDEO_MODEL
  const count = opts.count ?? 1
  const config = getModelConfig(model)
  if (config instanceof Error) return config

  if (config.strategy !== 'video') {
    return new ValidationError(`Model ${model} is not a video model`)
  }

  const isVideoInputMode = opts.mode === 'edit-video' || opts.mode === 'extend-video'

  // Validate mode-specific required inputs
  if (isVideoInputMode && !opts.videoUrl) {
    return new ValidationError(`videoUrl is required with mode ${opts.mode}`)
  }
  if (opts.mode === 'reference-to-video' && (!opts.referenceImages || opts.referenceImages.length === 0)) {
    return new ValidationError('referenceImages is required with mode reference-to-video')
  }
  if (opts.referenceImages?.length && !config.providerOptions?.some((opt) => opt.flag === 'reference-images')) {
    return new ValidationError(`Model ${model} does not support referenceImages`)
  }
  if (opts.videoUrl && !config.providerOptions?.some((opt) => opt.flag === 'video-url')) {
    return new ValidationError(`Model ${model} does not support video URL input for editing/extension`)
  }

  const videoModel = await createVideoModel(model)
  if (videoModel instanceof Error) return videoModel

  const providerOptions = buildVideoProviderOptions(config.provider, {
    resolution: opts.resolution,
    mode: opts.mode,
    videoUrl: opts.videoUrl,
    referenceImages: opts.referenceImages,
    negativePrompt: opts.negativePrompt,
    model,
  })

  let result
  try {
    result = await aiGenerateVideo({
      model: videoModel,
      prompt: opts.inputImage
        ? { image: opts.inputImage, text: opts.prompt }
        : opts.prompt,
      n: count,
      ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio as `${number}:${number}` } : {}),
      ...(opts.resolution ? { resolution: opts.resolution as `${number}x${number}` } : {}),
      ...(opts.duration != null ? { duration: opts.duration } : {}),
      ...(opts.fps != null ? { fps: opts.fps } : {}),
      ...(opts.seed != null ? { seed: opts.seed } : {}),
      ...(providerOptions ? { providerOptions } : {}),
    })
  } catch (err) {
    return toError(err)
  }

  const videos = result.videos.map((v: { uint8Array: Uint8Array; mediaType: string }) => ({
    uint8Array: v.uint8Array,
    mediaType: v.mediaType,
  }))

  const cost = calculateCost(config.cost, {
    videosGenerated: result.videos.length,
    durationSeconds: opts.duration,
    resolution: opts.resolution,
    hasVideoInput: Boolean(opts.inputImage || opts.videoUrl || opts.referenceImages?.length),
  }, result.videos.length)

  return {
    videos,
    model,
    cost,
    warnings: result.warnings,
    responses: result.responses,
  }
}

// ─── internal generation paths ───────────────────────────────────────────────

async function generateWithImageModel(opts: {
  prompt: string
  model: string
  count: number
  aspectRatio?: `${number}:${number}`
  seed?: number
  inputImages: Uint8Array[]
  maskImage?: Uint8Array
  allowPeople: boolean
  quality?: string
  resolution?: string
  outputFormat?: string
  negativePrompt?: string
}): Promise<Error | GenerateImageResult> {
  const config = getModelConfig(opts.model)
  if (config instanceof Error) return config

  // Models with an empty `aspectRatios` list have no native aspect ratio
  // parameter, so the request is expressed through `size` + the prompt text.
  const features = config.strategy === 'video' ? undefined : config.features
  const supportsNativeAspectRatio = (features?.aspectRatios?.length ?? 0) > 0
  const fallback = supportsNativeAspectRatio
    ? { prompt: opts.prompt, size: undefined }
    : aspectRatioFallback(opts.prompt, opts.aspectRatio, features?.sizes ?? [])

  const imagePrompt = opts.inputImages.length > 0
    ? { text: fallback.prompt, images: opts.inputImages, ...(opts.maskImage ? { mask: opts.maskImage } : {}) }
    : fallback.prompt

  const imageModel = await createImageModel(opts.model)
  if (imageModel instanceof Error) return imageModel

  const providerOptions = buildImageProviderOptions(config.provider, {
    aspectRatio: opts.aspectRatio,
    allowPeople: opts.allowPeople,
    quality: opts.quality,
    resolution: opts.resolution,
    outputFormat: opts.outputFormat,
    negativePrompt: opts.negativePrompt,
  })

  let result
  try {
    result = await aiGenerateImage({
      model: imageModel,
      prompt: imagePrompt,
      n: opts.count,
      ...(opts.aspectRatio && supportsNativeAspectRatio ? { aspectRatio: opts.aspectRatio } : {}),
      ...(fallback.size ? { size: fallback.size } : {}),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      providerOptions,
    })
  } catch (err) {
    return toError(err)
  }

  const images = result.images.map((img) => ({
    uint8Array: img.uint8Array,
    mediaType: img.mediaType,
  }))

  const cost = calculateCost(config.cost, result.usage, result.images.length)

  return {
    images,
    model: opts.model,
    cost,
    usage: result.usage,
    warnings: result.warnings,
  }
}

async function generateWithTextModelPath(opts: {
  prompt: string
  model: string
  inputImages: Uint8Array[]
  imageSize?: '1K' | '2K' | '4K'
  aspectRatio?: string
}): Promise<Error | GenerateImageResult> {
  const textModel = await createTextModel(opts.model)
  if (textModel instanceof Error) return textModel

  const config = getModelConfig(opts.model)
  if (config instanceof Error) return config

  const messages = opts.inputImages.length > 0
    ? [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: opts.prompt },
            ...opts.inputImages.map((img) => ({
              type: 'image' as const,
              image: img,
            })),
          ],
        },
      ]
    : undefined

  type GoogleAspectRatio = NonNullable<NonNullable<GoogleLanguageModelOptions['imageConfig']>['aspectRatio']>
  const googleOpts = {
    responseModalities: ['TEXT', 'IMAGE'],
    ...(opts.imageSize || opts.aspectRatio
      ? {
          imageConfig: {
            ...(opts.imageSize ? { imageSize: opts.imageSize } : {}),
            ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio as GoogleAspectRatio } : {}),
          },
        }
      : {}),
  } satisfies GoogleLanguageModelOptions

  const providerOptionsKey = config.provider === 'vertex' ? 'vertex' : 'google'

  let result
  try {
    result = await generateText({
      model: textModel,
      ...(messages ? { messages } : { prompt: opts.prompt }),
      providerOptions: {
        [providerOptionsKey]: googleOpts,
      },
    })
  } catch (err) {
    return toError(err)
  }

  const imageFiles = result.files.filter((f) => f.mediaType.startsWith('image/'))
  if (imageFiles.length === 0) {
    return new Error('No images generated by the text model.')
  }

  const images = imageFiles.map((f) => ({
    uint8Array: f.uint8Array,
    mediaType: f.mediaType,
  }))

  const cost = calculateCost(config.cost, result.usage, imageFiles.length)

  return {
    images,
    model: opts.model,
    cost,
    usage: result.usage,
    text: result.text || undefined,
  }
}

async function generateWithResponsesApi(opts: {
  prompt: string
  model: string
  count: number
  aspectRatio?: `${number}:${number}`
  seed?: number
  maskImage?: Uint8Array
  inputImages: Uint8Array[]
}): Promise<Error | GenerateImageResult> {
  if (opts.count !== 1) {
    return new ValidationError('ChatGPT image generation currently supports exactly one output image.')
  }

  if (opts.seed !== undefined) {
    return new ValidationError('ChatGPT image generation does not support seed.')
  }

  if (opts.maskImage) {
    return new ValidationError('ChatGPT image generation does not support mask yet.')
  }

  const { prompt, size } = aspectRatioFallback(opts.prompt, opts.aspectRatio, OPENAI_SIZES)

  const storedAuth = getChatGptAuth()
  if (!storedAuth?.accountId) {
    return new ValidationError('Missing ChatGPT account metadata. Please run `egaki login --provider chatgpt` again.')
  }

  const auth = await getValidChatGptAuth(storedAuth, saveChatGptAuth)
  if (auth instanceof Error) return auth

  const content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> = [
    { type: 'input_text', text: prompt },
    ...opts.inputImages.map((image) => ({
      type: 'input_image' as const,
      image_url: imageBytesToDataUrl(image),
    })),
  ]

  let response: Response
  try {
    response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.access}`,
      ...(auth.accountId && { 'ChatGPT-Account-ID': auth.accountId }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5.4',
      instructions: 'You are Codex.',
      input: [
        {
          type: 'message',
          role: 'user',
          content,
        },
      ],
      tools: [
        {
          type: 'image_generation',
          model: opts.model,
          size: 'auto',
          quality: 'auto',
          output_format: 'png',
          output_compression: 100,
          moderation: 'auto',
          ...(size ? { size } : {}),
        },
      ],
      tool_choice: 'auto',
      parallel_tool_calls: true,
      stream: true,
      store: false,
      include: [],
    }),
  })
  } catch (err) {
    return toError(err)
  }

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '')
    return new Error(`ChatGPT image generation failed: ${response.status}${body ? ` ${body}` : ''}`)
  }

  let imageBase64: string | undefined
  let revisedPrompt: string | null = null

  const parser = createParser({
    onEvent: (message: EventSourceMessage) => {
      if (!message.data) return
      try {
        const event = JSON.parse(message.data) as {
          type?: string
          partial_image_b64?: string
          item?: { type?: string; result?: string; revised_prompt?: string | null }
        }
        if (
          event.type === 'response.image_generation_call.partial_image' &&
          event.partial_image_b64 &&
          !imageBase64
        ) {
          imageBase64 = event.partial_image_b64
        }
        if (
          event.type === 'response.output_item.done' &&
          event.item?.type === 'image_generation_call'
        ) {
          if (event.item.result) imageBase64 = event.item.result
          revisedPrompt = event.item.revised_prompt ?? revisedPrompt
        }
      } catch {
        // Ignore keepalive and partial parse noise.
      }
    },
  })

  const decoder = new TextDecoder()
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    parser.feed(decoder.decode(chunk, { stream: true }))
  }
  parser.feed(decoder.decode())

  if (!imageBase64) {
    return new Error('No images generated by ChatGPT.')
  }

  const imageBytes = new Uint8Array(Buffer.from(imageBase64, 'base64'))

  return {
    images: [{ uint8Array: imageBytes, mediaType: 'image/png' }],
    model: opts.model,
    cost: null,
    revisedPrompt,
  }
}

// ─── cached result types ─────────────────────────────────────────────────────

export interface CachedGenerateResult {
  /** Public URL path (e.g. `/generated/image/sunset-a1b2c3d4.png`) */
  src: string
}

// ─── cached generateImage ───────────────────────────────────────────────────

import { cachedGenerate } from './cached-generate.js'
import { extensionFromMediaType } from './cache-utils.js'

export const generateImage = cachedGenerate<GenerateImageOptions & { seed?: number }, GeneratedFile, CachedGenerateResult>({
  namespace: 'image',
  prefixFrom: (p) => p.prompt,
  modelFrom: (p) => p.model,
  generate: async (params) => {
    const result = await generateImageUncached(params)
    if (result instanceof Error) throw result
    const file = result.images[0]
    if (!file) throw new Error('No image generated')
    return file
  },
  serialize: (file) => ({
    bytes: file.uint8Array,
    extension: extensionFromMediaType(file.mediaType),
  }),
})

// ─── cached generateVideo ───────────────────────────────────────────────────

export const generateVideo = cachedGenerate<GenerateVideoOptions & { seed?: number }, GeneratedFile, CachedGenerateResult>({
  namespace: 'video',
  prefixFrom: (p) => p.prompt,
  modelFrom: (p) => p.model,
  generate: async (params) => {
    const result = await generateVideoUncached(params)
    if (result instanceof Error) throw result
    const file = result.videos[0]
    if (!file) throw new Error('No video generated')
    return file
  },
  serialize: (file) => ({
    bytes: file.uint8Array,
    extension: extensionFromMediaType(file.mediaType),
  }),
})

// ─── re-export speech generation ─────────────────────────────────────────────

export {
  generateSpeech,
  generateSpeechUncached,
  calculateSpeechCost,
  type GenerateSpeechOptions,
  type GenerateSpeechResult,
  type CachedSpeechResult,
  type SpeechProvider,
  type SpeechProviderOptions,
  type SpeechProviderResult,
} from './speech-generate.js'

// ─── re-export transcription ─────────────────────────────────────────────────

export {
  transcribeAudio,
  transcribeAudioUncached,
  calculateTranscriptionCost,
  segmentsToWordTimestamps,
  wordTimestampsToCaptions,
  type TranscribeOptions,
  type TranscribeResult,
  type WordTimestamp,
  type TranscriptionSegment,
} from './transcription-generate.js'
