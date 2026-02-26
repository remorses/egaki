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
import { CATALOG, findModel } from './model-catalog.js'
import type { ModelEntry } from './model-catalog.js'

export type { ModelEntry }

export const IMAGE_MODELS = CATALOG.map((m) => m.id) as [string, ...string[]]

export const DEFAULT_MODEL = 'nano-banana-pro-preview'

export function getModelConfig(modelId: string): ModelEntry {
  const entry = findModel(modelId)
  if (!entry) {
    console.error(pc.red(`Unknown model: ${modelId}`))
    process.exit(1)
  }
  return entry
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
      console.error(
        pc.red(`No image model support for provider: ${config.provider}`),
      )
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
