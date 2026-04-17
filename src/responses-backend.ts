import type { ChatGptAuth } from './chatgpt-auth.js'

export type ResponsesBackend = {
  kind: 'chatgpt' | 'compatible'
  label: string
  url: string
  headers: Record<string, string>
}

const DIRECT_CHATGPT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function buildCompatibleResponsesUrl(): { label: string; url: string } | undefined {
  const cliproxyBaseUrl = process.env['CLIPROXYAPI_BASE_URL']?.trim()
  if (cliproxyBaseUrl) {
    const normalizedBaseUrl = trimTrailingSlash(cliproxyBaseUrl)
    const openAiBaseUrl = normalizedBaseUrl.endsWith('/v1')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`
    return {
      label: 'CLIProxyAPI',
      url: `${openAiBaseUrl}/responses`,
    }
  }

  const openAiBaseUrl = process.env['OPENAI_BASE_URL']?.trim()
  if (!openAiBaseUrl) {
    return undefined
  }

  return {
    label: 'OpenAI-compatible proxy',
    url: `${trimTrailingSlash(openAiBaseUrl)}/responses`,
  }
}

function getCompatibleResponsesApiKey(): string | undefined {
  return process.env['CLIPROXYAPI_API_KEY']?.trim() || process.env['OPENAI_API_KEY']?.trim()
}

// Resolve which Responses backend should handle OpenAI image generation. The
// direct ChatGPT path preserves the Codex OAuth behavior, while compatible
// proxies use a standard Bearer API key and /v1/responses URL.
export function resolveResponsesBackend(auth?: Pick<ChatGptAuth, 'access' | 'accountId'>): ResponsesBackend {
  const compatibleBackend = buildCompatibleResponsesUrl()
  const compatibleApiKey = getCompatibleResponsesApiKey()
  if (compatibleBackend && compatibleApiKey) {
    return {
      kind: 'compatible',
      label: compatibleBackend.label,
      url: compatibleBackend.url,
      headers: {
        Authorization: `Bearer ${compatibleApiKey}`,
        'Content-Type': 'application/json',
      },
    }
  }

  if (!auth?.accountId) {
    throw new Error('Missing ChatGPT account metadata. Please run `egaki login --provider chatgpt` again.')
  }

  return {
    kind: 'chatgpt',
    label: 'ChatGPT OAuth',
    url: DIRECT_CHATGPT_RESPONSES_URL,
    headers: {
      Authorization: `Bearer ${auth.access}`,
      'ChatGPT-Account-ID': auth.accountId,
      'Content-Type': 'application/json',
    },
  }
}
