// Model registry for egaki.
// Maps model IDs to their provider and generation strategy. The enum of
// supported models is derived from this registry so there's a single source
// of truth for both CLI validation and runtime provider resolution.
//
// Two generation strategies:
//   - 'image': uses provider.image(modelId) + generateImage()
//   - 'text':  uses provider(modelId) + generateText() with responseModalities
//
// Model IDs are sourced from the TypeScript types exported by each @ai-sdk/*
// package. To add new models, check the *ModelId types in each package's
// dist/index.d.ts and add entries here.
import type { ImageModel, LanguageModel } from 'ai'
import pc from 'picocolors'
import { PROVIDERS } from './credentials.js'

type GenerationStrategy = 'image' | 'text'

export type ModelConfig = {
  provider: string
  strategy: GenerationStrategy
}

// ─── registry ────────────────────────────────────────────────────────────────
// Only image-generation-capable models are listed. Utility models (upscalers,
// background removal, etc.) are excluded.

const MODEL_REGISTRY = {
  // ── Google: Imagen (generateImage) ─────────────────────────────────────
  'imagen-4.0-generate-001': { provider: 'google', strategy: 'image' },
  'imagen-4.0-ultra-generate-001': { provider: 'google', strategy: 'image' },
  'imagen-4.0-fast-generate-001': { provider: 'google', strategy: 'image' },

  // ── Google: Gemini + others (generateText with responseModalities) ─────
  'gemini-2.0-flash-exp-image-generation': {
    provider: 'google',
    strategy: 'text',
  },
  'gemini-2.5-flash-image': { provider: 'google', strategy: 'text' },
  'gemini-3-pro-image-preview': { provider: 'google', strategy: 'text' },
  'nano-banana-pro-preview': { provider: 'google', strategy: 'text' },

  // ── OpenAI (generateImage) ─────────────────────────────────────────────
  'dall-e-2': { provider: 'openai', strategy: 'image' },
  'dall-e-3': { provider: 'openai', strategy: 'image' },
  'gpt-image-1': { provider: 'openai', strategy: 'image' },
  'gpt-image-1-mini': { provider: 'openai', strategy: 'image' },
  'gpt-image-1.5': { provider: 'openai', strategy: 'image' },

  // ── Replicate (generateImage) ──────────────────────────────────────────
  'black-forest-labs/flux-1.1-pro': { provider: 'replicate', strategy: 'image' },
  'black-forest-labs/flux-1.1-pro-ultra': { provider: 'replicate', strategy: 'image' },
  'black-forest-labs/flux-2-pro': { provider: 'replicate', strategy: 'image' },
  'black-forest-labs/flux-2-dev': { provider: 'replicate', strategy: 'image' },
  'black-forest-labs/flux-dev': { provider: 'replicate', strategy: 'image' },
  'black-forest-labs/flux-pro': { provider: 'replicate', strategy: 'image' },
  'black-forest-labs/flux-schnell': { provider: 'replicate', strategy: 'image' },
  'black-forest-labs/flux-fill-pro': { provider: 'replicate', strategy: 'image' },
  'black-forest-labs/flux-fill-dev': { provider: 'replicate', strategy: 'image' },
  'ideogram-ai/ideogram-v2': { provider: 'replicate', strategy: 'image' },
  'ideogram-ai/ideogram-v2-turbo': { provider: 'replicate', strategy: 'image' },
  'recraft-ai/recraft-v3': { provider: 'replicate', strategy: 'image' },
  'recraft-ai/recraft-v3-svg': { provider: 'replicate', strategy: 'image' },
  'stability-ai/stable-diffusion-3.5-large': { provider: 'replicate', strategy: 'image' },
  'stability-ai/stable-diffusion-3.5-large-turbo': { provider: 'replicate', strategy: 'image' },
  'stability-ai/stable-diffusion-3.5-medium': { provider: 'replicate', strategy: 'image' },
  'luma/photon': { provider: 'replicate', strategy: 'image' },
  'luma/photon-flash': { provider: 'replicate', strategy: 'image' },
  'nvidia/sana': { provider: 'replicate', strategy: 'image' },

  // ── Fal (generateImage) ────────────────────────────────────────────────
  'fal-ai/flux/schnell': { provider: 'fal', strategy: 'image' },
  'fal-ai/flux/dev': { provider: 'fal', strategy: 'image' },
  'fal-ai/flux-general': { provider: 'fal', strategy: 'image' },
  'fal-ai/flux-general/inpainting': { provider: 'fal', strategy: 'image' },
  'fal-ai/flux-general/image-to-image': { provider: 'fal', strategy: 'image' },
  'fal-ai/flux-pro/v1.1': { provider: 'fal', strategy: 'image' },
  'fal-ai/flux-pro/v1.1-ultra': { provider: 'fal', strategy: 'image' },
  'fal-ai/flux-pro/kontext': { provider: 'fal', strategy: 'image' },
  'fal-ai/flux-pro/kontext/max': { provider: 'fal', strategy: 'image' },
  'fal-ai/flux-lora': { provider: 'fal', strategy: 'image' },
  'fal-ai/recraft/v3/text-to-image': { provider: 'fal', strategy: 'image' },
  'fal-ai/recraft/v3/image-to-image': { provider: 'fal', strategy: 'image' },
  'fal-ai/ideogram/character': { provider: 'fal', strategy: 'image' },
  'fal-ai/imagen4/preview': { provider: 'fal', strategy: 'image' },
  'fal-ai/luma-photon': { provider: 'fal', strategy: 'image' },
  'fal-ai/luma-photon/flash': { provider: 'fal', strategy: 'image' },
  'fal-ai/omnigen-v2': { provider: 'fal', strategy: 'image' },
  'fal-ai/qwen-image': { provider: 'fal', strategy: 'image' },
} as const satisfies Record<string, ModelConfig>

export type ModelId = keyof typeof MODEL_REGISTRY

export const IMAGE_MODELS = Object.keys(MODEL_REGISTRY) as [
  ModelId,
  ...ModelId[],
]

export const DEFAULT_MODEL: ModelId = 'nano-banana-pro-preview'

export function getModelConfig(modelId: string): ModelConfig {
  const config = MODEL_REGISTRY[modelId as ModelId]
  if (!config) {
    // Should not happen if the enum validation passes, but just in case
    console.error(pc.red(`Unknown model: ${modelId}`))
    process.exit(1)
  }
  return config
}

// Check that the provider's API key is available before making API calls.
// Prints a user-friendly error with instructions on how to configure it.
export function ensureProviderKey(providerName: string): void {
  const info = PROVIDERS[providerName]
  if (!info) return

  if (process.env[info.envVar]) return

  console.error('')
  console.error(pc.red(pc.bold(`Missing API key for ${info.label}`)))
  console.error('')
  console.error(`  Set it with any of these:`)
  console.error('')
  console.error(
    `    ${pc.cyan('egaki login')}                           interactive setup`,
  )
  console.error(
    `    ${pc.cyan(`${info.envVar}=...`)} egaki image ...   inline env var`,
  )
  console.error(
    `    ${pc.cyan(`egaki login --provider ${providerName} --key <key>`)}`,
  )
  console.error('')
  console.error(`  ${pc.dim(info.hint)}`)
  console.error('')
  process.exit(1)
}

// Lazily import the provider and create the right model instance.
// This avoids loading all provider SDKs upfront — only the one needed
// for the selected model gets imported.
export async function createImageModel(modelId: string): Promise<ImageModel> {
  const config = getModelConfig(modelId)
  ensureProviderKey(config.provider)

  switch (config.provider) {
    case 'google': {
      const { google } = await import('@ai-sdk/google')
      return google.image(modelId)
    }
    case 'openai': {
      const { openai } = await import('@ai-sdk/openai')
      return openai.image(modelId)
    }
    case 'replicate': {
      const { replicate } = await import('@ai-sdk/replicate')
      return replicate.image(modelId)
    }
    case 'fal': {
      const { fal } = await import('@ai-sdk/fal')
      return fal.image(modelId)
    }
    default:
      console.error(pc.red(`No image model support for provider: ${config.provider}`))
      process.exit(1)
  }
}

export async function createTextModel(
  modelId: string,
): Promise<LanguageModel> {
  const config = getModelConfig(modelId)
  ensureProviderKey(config.provider)

  switch (config.provider) {
    case 'google': {
      const { google } = await import('@ai-sdk/google')
      return google(modelId)
    }
    default:
      // Only Google supports generateText with responseModalities for images
      console.error(
        pc.red(
          `Text+image generation is only supported for Google models, got provider: ${config.provider}`,
        ),
      )
      process.exit(1)
  }
}
