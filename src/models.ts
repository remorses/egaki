// Model registry for egaki.
// Maps model IDs to their provider and generation strategy. The enum of
// supported models is derived from this registry so there's a single source
// of truth for both CLI validation and runtime provider resolution.
//
// Two generation strategies:
//   - 'image': uses provider.image(modelId) + generateImage()
//   - 'text':  uses provider(modelId) + generateText() with responseModalities
//
// Provider resolution priority:
//   1. Provider-specific key (e.g. GOOGLE_GENERATIVE_AI_API_KEY) → direct SDK
//   2. Egaki API key (EGAKI_API_KEY) → route through egaki gateway
//   3. No key → error with subscription recommendation
//
// Model IDs are sourced from the TypeScript types exported by each @ai-sdk/*
// package. To add new models, check the *ModelId types in each package's
// dist/index.d.ts and add entries here.
import type { ImageModel, LanguageModel } from 'ai'
import pc from 'picocolors'
import { PROVIDERS, EGAKI_GATEWAY_URL } from './credentials.js'
import { CATALOG, findModel } from './model-catalog.js'
import type { ModelEntry } from './model-catalog.js'
import { VIDEO_CATALOG, findVideoModel } from './video-model-catalog.js'
import type { VideoModelEntry } from './video-model-catalog.js'

export type AnyModelEntry = ModelEntry | VideoModelEntry
export type { ModelEntry, VideoModelEntry }

export const IMAGE_MODELS = CATALOG.map((m) => m.id) as [string, ...string[]]
export const VIDEO_MODELS = VIDEO_CATALOG.map((m) => m.id) as [string, ...string[]]

/**
 * Strip provider prefix from a model ID (e.g. "vertex/imagen-4.0-generate-001" → "imagen-4.0-generate-001").
 * Provider SDKs expect bare model IDs, but the catalog uses prefixed IDs for routing.
 */
function stripProviderPrefix(modelId: string): string {
  const slash = modelId.indexOf('/')
  if (slash === -1) return modelId
  return modelId.slice(slash + 1)
}

export const DEFAULT_MODEL = 'nano-banana-pro-preview'
export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast-generate-001'

export function getModelConfig(modelId: string): AnyModelEntry {
  const entry = findModel(modelId) ?? findVideoModel(modelId)
  if (!entry) {
    console.error(pc.red(`Unknown model: ${modelId}`))
    process.exit(1)
  }
  return entry
}

/**
 * Check if the egaki gateway API key is available (from env or stored credentials).
 */
function hasEgakiKey(): boolean {
  const info = PROVIDERS['egaki']
  if (!info) return false
  return Boolean(process.env[info.envVar])
}

/**
 * Check if a direct provider key is available for the given provider.
 */
function hasDirectProviderKey(providerName: string): boolean {
  const info = PROVIDERS[providerName]
  if (!info) return false
  return Boolean(process.env[info.envVar])
}

// Check that the provider's API key is available before making API calls.
// Prints a user-friendly error with instructions on how to configure it.
// Prioritizes egaki subscription over individual provider keys.
export function ensureProviderKey(providerName: string): void {
  // If direct provider key exists, we're good
  if (hasDirectProviderKey(providerName)) return

  // If egaki key exists, we'll route through the gateway
  if (hasEgakiKey()) return

  const info = PROVIDERS[providerName]

  console.error('')
  console.error(pc.red(pc.bold(`Missing API key for ${info?.label || providerName}`)))
  console.error('')
  console.error(`  ${pc.bold('Recommended:')} Use Egaki subscription (all models, one key)`)
  console.error('')
  console.error(
    `    ${pc.cyan('egaki subscribe')}                        get started in 30 seconds`,
  )
  console.error('')
  console.error(`  ${pc.dim('Or configure a provider key directly:')}`)
  console.error('')
  console.error(
    `    ${pc.cyan('egaki login')}                           interactive setup`,
  )
  if (info) {
    console.error(
      `    ${pc.cyan(`${info.envVar}=...`)} egaki image ...   inline env var`,
    )
    console.error(
      `    ${pc.cyan(`egaki login --provider ${providerName} --key <key>`)}`,
    )
    console.error('')
    console.error(`  ${pc.dim(info.hint)}`)
  }
  console.error('')
  process.exit(1)
}

/**
 * Create a gateway-backed image model using createGateway from the AI SDK.
 * The model ID is sent as provider/model format to the gateway.
 */
async function createGatewayImageModel(modelId: string, provider: string): Promise<ImageModel> {
  const { createGateway } = await import('ai')
  const gateway = createGateway({
    apiKey: process.env['EGAKI_API_KEY']!,
    baseURL: EGAKI_GATEWAY_URL,
  })
  // Gateway expects provider/model format for routing.
  // For models that already have a prefix (e.g. vertex/imagen-4.0), strip it
  // and use the catalog provider. For bare IDs, prepend the provider.
  const bareId = stripProviderPrefix(modelId)
  const gatewayModelId = `${provider}/${bareId}`
  return gateway.image(gatewayModelId)
}

/**
 * Create a gateway-backed text model using createGateway from the AI SDK.
 */
async function createGatewayTextModel(modelId: string, provider: string): Promise<LanguageModel> {
  const { createGateway } = await import('ai')
  const gateway = createGateway({
    apiKey: process.env['EGAKI_API_KEY']!,
    baseURL: EGAKI_GATEWAY_URL,
  })
  const bareId = stripProviderPrefix(modelId)
  const gatewayModelId = `${provider}/${bareId}`
  return gateway(gatewayModelId)
}

/**
 * Create a gateway-backed video model using createGateway from the AI SDK.
 */
async function createGatewayVideoModel(modelId: string, provider: string) {
  const { createGateway } = await import('ai')
  const gateway = createGateway({
    apiKey: process.env['EGAKI_API_KEY']!,
    baseURL: EGAKI_GATEWAY_URL,
  })
  const bareId = stripProviderPrefix(modelId)
  const gatewayModelId = `${provider}/${bareId}`
  return gateway.video(gatewayModelId)
}

// Lazily import the provider and create the right model instance.
// This avoids loading all provider SDKs upfront — only the one needed
// for the selected model gets imported.
//
// Priority: direct provider key > egaki gateway > error
export async function createImageModel(modelId: string): Promise<ImageModel> {
  const config = getModelConfig(modelId)
  ensureProviderKey(config.provider)

  // If the user has a direct provider key, use the provider SDK directly
  if (hasDirectProviderKey(config.provider)) {
    switch (config.provider) {
      case 'google': {
        const { google } = await import('@ai-sdk/google')
        return google.image(modelId)
      }
      case 'vertex': {
        const { vertex } = await import('@ai-sdk/google-vertex')
        return vertex.image(stripProviderPrefix(modelId))
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
    }
  }

  // Fall back to egaki gateway
  if (hasEgakiKey()) {
    return createGatewayImageModel(modelId, config.provider)
  }

  // Should not reach here — ensureProviderKey would have exited
  console.error(pc.red(`No API key available for provider: ${config.provider}`))
  process.exit(1)
}

export async function createTextModel(
  modelId: string,
): Promise<LanguageModel> {
  const config = getModelConfig(modelId)
  if (config.strategy !== 'text') {
    console.error(pc.red(`Model ${modelId} is not a text model`))
    process.exit(1)
  }
  ensureProviderKey(config.provider)

  // Direct provider key takes priority
  if (hasDirectProviderKey(config.provider)) {
    switch (config.provider) {
      case 'google': {
        const { google } = await import('@ai-sdk/google')
        return google(modelId)
      }
      case 'vertex': {
        const { vertex } = await import('@ai-sdk/google-vertex')
        return vertex(stripProviderPrefix(modelId))
      }
      default:
        // Only Google/Vertex support generateText with responseModalities for images
        console.error(
          pc.red(
            `Text+image generation is only supported for Google/Vertex models, got provider: ${config.provider}`,
          ),
        )
        process.exit(1)
    }
  }

  // Fall back to egaki gateway
  if (hasEgakiKey()) {
    return createGatewayTextModel(modelId, config.provider)
  }

  console.error(pc.red(`No API key available for provider: ${config.provider}`))
  process.exit(1)
}

export async function createVideoModel(modelId: string): Promise<any> {
  const config = getModelConfig(modelId)
  if (config.strategy !== 'video') {
    console.error(pc.red(`Model ${modelId} is not a video model`))
    process.exit(1)
  }

  ensureProviderKey(config.provider)

  // Direct provider key takes priority
  if (hasDirectProviderKey(config.provider)) {
    switch (config.provider) {
      case 'google': {
        const { google } = await import('@ai-sdk/google')
        return google.video(modelId)
      }
      case 'vertex': {
        const { vertex } = await import('@ai-sdk/google-vertex')
        return vertex.video(stripProviderPrefix(modelId))
      }
      case 'fal': {
        const { fal } = await import('@ai-sdk/fal')
        return fal.video(modelId)
      }
      default:
        console.error(
          pc.red(
            `Direct video generation is only supported for Google, Vertex, and Fal keys, got provider: ${config.provider}`,
          ),
        )
        process.exit(1)
    }
  }

  // Fall back to egaki gateway
  if (hasEgakiKey()) {
    return createGatewayVideoModel(modelId, config.provider)
  }

  console.error(pc.red(`No API key available for provider: ${config.provider}`))
  process.exit(1)
}
