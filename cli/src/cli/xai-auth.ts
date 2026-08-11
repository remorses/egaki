// xAI OAuth authentication for egaki.
// Implements the same OAuth 2.0 PKCE browser flow used by xAI's Grok CLI
// and the OpenCode xAI plugin. Tokens grant access to the full xAI API
// (api.x.ai/v1) including image and video generation endpoints.
//
// Two auth methods:
//   1. Browser flow: loopback server on 127.0.0.1:56121 (pinned to match Grok-CLI registration)
//   2. Device code flow (RFC 8628): headless/VPS environments, no loopback needed
//
// Tokens are stored in credentials.json under the 'xai-oauth' key as a structured
// XaiAuth object. The access token is injected as a bearer token via custom fetch
// when creating the @ai-sdk/xai provider instance.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spinner, log, note } from '@clack/prompts'
import { colors as pc } from 'goke'
import { z } from 'zod'
import { openUrlInBrowser } from './open-browser.js'
import pkg from '../../package.json' with { type: 'json' }

// Public Grok-CLI OAuth client. xAI's auth server rejects loopback OAuth from
// non-allowlisted clients, so we reuse the Grok-CLI client_id that xAI ships
// for desktop OAuth flows.
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const AUTHORIZE_URL = 'https://auth.x.ai/oauth2/authorize'
const TOKEN_URL = 'https://auth.x.ai/oauth2/token'
const DEVICE_AUTHORIZATION_URL = 'https://auth.x.ai/oauth2/device/code'
const SCOPE = 'openid profile email offline_access grok-cli:access api:access'

// The loopback server must bind to this exact host:port pair — it's registered
// with xAI for the Grok-CLI client.
const OAUTH_HOST = '127.0.0.1'
const OAUTH_PORT = 56121
const OAUTH_REDIRECT_PATH = '/callback'
const REDIRECT_URI = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`

const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000

// ─── types ───────────────────────────────────────────────────────────────────

export type XaiAuth = {
  email?: string
  access: string
  refresh: string
  expires: number
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number().optional(),
})

type TokenResponse = z.infer<typeof tokenResponseSchema>

type PendingOAuth = {
  verifier: string
  state: string
  resolve: (tokens: TokenResponse & { refresh_token: string }) => void
  reject: (error: Error) => void
}

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('')
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(64)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(hash) }
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': `egaki/${pkg.version}`,
  }
}

// ─── JWT helpers ─────────────────────────────────────────────────────────────

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  let payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
  while (payload.length % 4 !== 0) payload += '='
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch {
    return undefined
  }
}

function extractEmailFromToken(idToken?: string): string | undefined {
  if (!idToken) return undefined
  const claims = parseJwtClaims(idToken)
  return typeof claims?.email === 'string' ? claims.email : undefined
}

/** Returns true if the access token's exp claim is within the skew window. */
export function accessTokenIsExpiring(
  token: string | undefined,
  skewMs: number = ACCESS_TOKEN_REFRESH_SKEW_MS,
): boolean {
  if (!token) return false
  const claims = parseJwtClaims(token)
  if (typeof claims?.exp !== 'number') return false
  return claims.exp * 1000 <= Date.now() + Math.max(0, skewMs)
}

// ─── token exchange ──────────────────────────────────────────────────────────

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
): Promise<TokenResponse & { refresh_token: string }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`xAI token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  const tokens = tokenResponseSchema.parse(await response.json())
  const refreshToken = tokens.refresh_token
  if (!refreshToken) throw new Error('xAI token response was missing refresh_token')
  return { ...tokens, refresh_token: refreshToken }
}

export async function refreshXaiToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`xAI token refresh failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  return tokenResponseSchema.parse(await response.json())
}

// ─── loopback server + browser flow ──────────────────────────────────────────

const HTML_SUCCESS = `<!doctype html>
<html><head><title>egaki - xAI Authorization Successful</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec}.container{text-align:center;padding:2rem}h1{margin-bottom:1rem}p{color:#b7b1b1}</style>
</head><body><div class="container"><h1>Authorization Successful</h1><p>You can close this window and return to egaki.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`

function htmlError(error: string): string {
  const escaped = error.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return map[c] || c
  })
  return `<!doctype html>
<html><head><title>egaki - xAI Authorization Failed</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec}.container{text-align:center;padding:2rem}h1{color:#fc533a;margin-bottom:1rem}p{color:#b7b1b1}.error{color:#ff917b;font-family:monospace;margin-top:1rem;padding:1rem;background:#3c140d;border-radius:.5rem}</style>
</head><body><div class="container"><h1>Authorization Failed</h1><p>An error occurred during authorization.</p><div class="error">${escaped}</div></div></body></html>`
}

let pendingOAuth: PendingOAuth | undefined

function startOAuthServer(): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://${OAUTH_HOST}:${OAUTH_PORT}`)

      if (url.pathname !== OAUTH_REDIRECT_PATH) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')

      if (error) {
        const msg = errorDescription || error
        pendingOAuth?.reject(new Error(msg))
        pendingOAuth = undefined
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(htmlError(msg))
        return
      }

      if (!code) {
        // Missing code but no explicit error. Don't destroy pendingOAuth;
        // could be a stray browser request, not the real callback.
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(htmlError('Missing authorization code'))
        return
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        // Bad state: respond 400 but keep pendingOAuth intact so the real
        // callback can still succeed. Clearing it here would let a random
        // local request to :56121/callback?code=x&state=bad kill the
        // legitimate login attempt (local DoS).
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(htmlError('Invalid state — potential CSRF attack'))
        return
      }

      const current = pendingOAuth
      pendingOAuth = undefined

      exchangeCodeForTokens(code, current.verifier)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err))

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(HTML_SUCCESS)
    })

    server.once('error', reject)
    server.listen(OAUTH_PORT, OAUTH_HOST, () => {
      server.removeListener('error', reject)
      // Swallow subsequent errors so they don't crash the process
      server.on('error', () => {})
      resolve(server)
    })
  })
}

function waitForOAuthCallback(
  verifier: string,
  state: string,
): Promise<TokenResponse & { refresh_token: string }> {
  if (pendingOAuth) {
    pendingOAuth.reject(new Error('Superseded by a newer xAI authorize request'))
    pendingOAuth = undefined
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingOAuth) {
        pendingOAuth = undefined
        reject(new Error('OAuth callback timeout — authorization took too long'))
      }
    }, 5 * 60 * 1000)

    pendingOAuth = {
      verifier,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

// ─── public login function ───────────────────────────────────────────────────

/**
 * Run the xAI OAuth browser flow. Opens the system browser for authorization,
 * waits for the callback, and returns an XaiAuth object with tokens.
 */
export async function xaiOAuthLogin({
  openInBackground = false,
} = {}): Promise<XaiAuth> {
  const s = spinner()
  s.start('Starting xAI OAuth server...')

  let server: ReturnType<typeof createServer>
  try {
    server = await startOAuthServer()
  } catch (err) {
    s.stop('Failed to start OAuth server')
    throw new Error(
      `Could not bind to ${OAUTH_HOST}:${OAUTH_PORT}. Is Grok CLI or another egaki instance running? (${err})`,
    )
  }

  const pkce = await generatePKCE()
  const state = generateState()
  const nonce = generateState()

  // `plan=generic` opts into xAI's generic OAuth plan tier.
  // `referrer=egaki` lets xAI attribute egaki-originated logins.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    plan: 'generic',
    referrer: 'egaki',
  })
  const authUrl = `${AUTHORIZE_URL}?${params.toString()}`

  s.stop('OAuth server ready')
  log.info('Opening browser for xAI authorization...')
  note(authUrl, 'If the browser does not open, visit this URL manually')

  // Register the callback listener BEFORE opening the browser. If the user
  // already has an active xAI session, the browser can redirect back to
  // the loopback server almost instantly. Registering after openUrlInBrowser
  // creates a race where the callback arrives before pendingOAuth exists.
  const callbackPromise = waitForOAuthCallback(pkce.verifier, state)

  const opened = openUrlInBrowser(authUrl, {
    allowNonInteractive: openInBackground,
  })
  if (openInBackground && !opened) {
    const error = new Error('Could not open a browser for xAI authorization')
    pendingOAuth?.reject(error)
    pendingOAuth = undefined
    server.close()
    await callbackPromise
    throw error
  }

  s.start('Waiting for authorization...')
  try {
    const tokens = await callbackPromise
    s.stop('Authorization successful')

    const email = extractEmailFromToken(tokens.id_token)
    if (email) {
      log.info(`Signed in as ${pc.bold(email)}`)
    }

    return {
      email,
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    }
  } catch (err) {
    s.stop('Authorization failed')
    throw err
  } finally {
    server.close()
  }
}

// ─── token refresh ───────────────────────────────────────────────────────────

/**
 * Returns a valid XaiAuth, refreshing the access token if it's expired or
 * about to expire. Calls `save` to persist the refreshed tokens.
 */
export async function getValidXaiAuth(
  auth: XaiAuth,
  save: (auth: XaiAuth) => void,
): Promise<XaiAuth | Error> {
  const expiresSoon =
    !auth.expires ||
    auth.expires - Date.now() <= ACCESS_TOKEN_REFRESH_SKEW_MS ||
    accessTokenIsExpiring(auth.access)

  if (!expiresSoon) return auth

  try {
    const tokens = await refreshXaiToken(auth.refresh)
    const refreshed: XaiAuth = {
      email: auth.email,
      access: tokens.access_token,
      refresh: tokens.refresh_token || auth.refresh,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    }
    save(refreshed)
    return refreshed
  } catch (err) {
    return new Error(
      `Failed to refresh xAI token. Please run \`egaki login\` and select xAI again. (${err})`,
    )
  }
}
