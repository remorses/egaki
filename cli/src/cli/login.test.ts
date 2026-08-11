// Tests login command routing before any prompt, key read, or OAuth side effect.
import { describe, expect, test } from 'vitest'
import { resolveLoginAction } from './login.js'

describe('resolveLoginAction', () => {
  test('shows all configured providers', () => {
    expect(resolveLoginAction({
      options: { show: true },
      daemonProvider: undefined,
      isAgent: false,
    })).toMatchInlineSnapshot(`
      {
        "type": "show",
      }
    `)
  })

  test('removes a configured provider', () => {
    expect(resolveLoginAction({
      options: { remove: 'google' },
      daemonProvider: undefined,
      isAgent: false,
    })).toMatchInlineSnapshot(`
      {
        "provider": "google",
        "type": "remove",
      }
    `)
  })

  test('runs the OAuth provider passed to the daemon', () => {
    expect(resolveLoginAction({
      options: {},
      daemonProvider: 'chatgpt',
      isAgent: true,
    })).toMatchInlineSnapshot(`
      {
        "provider": "chatgpt",
        "type": "oauth-daemon",
      }
    `)
  })

  test('rejects a non-OAuth daemon provider', () => {
    expect(resolveLoginAction({
      options: {},
      daemonProvider: 'google',
      isAgent: true,
    })).toMatchInlineSnapshot(`
      [Error: Invalid background login provider: google]
    `)
  })

  test('starts an explicit OAuth provider through the daemon client', () => {
    expect(resolveLoginAction({
      options: { provider: 'xai-oauth' },
      daemonProvider: undefined,
      isAgent: true,
    })).toMatchInlineSnapshot(`
      {
        "provider": "xai-oauth",
        "type": "oauth-client",
      }
    `)
  })

  test('saves an explicit API key in the foreground', () => {
    expect(resolveLoginAction({
      options: { provider: 'google', key: 'secret' },
      daemonProvider: undefined,
      isAgent: true,
    })).toMatchInlineSnapshot(`
      {
        "key": "secret",
        "provider": "google",
        "type": "api-key",
      }
    `)
  })

  test('reads an omitted API key from stdin', () => {
    expect(resolveLoginAction({
      options: { provider: 'google' },
      daemonProvider: undefined,
      isAgent: true,
    })).toMatchInlineSnapshot(`
      {
        "key": undefined,
        "provider": "google",
        "type": "api-key",
      }
    `)
  })

  test('uses the provider picker for an interactive user', () => {
    expect(resolveLoginAction({
      options: {},
      daemonProvider: undefined,
      isAgent: false,
    })).toMatchInlineSnapshot(`
      {
        "type": "interactive",
      }
    `)
  })

  test('does not open an interactive prompt for an agent', () => {
    expect(resolveLoginAction({
      options: {},
      daemonProvider: undefined,
      isAgent: true,
    })).toMatchInlineSnapshot(`
      [Error: Missing --provider. Run egaki login --provider <name>.]
    `)
  })
})
