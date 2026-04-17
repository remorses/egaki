// Credential storage for egaki.
// Reads and writes API keys from ~/.config/egaki/credentials.json.
// Keys are stored per-provider and injected as env vars at runtime.
//
// Most providers store a plain API key string. The 'chatgpt' provider stores
// a structured ChatGptAuth object with OAuth tokens for the Codex backend flow.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ChatGptAuth } from './chatgpt-auth.js'

export type ProviderInfo = {
  envVar: string
  label: string
  hint: string
  /** If true, this provider uses OAuth instead of a plain API key */
  oauth?: boolean
}

// Maps provider names to their expected env var names.
// When a key is stored, we set the corresponding env var before
// calling the AI SDK so the provider picks it up automatically.
export const PROVIDERS: Record<string, ProviderInfo> = {
  egaki: {
    envVar: 'EGAKI_API_KEY',
    label: 'Egaki (all models, one subscription)',
    hint: 'Subscribe at https://egaki.org/buy or run: egaki subscribe',
  },
  chatgpt: {
    envVar: 'OPENAI_API_KEY',
    label: 'ChatGPT (use your subscription)',
    hint: 'Sign in with your ChatGPT account via browser',
    oauth: true,
  },
  cliproxyapi: {
    envVar: 'CLIPROXYAPI_API_KEY',
    label: 'CLIProxyAPI (OpenAI-compatible proxy)',
    hint: 'Set CLIPROXYAPI_BASE_URL and save your proxy API key',
  },
  google: {
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    label: 'Google AI (Gemini, Imagen)',
    hint: 'Get your key at https://aistudio.google.com/apikey',
  },
  vertex: {
    envVar: 'GOOGLE_VERTEX_API_KEY',
    label: 'Google Vertex AI (Gemini, Imagen, Veo via Google Cloud)',
    hint: 'Get an API key at https://console.cloud.google.com/apis/credentials',
  },
  openai: {
    envVar: 'OPENAI_API_KEY',
    label: 'OpenAI (API key)',
    hint: 'Get your key at https://platform.openai.com/api-keys',
  },
  replicate: {
    envVar: 'REPLICATE_API_TOKEN',
    label: 'Replicate (Flux, SDXL)',
    hint: 'Get your token at https://replicate.com/account/api-tokens',
  },
  fal: {
    envVar: 'FAL_KEY',
    label: 'fal.ai (Flux, SDXL, Recraft)',
    hint: 'Get your key at https://fal.ai/dashboard/keys',
  },
}

export const EGAKI_GATEWAY_URL = 'https://egaki.org/v3/ai'

function getConfigDir(): string {
  // XDG_CONFIG_HOME or ~/.config/egaki
  const xdg = process.env['XDG_CONFIG_HOME']
  const base = xdg || path.join(os.homedir(), '.config')
  return path.join(base, 'egaki')
}

function getCredentialsPath(): string {
  return path.join(getConfigDir(), 'credentials.json')
}

/** A credential value is either a plain API key string or a ChatGPT OAuth object. */
export type CredentialValue = string | ChatGptAuth
export type Credentials = Record<string, CredentialValue>

export function readCredentials(): Credentials {
  const filePath = getCredentialsPath()
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as Credentials
}

export function writeCredentials(creds: Credentials): void {
  const dir = getConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  const filePath = getCredentialsPath()
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2) + '\n', {
    mode: 0o600,
  })
}

export function saveProviderKey(provider: string, key: string): void {
  const creds = readCredentials()
  creds[provider] = key
  writeCredentials(creds)
}

export function saveChatGptAuth(auth: ChatGptAuth): void {
  const creds = readCredentials()
  creds['chatgpt'] = auth
  writeCredentials(creds)
}

export function getChatGptAuth(): ChatGptAuth | undefined {
  const creds = readCredentials()
  const val = creds['chatgpt']
  if (val && typeof val === 'object') {
    return val
  }
  return undefined
}

export function removeProviderKey(provider: string): void {
  const creds = readCredentials()
  delete creds[provider]
  writeCredentials(creds)
}

export function getProviderKey(provider: string): string | undefined {
  const creds = readCredentials()
  const val = creds[provider]
  return typeof val === 'string' ? val : undefined
}

// Inject all stored non-ChatGPT credentials as env vars so the AI SDK
// providers pick them up automatically. Env vars already set by the user take
// precedence (we don't overwrite them).
export function injectCredentialsToEnv(): void {
  const creds = readCredentials()
  for (const [provider, value] of Object.entries(creds)) {
    const info = PROVIDERS[provider]
    if (!info) continue

    // Skip ChatGPT OAuth entries — handled separately
    if (provider === 'chatgpt') continue

    if (typeof value === 'string' && !process.env[info.envVar]) {
      process.env[info.envVar] = value
    }
  }
}

/**
 * Returns true when the current run should use the ChatGPT/Codex backend flow
 * for OpenAI image models instead of a direct OpenAI API key.
 */
export function shouldUseChatGptBackend(): boolean {
  return !process.env['OPENAI_API_KEY'] && Boolean(getChatGptAuth())
}

// OpenAI image generation can also run through an OpenAI-compatible Responses
// backend such as CLIProxyAPI. This path uses an API key + base URL instead of
// direct ChatGPT OAuth headers.
export function shouldUseCompatibleResponsesBackend(): boolean {
  const proxyBaseUrl = process.env['CLIPROXYAPI_BASE_URL']?.trim()
  const openAiBaseUrl = process.env['OPENAI_BASE_URL']?.trim()
  const apiKey = process.env['CLIPROXYAPI_API_KEY']?.trim() || process.env['OPENAI_API_KEY']?.trim()
  return Boolean(apiKey && (proxyBaseUrl || openAiBaseUrl))
}

// Check if a provider has a key available (from env or stored credentials).
// Returns the source of the key for display purposes.
export function getKeyStatus(provider: string): {
  available: boolean
  source: 'env' | 'stored' | 'oauth' | 'none'
} {
  const info = PROVIDERS[provider]
  if (!info) {
    return { available: false, source: 'none' }
  }

  // ChatGPT OAuth is a special case
  if (provider === 'chatgpt') {
    const auth = getChatGptAuth()
    if (auth) {
      return { available: true, source: 'oauth' }
    }
    return { available: false, source: 'none' }
  }

  if (process.env[info.envVar]) {
    return { available: true, source: 'env' }
  }
  const stored = getProviderKey(provider)
  if (stored) {
    return { available: true, source: 'stored' }
  }
  return { available: false, source: 'none' }
}
