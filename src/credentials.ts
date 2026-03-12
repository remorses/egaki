// Credential storage for egaki.
// Reads and writes API keys from ~/.config/egaki/credentials.json.
// Keys are stored per-provider and injected as env vars at runtime.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AntigravityAuth } from './antigravity-auth.js'

export type ProviderInfo = {
  envVar: string
  label: string
  hint: string
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
  antigravity: {
    envVar: 'ANTIGRAVITY_ACCESS_TOKEN',
    label: 'Antigravity (Google OAuth)',
    hint: 'Sign in with your Google account via browser OAuth',
    oauth: true,
  },
  google: {
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    label: 'Google AI (Gemini, Imagen)',
    hint: 'Get your key at https://aistudio.google.com/apikey',
  },
  openai: {
    envVar: 'OPENAI_API_KEY',
    label: 'OpenAI (DALL-E)',
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

export const EGAKI_GATEWAY_URL = 'https://egaki.org/v1/ai'

function getConfigDir(): string {
  // XDG_CONFIG_HOME or ~/.config/egaki
  const xdg = process.env['XDG_CONFIG_HOME']
  const base = xdg || path.join(os.homedir(), '.config')
  return path.join(base, 'egaki')
}

function getCredentialsPath(): string {
  return path.join(getConfigDir(), 'credentials.json')
}

export type CredentialValue = string | AntigravityAuth
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

export function saveAntigravityAuth(auth: AntigravityAuth): void {
  const creds = readCredentials()
  creds['antigravity'] = auth
  writeCredentials(creds)
}

export function getAntigravityAuth(): AntigravityAuth | undefined {
  const creds = readCredentials()
  const val = creds['antigravity']
  if (val && typeof val === 'object' && 'refresh' in val && 'access' in val) {
    return val as AntigravityAuth
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

// Inject all stored credentials as env vars so the AI SDK
// providers pick them up automatically. Env vars already set
// by the user take precedence (we don't overwrite them).
export function injectCredentialsToEnv(): void {
  const creds = readCredentials()
  for (const [provider, value] of Object.entries(creds)) {
    const info = PROVIDERS[provider]
    if (!info) {
      continue
    }
    if (provider === 'antigravity') {
      continue
    }
    if (typeof value === 'string' && !process.env[info.envVar]) {
      process.env[info.envVar] = value
    }
  }
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

  if (provider === 'antigravity') {
    const auth = getAntigravityAuth()
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
