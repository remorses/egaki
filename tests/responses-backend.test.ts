import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveResponsesBackend } from '../src/responses-backend.js'
import { shouldUseCompatibleResponsesBackend } from '../src/credentials.js'
import { shouldUseResponsesApi } from '../src/models.js'

const ENV_KEYS = [
  'CLIPROXYAPI_BASE_URL',
  'CLIPROXYAPI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
] as const

function withEnv(
  updates: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  run: () => void,
): void {
  const previous = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key])
    const next = updates[key]
    if (next === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = next
    }
  }

  try {
    run()
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('resolveResponsesBackend uses direct ChatGPT OAuth by default', () => {
  withEnv(
    {
      CLIPROXYAPI_BASE_URL: undefined,
      CLIPROXYAPI_API_KEY: undefined,
      OPENAI_BASE_URL: undefined,
      OPENAI_API_KEY: undefined,
    },
    () => {
      const backend = resolveResponsesBackend({
        access: 'chatgpt-token',
        accountId: 'acct_123',
      })

      assert.equal(backend.kind, 'chatgpt')
      assert.equal(backend.label, 'ChatGPT OAuth')
      assert.equal(backend.url, 'https://chatgpt.com/backend-api/codex/responses')
      assert.equal(backend.headers.Authorization, 'Bearer chatgpt-token')
      assert.equal(backend.headers['ChatGPT-Account-ID'], 'acct_123')
    },
  )
})

test('resolveResponsesBackend prefers CLIProxyAPI when configured', () => {
  withEnv(
    {
      CLIPROXYAPI_BASE_URL: 'http://127.0.0.1:8317',
      CLIPROXYAPI_API_KEY: 'sk-cliproxy',
      OPENAI_BASE_URL: undefined,
      OPENAI_API_KEY: undefined,
    },
    () => {
      const backend = resolveResponsesBackend()

      assert.equal(backend.kind, 'compatible')
      assert.equal(backend.label, 'CLIProxyAPI')
      assert.equal(backend.url, 'http://127.0.0.1:8317/v1/responses')
      assert.equal(backend.headers.Authorization, 'Bearer sk-cliproxy')
      assert.equal(backend.headers['ChatGPT-Account-ID'], undefined)
    },
  )
})

test('resolveResponsesBackend uses OPENAI_BASE_URL as a generic compatible fallback', () => {
  withEnv(
    {
      CLIPROXYAPI_BASE_URL: undefined,
      CLIPROXYAPI_API_KEY: undefined,
      OPENAI_BASE_URL: 'https://proxy.example.com/custom/v1/',
      OPENAI_API_KEY: 'sk-openai-compatible',
    },
    () => {
      const backend = resolveResponsesBackend()

      assert.equal(backend.kind, 'compatible')
      assert.equal(backend.label, 'OpenAI-compatible proxy')
      assert.equal(backend.url, 'https://proxy.example.com/custom/v1/responses')
      assert.equal(backend.headers.Authorization, 'Bearer sk-openai-compatible')
    },
  )
})

test('shouldUseResponsesApi enables OpenAI image models for compatible proxies', () => {
  withEnv(
    {
      CLIPROXYAPI_BASE_URL: 'http://127.0.0.1:8317',
      CLIPROXYAPI_API_KEY: 'sk-cliproxy',
      OPENAI_BASE_URL: undefined,
      OPENAI_API_KEY: undefined,
    },
    () => {
      assert.equal(shouldUseCompatibleResponsesBackend(), true)
      assert.equal(shouldUseResponsesApi('gpt-image-1.5'), true)
      assert.equal(shouldUseResponsesApi('imagen-4.0-generate-001'), false)
    },
  )
})
