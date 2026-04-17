// ChatGPT OAuth authentication for egaki.
// Implements the same OAuth 2.0 PKCE browser flow used by OpenAI Codex CLI.
// Tokens are stored inside credentials.json under the 'chatgpt' key as a
// structured object (not a plain string like other providers).
//
// Tokens are stored so egaki can reuse the ChatGPT login for Codex-style
// backend requests and refresh them when needed.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { spinner, log, note } from '@clack/prompts'
import pc from 'picocolors'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const OAUTH_PORT = 1455
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/auth/callback`

// ─── types ───────────────────────────────────────────────────────────────────

export type ChatGptAuth = {
  email?: string
  accountId?: string
  plan?: string
  refresh: string
  access: string
  expires: number
}

type OAuthTokens = {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

type PendingOAuth = {
  verifier: string
  state: string
  resolve: (tokens: OAuthTokens) => void
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
  const verifier = randomString(43)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(hash) }
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

// ─── JWT parsing ─────────────────────────────────────────────────────────────

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  const payload = parts[1]
  if (!payload) return undefined
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function extractEmail(tokens: OAuthTokens): string | undefined {
  const idClaims = tokens.id_token ? parseJwtClaims(tokens.id_token) : undefined
  const accessClaims = parseJwtClaims(tokens.access_token)
  return (
    (typeof idClaims?.email === 'string' ? idClaims.email : undefined) ??
    (typeof accessClaims?.email === 'string' ? accessClaims.email : undefined)
  )
}

function extractPlanTypeFromTokens(tokens: OAuthTokens): string | undefined {
  const idClaims = tokens.id_token ? parseJwtClaims(tokens.id_token) : undefined
  const accessClaims = parseJwtClaims(tokens.access_token)
  const idAuth = idClaims?.['https://api.openai.com/auth'] as { chatgpt_plan_type?: string } | undefined
  const accessAuth = accessClaims?.['https://api.openai.com/auth'] as
    | { chatgpt_plan_type?: string }
    | undefined
  return idAuth?.chatgpt_plan_type ?? accessAuth?.chatgpt_plan_type
}

function extractAccountId(tokens: OAuthTokens): string | undefined {
  const idClaims = tokens.id_token ? parseJwtClaims(tokens.id_token) : undefined
  const accessClaims = parseJwtClaims(tokens.access_token)

  const idAuth = idClaims?.['https://api.openai.com/auth'] as Record<string, unknown> | undefined
  const accessAuth = accessClaims?.['https://api.openai.com/auth'] as
    | Record<string, unknown>
    | undefined

  return (
    (typeof idClaims?.chatgpt_account_id === 'string' ? idClaims.chatgpt_account_id : undefined) ??
    (typeof idAuth?.chatgpt_account_id === 'string' ? idAuth.chatgpt_account_id : undefined) ??
    (typeof accessClaims?.chatgpt_account_id === 'string'
      ? accessClaims.chatgpt_account_id
      : undefined) ??
    (typeof accessAuth?.chatgpt_account_id === 'string'
      ? accessAuth.chatgpt_account_id
      : undefined)
  )
}

/** Extract the ChatGPT plan type (e.g. "plus", "pro") from the access token. */
export function extractPlanType(auth: ChatGptAuth): string | undefined {
  if (auth.plan) return auth.plan
  const claims = parseJwtClaims(auth.access)
  const authClaim = claims?.['https://api.openai.com/auth'] as
    | { chatgpt_plan_type?: string }
    | undefined
  return authClaim?.chatgpt_plan_type
}

// ─── OAuth URL + token exchange ──────────────────────────────────────────────

function buildAuthorizeUrl(pkce: { challenge: string }, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'egaki',
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

async function exchangeCodeForTokens(code: string, verifier: string): Promise<OAuthTokens> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return (await response.json()) as OAuthTokens
}

// ─── local callback server ───────────────────────────────────────────────────

const HTML_SUCCESS = `<!doctype html>
<html><body style="font-family:system-ui;text-align:center;padding:4em">
<h1>Authorization Successful</h1>
<p>You can close this window and return to the terminal.</p>
</body></html>`

const htmlError = (error: string) =>
  `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:4em">
<h1>Authorization Failed</h1><pre>${error}</pre></body></html>`

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined

function handleOAuthRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://localhost:${OAUTH_PORT}`)

  if (url.pathname !== '/auth/callback') {
    res.statusCode = 404
    res.end('Not found')
    return
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (error) {
    const message = errorDescription || error
    pendingOAuth?.reject(new Error(message))
    pendingOAuth = undefined
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/html')
    res.end(htmlError(message))
    return
  }

  if (!code) {
    const message = 'Missing authorization code'
    pendingOAuth?.reject(new Error(message))
    pendingOAuth = undefined
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/html')
    res.end(htmlError(message))
    return
  }

  if (!pendingOAuth || state !== pendingOAuth.state) {
    const message = 'Invalid state — potential CSRF attack'
    pendingOAuth?.reject(new Error(message))
    pendingOAuth = undefined
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/html')
    res.end(htmlError(message))
    return
  }

  const current = pendingOAuth
  pendingOAuth = undefined
  exchangeCodeForTokens(code, current.verifier)
    .then((tokens) => current.resolve(tokens))
    .catch((err) => current.reject(err instanceof Error ? err : new Error(String(err))))

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html')
  res.end(HTML_SUCCESS)
}

async function startOAuthServer(): Promise<void> {
  if (oauthServer) return
  oauthServer = createServer(handleOAuthRequest)
  await new Promise<void>((resolve, reject) => {
    oauthServer?.once('error', reject)
    oauthServer?.listen(OAUTH_PORT, '127.0.0.1', () => resolve())
  })
}

async function stopOAuthServer(): Promise<void> {
  if (!oauthServer) return
  await new Promise<void>((resolve) => oauthServer?.close(() => resolve()))
  oauthServer = undefined
}

function waitForOAuthCallback(verifier: string, state: string): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error('OAuth callback timeout — authorization took too long'))
        }
      },
      5 * 60 * 1000,
    )

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

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' })
  child.unref()
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Run the full ChatGPT OAuth browser flow with clack UI.
 * Returns the ChatGptAuth object to be stored in credentials.json.
 */
export async function chatGptOAuthLogin(): Promise<ChatGptAuth> {
  await startOAuthServer()

  const pkce = await generatePKCE()
  const state = generateState()
  const authUrl = buildAuthorizeUrl(pkce, state)
  const callbackPromise = waitForOAuthCallback(pkce.verifier, state)

  note(
    `Open this URL in your browser to sign in with your ChatGPT account:\n\n` +
      `  ${pc.cyan(pc.underline(authUrl))}\n\n` +
      `${pc.dim(`Listening for callback on ${REDIRECT_URI}`)}`,
    'ChatGPT OAuth',
  )

  openBrowser(authUrl)

  const s = spinner()
  s.start('Waiting for authorization in browser...')

  let tokens: OAuthTokens
  try {
    tokens = await callbackPromise
  } finally {
    await stopOAuthServer()
  }

  s.stop('Authorization received')

  const now = Date.now()
  const auth: ChatGptAuth = {
    email: extractEmail(tokens),
    accountId: extractAccountId(tokens),
    plan: extractPlanTypeFromTokens(tokens),
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: now + (tokens.expires_in ?? 3600) * 1000,
  }

  const plan = extractPlanType(auth)
  const label = auth.email ?? auth.accountId ?? 'unknown'
  log.success(
    `Signed in as ${pc.bold(label)}` + (plan ? ` (${pc.cyan(plan)} plan)` : ''),
  )

  return auth
}

/**
 * Refresh an expired ChatGPT access token using the refresh token.
 * Returns the updated auth object, or an Error if refresh fails.
 */
export async function refreshChatGptToken(auth: ChatGptAuth): Promise<ChatGptAuth | Error> {
  try {
    const response = await fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh,
        client_id: CLIENT_ID,
      }).toString(),
    })
    if (!response.ok) {
      return new Error(`Token refresh failed: ${response.status}`)
    }
    const json = (await response.json()) as OAuthTokens
    return {
      ...auth,
      plan: extractPlanTypeFromTokens(json) ?? auth.plan,
      access: json.access_token,
      refresh: json.refresh_token ?? auth.refresh,
      expires: Date.now() + (json.expires_in ?? 3600) * 1000,
    }
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

/**
 * Refresh the auth object if needed and return the full updated state.
 */
export async function getValidChatGptAuth(
  auth: ChatGptAuth,
  onRefresh?: (updated: ChatGptAuth) => void,
): Promise<ChatGptAuth | Error> {
  if (auth.expires > Date.now() + 60_000) {
    return auth
  }

  const refreshed = await refreshChatGptToken(auth)
  if (refreshed instanceof Error) return refreshed
  onRefresh?.(refreshed)
  return refreshed
}
