// ChatGPT OAuth authentication for egaki.
// Implements the same OAuth 2.0 PKCE browser flow used by OpenAI Codex CLI.
// Tokens are stored inside credentials.json under the 'chatgpt' key as a
// structured object (not a plain string like other providers).
//
// Tokens are stored so egaki can reuse the ChatGPT login for Codex-style
// backend requests and refresh them when needed.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spinner, log, note } from '@clack/prompts'
import { colors as pc } from 'goke'
import { z } from 'zod'
import { openUrlInBrowser } from './open-browser.js'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
// 1457 is the Codex fallback. The shared client allow-list accepts both.
const OAUTH_PORTS = [1455, 1457]

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
  redirectUri: string
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

// ─── JWT parsing ─────────────────────────────────────────────────────────────

const jwtClaimsSchema = z.object({
  email: z.string().optional(),
  chatgpt_account_id: z.string().optional(),
  'https://api.openai.com/auth': z.object({
    chatgpt_account_id: z.string().optional(),
    chatgpt_plan_type: z.string().optional(),
  }).optional(),
})

function parseJwtClaims(token: string): z.infer<typeof jwtClaimsSchema> | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  const payload = parts[1]
  if (!payload) return undefined
  try {
    return jwtClaimsSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString()),
    )
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
  const idAuth = idClaims?.['https://api.openai.com/auth']
  const accessAuth = accessClaims?.['https://api.openai.com/auth']
  return idAuth?.chatgpt_plan_type ?? accessAuth?.chatgpt_plan_type
}

function extractAccountId(tokens: OAuthTokens): string | undefined {
  const idClaims = tokens.id_token ? parseJwtClaims(tokens.id_token) : undefined
  const accessClaims = parseJwtClaims(tokens.access_token)

  const idAuth = idClaims?.['https://api.openai.com/auth']
  const accessAuth = accessClaims?.['https://api.openai.com/auth']

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
  const authClaim = claims?.['https://api.openai.com/auth']
  return authClaim?.chatgpt_plan_type
}

// ─── OAuth URL + token exchange ──────────────────────────────────────────────

function buildAuthorizeUrl({
  challenge,
  state,
  redirectUri,
}: {
  challenge: string
  state: string
  redirectUri: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'egaki',
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

async function exchangeCodeForTokens({
  code,
  verifier,
  redirectUri,
}: {
  code: string
  verifier: string
  redirectUri: string
}): Promise<OAuthTokens> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Token exchange failed: ${response.status}${body ? ` ${body}` : ''}. The previous ChatGPT login was not replaced.`,
    )
  }
  return (await response.json()) as OAuthTokens
}

export function isRevokedChatGptAccessToken(status: number, body: string): boolean {
  return (
    status === 401 &&
    (body.includes('token_revoked') || body.includes('invalidated oauth token'))
  )
}

export function oauthCallbackAction({
  pendingState,
  callbackState,
  error,
  code,
}: {
  pendingState: string | undefined
  callbackState: string | null
  error: string | null
  code: string | null
}): 'ignore' | 'provider-error' | 'missing-code' | 'exchange' {
  if (!pendingState || callbackState !== pendingState) return 'ignore'
  if (error) return 'provider-error'
  if (!code) return 'missing-code'
  return 'exchange'
}

export function chatGptReLoginMessage({
  status,
  body,
}: {
  status: number
  body: string
}): string {
  const detail = body.trim()
  return `ChatGPT rejected the saved login (${status}${detail ? `: ${detail}` : ''}). Run: egaki login --provider chatgpt`
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

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function sendHtml({
  res,
  status,
  html,
}: {
  res: ServerResponse
  status: number
  html: string
}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Connection', 'close')
  res.end(html)
}

function failCallback(res: ServerResponse, message: string) {
  pendingOAuth?.reject(new Error(message))
  pendingOAuth = undefined
  sendHtml({ res, status: 400, html: htmlError(escapeHtml(message)) })
}

const OAUTH_HOST = '127.0.0.1'
let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined

// Browser success used to be sent before token exchange. The page then said
// login was done while credentials.json stayed unchanged.
async function handleOAuthRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (url.pathname !== '/auth/callback') {
    res.statusCode = 404
    res.end('Not found')
    return
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  const action = oauthCallbackAction({
    pendingState: pendingOAuth?.state,
    callbackState: state,
    error,
    code,
  })
  if (action === 'ignore') {
    sendHtml({
      res,
      status: 400,
      html: htmlError(escapeHtml(
        'Invalid state. This callback does not match the active egaki login.',
      )),
    })
    return
  }

  if (action === 'provider-error') {
    failCallback(res, errorDescription || error || 'Authorization failed')
    return
  }

  if (action === 'missing-code' || !code) {
    failCallback(res, 'Missing authorization code. The previous ChatGPT login was not replaced.')
    return
  }

  const current = pendingOAuth
  if (!current) {
    sendHtml({
      res,
      status: 400,
      html: htmlError(escapeHtml('Invalid state. This callback does not match the active egaki login.')),
    })
    return
  }
  pendingOAuth = undefined
  try {
    const tokens = await exchangeCodeForTokens({
      code,
      verifier: current.verifier,
      redirectUri: current.redirectUri,
    })
    sendHtml({ res, status: 200, html: HTML_SUCCESS })
    current.resolve(tokens)
  } catch (err) {
    const failure = err instanceof Error ? err : new Error(String(err))
    current.reject(failure)
    sendHtml({ res, status: 400, html: htmlError(escapeHtml(failure.message)) })
  }
}

function listen(server: ReturnType<typeof createServer>, port: number) {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.close()
      reject(err)
    }
    server.once('error', onError)
    server.listen(port, OAUTH_HOST, () => {
      server.removeListener('error', onError)
      resolve()
    })
  })
}

// Use 127.0.0.1 in the redirect. localhost can resolve to ::1 and miss this listener.
async function startOAuthServer(): Promise<number> {
  if (oauthServer) {
    const address = oauthServer.address()
    if (address && typeof address === 'object') return address.port
  }
  const errors: string[] = []
  for (const port of OAUTH_PORTS) {
    const server = createServer((req, res) => {
      void handleOAuthRequest(req, res)
    })
    try {
      await listen(server, port)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${OAUTH_HOST}:${port} ${message}`)
      continue
    }
    oauthServer = server
    return port
  }
  throw new Error(
    `Could not listen for the ChatGPT login callback. ${errors.join(' ')} Close Codex or another egaki login, then run egaki login --provider chatgpt again.`,
  )
}

async function stopOAuthServer(): Promise<void> {
  const server = oauthServer
  oauthServer = undefined
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

function waitForOAuthCallback({
  verifier,
  state,
  redirectUri,
}: {
  verifier: string
  state: string
  redirectUri: string
}): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error(
            'OAuth callback timeout. The browser sign-in did not reach this process, so the previous ChatGPT login was not replaced.',
          ))
        }
      },
      5 * 60 * 1000,
    )

    pendingOAuth = {
      verifier,
      state,
      redirectUri,
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

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Run the full ChatGPT OAuth browser flow with clack UI.
 * Returns the ChatGptAuth object to be stored in credentials.json.
 */
export async function chatGptOAuthLogin({
  openInBackground = false,
} = {}): Promise<ChatGptAuth> {
  const port = await startOAuthServer()
  const redirectUri = `http://${OAUTH_HOST}:${port}/auth/callback`

  const pkce = await generatePKCE()
  const state = base64UrlEncode(
    crypto.getRandomValues(new Uint8Array(32)).buffer,
  )
  const authUrl = buildAuthorizeUrl({
    challenge: pkce.challenge,
    state,
    redirectUri,
  })
  const callbackPromise = waitForOAuthCallback({
    verifier: pkce.verifier,
    state,
    redirectUri,
  })

  note(
    `Open this URL in your browser to sign in with your ChatGPT account:\n\n` +
      `  ${pc.cyan(pc.underline(authUrl))}\n\n` +
      `${pc.dim(`Listening for callback on ${redirectUri}`)}\n` +
      `${pc.dim('The previous login stays saved until this command prints that the new login was saved.')}`,
    'ChatGPT OAuth',
  )

  const opened = openUrlInBrowser(authUrl, {
    allowNonInteractive: openInBackground,
  })
  if (openInBackground && !opened) {
    const error = new Error('Could not open a browser for ChatGPT authorization')
    pendingOAuth?.reject(error)
    pendingOAuth = undefined
    await stopOAuthServer()
    await callbackPromise
    throw error
  }

  const s = spinner()
  s.start('Waiting for authorization in browser...')

  let tokens: OAuthTokens
  try {
    tokens = await callbackPromise
  } catch (err) {
    s.stop('ChatGPT sign-in did not save new credentials')
    throw err instanceof Error ? err : new Error(String(err))
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
type OAuthRefreshTokens = {
  id_token?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

type RefreshFlight = {
  source: string
  result: Promise<ChatGptAuth | Error>
}

let refreshFlight: RefreshFlight | undefined

async function performChatGptTokenRefresh(auth: ChatGptAuth): Promise<ChatGptAuth | Error> {
  try {
    const response = await fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh,
        client_id: CLIENT_ID,
      }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      if (response.status === 401) {
        return new Error(chatGptReLoginMessage({ status: response.status, body }))
      }
      return new Error(`Token refresh failed: ${response.status}${body ? ` ${body}` : ''}`)
    }
    const json = (await response.json()) as OAuthRefreshTokens
    if (!json.access_token) {
      return new Error(
        'ChatGPT token refresh did not return an access token. Run: egaki login --provider chatgpt',
      )
    }
    const tokens: OAuthTokens = {
      id_token: json.id_token,
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? auth.refresh,
      expires_in: json.expires_in,
    }
    return {
      ...auth,
      plan: extractPlanTypeFromTokens(tokens) ?? auth.plan,
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + (json.expires_in ?? 3600) * 1000,
    }
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

export function refreshChatGptToken(auth: ChatGptAuth): Promise<ChatGptAuth | Error> {
  if (refreshFlight?.source === auth.refresh) return refreshFlight.result
  const result = performChatGptTokenRefresh(auth)
  refreshFlight = { source: auth.refresh, result }
  void result.then((value) => {
    if (value instanceof Error && refreshFlight?.result === result) {
      refreshFlight = undefined
    }
  })
  return result
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
