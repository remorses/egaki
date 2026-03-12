// Antigravity OAuth authentication for egaki.
// Handles Google OAuth + PKCE for Antigravity accounts and stores
// refresh/access tokens so login status can show the signed-in account.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { log, note, spinner } from '@clack/prompts'
import pc from 'picocolors'

const ANTIGRAVITY_CLIENT_ID = process.env['ANTIGRAVITY_OAUTH_CLIENT_ID']
const ANTIGRAVITY_CLIENT_SECRET = process.env['ANTIGRAVITY_OAUTH_CLIENT_SECRET']
const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:51121/oauth-callback'
const ANTIGRAVITY_PORT = 51121

const ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
]

const GEMINI_CLI_USER_AGENT = 'google-api-nodejs-client/9.15.1'
const LOAD_ENDPOINTS = [
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
]

export type AntigravityAuth = {
  email?: string
  refresh: string
  access: string
  expires: number
  projectId?: string
}

type OAuthTokens = {
  access_token: string
  refresh_token: string
  expires_in?: number
}

type RefreshTokens = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

type UserInfo = {
  email?: string
}

type ResourceManagerProject = {
  projectId?: string
  lifecycleState?: string
}

type LoadCodeAssistPayload = {
  cloudaicompanionProject?: string | { id?: string }
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>
}

type OnboardUserPayload = {
  done?: boolean
  response?: {
    cloudaicompanionProject?: { id?: string }
  }
}

type PendingOAuth = {
  state: string
  verifier: string
  resolve: (tokens: OAuthTokens) => void
  reject: (error: Error) => void
}

type PendingOAuthStore = Record<string, { verifier: string; createdAt: number }>

const PENDING_STATE_TTL_MS = 30 * 60 * 1000
const ANTIGRAVITY_DEFAULT_PROJECT_ID = 'rising-fact-p41fc'

function requireOAuthClientId(): string {
  if (ANTIGRAVITY_CLIENT_ID) {
    return ANTIGRAVITY_CLIENT_ID
  }
  throw new Error('Missing ANTIGRAVITY_OAUTH_CLIENT_ID env var')
}

function requireOAuthClientSecret(): string {
  if (ANTIGRAVITY_CLIENT_SECRET) {
    return ANTIGRAVITY_CLIENT_SECRET
  }
  throw new Error('Missing ANTIGRAVITY_OAUTH_CLIENT_SECRET env var')
}

function getConfigDir(): string {
  const xdg = process.env['XDG_CONFIG_HOME']
  const base = xdg || path.join(os.homedir(), '.config')
  return path.join(base, 'egaki')
}

function getPendingStatePath(): string {
  return path.join(getConfigDir(), 'antigravity-oauth-pending.json')
}

function readPendingStateStore(): PendingOAuthStore {
  const filePath = getPendingStatePath()
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  const json = JSON.parse(raw) as PendingOAuthStore
  const now = Date.now()
  const entries = Object.entries(json).filter(([, entry]) => {
    return now - entry.createdAt < PENDING_STATE_TTL_MS
  })
  return Object.fromEntries(entries)
}

function writePendingStateStore(store: PendingOAuthStore): void {
  const dir = getConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  const filePath = getPendingStatePath()
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
}

function savePendingState(state: string, verifier: string): void {
  const store = readPendingStateStore()
  store[state] = { verifier, createdAt: Date.now() }
  writePendingStateStore(store)
}

function getPendingVerifier(state: string): string | undefined {
  const store = readPendingStateStore()
  return store[state]?.verifier
}

function deletePendingState(state: string): void {
  const store = readPendingStateStore()
  if (!store[state]) {
    return
  }
  delete store[state]
  writePendingStateStore(store)
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = randomBytes(length)
  return Array.from(bytes)
    .map((b) => chars[b % chars.length] ?? 'a')
    .join('')
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomString(64)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function generateState(): string {
  return randomBytes(32).toString('base64url')
}

function buildAuthorizeUrl({ challenge, state }: { challenge: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: requireOAuthClientId(),
    response_type: 'code',
    redirect_uri: ANTIGRAVITY_REDIRECT_URI,
    scope: ANTIGRAVITY_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function exchangeCodeForTokens({ code, verifier }: { code: string; verifier: string }): Promise<OAuthTokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': GEMINI_CLI_USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: requireOAuthClientId(),
      client_secret: requireOAuthClientSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: ANTIGRAVITY_REDIRECT_URI,
      code_verifier: verifier,
    }).toString(),
  })

  if (!response.ok) {
    throw new Error(`Antigravity token exchange failed: ${response.status}`)
  }

  return (await response.json()) as OAuthTokens
}

async function fetchUserEmail(accessToken: string): Promise<string | undefined> {
  const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': GEMINI_CLI_USER_AGENT,
    },
  })
  if (!response.ok) return undefined
  const json = (await response.json()) as UserInfo
  return json.email
}

function getAntigravityClientMetadata(): string {
  return `{"ideType":"ANTIGRAVITY","platform":"${process.platform === 'win32' ? 'WINDOWS' : 'MACOS'}","pluginType":"GEMINI"}`
}

function extractManagedProjectId(payload: LoadCodeAssistPayload | null): string | undefined {
  if (!payload) return undefined
  const project = payload.cloudaicompanionProject
  if (typeof project === 'string' && project.length > 0) return project
  if (project && typeof project === 'object' && typeof project.id === 'string' && project.id.length > 0) {
    return project.id
  }
  return undefined
}

async function loadManagedProject(accessToken: string, projectId?: string): Promise<LoadCodeAssistPayload | null> {
  for (const endpoint of LOAD_ENDPOINTS) {
    const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': GEMINI_CLI_USER_AGENT,
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'Client-Metadata': getAntigravityClientMetadata(),
      },
      body: JSON.stringify({
        metadata: {
          ideType: 'ANTIGRAVITY',
          platform: process.platform === 'win32' ? 'WINDOWS' : 'MACOS',
          pluginType: 'GEMINI',
          ...(projectId ? { duetProject: projectId } : {}),
        },
      }),
    })

    if (!response.ok) continue
    return (await response.json()) as LoadCodeAssistPayload
  }
  return null
}

async function onboardManagedProject(
  accessToken: string,
  tierId: string,
  projectId?: string,
): Promise<string | undefined> {
  const endpoints = [
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://autopush-cloudcode-pa.sandbox.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
  ]

  for (const endpoint of endpoints) {
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`${endpoint}/v1internal:onboardUser`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/1.18.3 Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36',
          'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
          'Client-Metadata': getAntigravityClientMetadata(),
        },
        body: JSON.stringify({
          tierId,
          metadata: {
            ideType: 'ANTIGRAVITY',
            platform: process.platform === 'win32' ? 'WINDOWS' : 'MACOS',
            pluginType: 'GEMINI',
            ...(projectId ? { duetProject: projectId } : {}),
          },
        }),
      })

      if (!response.ok) {
        break
      }

      const json = (await response.json()) as OnboardUserPayload
      const managed = json.response?.cloudaicompanionProject?.id
      if (json.done && managed) {
        return managed
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }

  return undefined
}

async function fetchProjectId(accessToken: string, preferredProjectId?: string): Promise<string | undefined> {
  const loaded = await loadManagedProject(accessToken, preferredProjectId)
  const fromLoad = extractManagedProjectId(loaded)
  if (fromLoad) return fromLoad

  const defaultTier = (loaded?.allowedTiers || []).find((tier) => tier?.isDefault)?.id
    || (loaded?.allowedTiers || [])[0]?.id
    || 'FREE'

  const onboarded = await onboardManagedProject(accessToken, defaultTier, preferredProjectId)
  if (onboarded) {
    return onboarded
  }

  const fromProjectsApi = await fetchProjectIdFromResourceManager(accessToken)
  if (fromProjectsApi) return fromProjectsApi

  return undefined
}

async function fetchProjectIdFromResourceManager(accessToken: string): Promise<string | undefined> {
  const response = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=50', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': GEMINI_CLI_USER_AGENT,
    },
  })

  if (!response.ok) {
    return undefined
  }

  const json = (await response.json()) as { projects?: ResourceManagerProject[] }
  const activeProject = (json.projects || []).find((project) => {
    return project.projectId && project.lifecycleState === 'ACTIVE'
  })
  return activeProject?.projectId
}

async function createAuthFromTokens(tokens: OAuthTokens): Promise<AntigravityAuth> {
  const [email, projectId] = await Promise.all([
    fetchUserEmail(tokens.access_token),
    fetchProjectId(tokens.access_token),
  ])

  return {
    email,
    refresh: formatRefreshParts({ refreshToken: tokens.refresh_token, projectId }),
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    projectId,
  }
}

function parseRefreshParts(refresh: string): { refreshToken: string; projectId?: string } {
  const [refreshToken, projectId] = refresh.split('|')
  return {
    refreshToken: refreshToken || '',
    projectId: projectId && projectId.length > 0 ? projectId : undefined,
  }
}

function formatRefreshParts({ refreshToken, projectId }: { refreshToken: string; projectId?: string }): string {
  return projectId ? `${refreshToken}|${projectId}` : refreshToken
}

export async function refreshAntigravityToken(auth: AntigravityAuth): Promise<AntigravityAuth | Error> {
  const { refreshToken, projectId } = parseRefreshParts(auth.refresh)
  if (!refreshToken) {
    return new Error('Missing refresh token')
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: requireOAuthClientId(),
        client_secret: requireOAuthClientSecret(),
      }).toString(),
    })

    if (!response.ok) {
      return new Error(`Antigravity token refresh failed: ${response.status}`)
    }

    const json = (await response.json()) as RefreshTokens

    return {
      ...auth,
      access: json.access_token,
      refresh: formatRefreshParts({
        refreshToken: json.refresh_token ?? refreshToken,
        projectId: auth.projectId ?? projectId,
      }),
      projectId: auth.projectId ?? projectId,
      expires: Date.now() + (json.expires_in ?? 3600) * 1000,
    }
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

export async function getValidAntigravityAccessToken(
  auth: AntigravityAuth,
  onRefresh?: (updated: AntigravityAuth) => void,
): Promise<{ accessToken: string; projectId: string } | Error> {
  const resolveProjectId = async (
    current: AntigravityAuth,
    accessToken: string,
  ): Promise<{ projectId: string; updated?: AntigravityAuth }> => {
    const parsed = parseRefreshParts(current.refresh).projectId
    const existing = current.projectId ?? parsed
    if (existing) {
      return { projectId: existing }
    }

    const discovered = await fetchProjectId(accessToken, existing)
    if (discovered) {
      const updated: AntigravityAuth = {
        ...current,
        projectId: discovered,
        refresh: formatRefreshParts({
          refreshToken: parseRefreshParts(current.refresh).refreshToken,
          projectId: discovered,
        }),
      }
      return { projectId: discovered, updated }
    }

    return { projectId: ANTIGRAVITY_DEFAULT_PROJECT_ID }
  }

  if (auth.expires > Date.now() + 60_000) {
    const resolved = await resolveProjectId(auth, auth.access)
    if (resolved.updated) {
      onRefresh?.(resolved.updated)
    }
    return {
      accessToken: auth.access,
      projectId: resolved.projectId,
    }
  }

  const refreshed = await refreshAntigravityToken(auth)
  if (refreshed instanceof Error) {
    return refreshed
  }

  onRefresh?.(refreshed)
  const resolved = await resolveProjectId(refreshed, refreshed.access)
  if (resolved.updated) {
    onRefresh?.(resolved.updated)
  }
  return {
    accessToken: refreshed.access,
    projectId: resolved.projectId,
  }
}

function parseCallbackUrl(callbackUrl: string): { code: string; state: string } {
  const trimmed = callbackUrl.trim()
  if (!trimmed) {
    throw new Error('Callback URL is empty')
  }

  const normalized = (() => {
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (trimmed.startsWith('localhost:')) return `http://${trimmed}`
    if (trimmed.startsWith('/oauth-callback?')) return `http://localhost:${ANTIGRAVITY_PORT}${trimmed}`
    if (trimmed.startsWith('oauth-callback?')) {
      return `http://localhost:${ANTIGRAVITY_PORT}/${trimmed}`
    }
    if (trimmed.includes('code=') && trimmed.includes('state=')) {
      return `http://localhost:${ANTIGRAVITY_PORT}/oauth-callback?${trimmed}`
    }
    return trimmed
  })()

  const parsed = new URL(normalized)
  const code = parsed.searchParams.get('code')
  const state = parsed.searchParams.get('state')

  if (!code) {
    throw new Error('Callback URL is missing `code`')
  }
  if (!state) {
    throw new Error('Callback URL is missing `state`')
  }

  return { code, state }
}

function openBrowser(url: string): void {
  if (process.platform === 'darwin') {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' })
    child.unref()
    return
  }

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
    child.unref()
    return
  }

  const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
  child.unref()
}

const HTML_SUCCESS = `<!doctype html>
<html><body style="font-family:system-ui;text-align:center;padding:4em">
<h1>Authorization Successful</h1>
<p>You can close this window and return to the terminal.</p>
</body></html>`

function htmlError(message: string): string {
  return `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:4em">
<h1>Authorization Failed</h1><pre>${message}</pre></body></html>`
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined

function handleOAuthRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://localhost:${ANTIGRAVITY_PORT}`)

  if (url.pathname !== '/oauth-callback') {
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
    const message = 'Invalid state for OAuth callback'
    pendingOAuth?.reject(new Error(message))
    pendingOAuth = undefined
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/html')
    res.end(htmlError(message))
    return
  }

  const current = pendingOAuth
  pendingOAuth = undefined
  exchangeCodeForTokens({ code, verifier: current.verifier })
    .then((tokens) => {
      deletePendingState(state)
      current.resolve(tokens)
    })
    .catch((err) => {
      current.reject(err instanceof Error ? err : new Error(String(err)))
    })

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html')
  res.end(HTML_SUCCESS)
}

async function startOAuthServer(): Promise<void> {
  if (oauthServer) return

  oauthServer = createServer(handleOAuthRequest)
  await new Promise<void>((resolve, reject) => {
    oauthServer?.once('error', reject)
    oauthServer?.listen(ANTIGRAVITY_PORT, '127.0.0.1', () => resolve())
  })
}

async function stopOAuthServer(): Promise<void> {
  if (!oauthServer) return
  await new Promise<void>((resolve) => oauthServer?.close(() => resolve()))
  oauthServer = undefined
}

function waitForOAuthCallback({ verifier, state }: { verifier: string; state: string }): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingOAuth) {
        pendingOAuth = undefined
      }
      reject(new Error('OAuth callback timeout — authorization took too long'))
    }, 5 * 60 * 1000)

    pendingOAuth = {
      state,
      verifier,
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

export async function antigravityOAuthLogin(): Promise<AntigravityAuth> {
  await startOAuthServer()

  const { verifier, challenge } = generatePKCE()
  const state = generateState()
  savePendingState(state, verifier)
  const authUrl = buildAuthorizeUrl({ challenge, state })

  note(
    `Open this URL in your browser to sign in with your Google account:\n\n` +
      `  ${pc.cyan(pc.underline(authUrl))}\n\n` +
      `${pc.yellow('Warning: this Antigravity OAuth flow may violate Google Terms of Service; use at your own risk.')}` +
      `\n${pc.yellow('Recommended: use a secondary Google account, not your primary account.')}\n\n` +
      `${pc.dim(`Listening for callback on ${ANTIGRAVITY_REDIRECT_URI}`)}`,
    'Antigravity OAuth',
  )

  openBrowser(authUrl)

  const s = spinner()
  s.start('Waiting for authorization in browser...')

  try {
    const tokens = await waitForOAuthCallback({ verifier, state })
    const auth = await createAuthFromTokens(tokens)

    s.stop('Authorization received')
    log.success(
      `Signed in${auth.email ? ` as ${pc.bold(auth.email)}` : ''}${auth.projectId ? ` (${pc.cyan(auth.projectId)})` : ''}`,
    )

    return auth
  } catch (error) {
    deletePendingState(state)
    throw error
  } finally {
    await stopOAuthServer()
  }
}

export async function antigravityOAuthFromCallbackUrl(callbackUrl: string): Promise<AntigravityAuth> {
  const { code, state } = parseCallbackUrl(callbackUrl)
  const verifier = getPendingVerifier(state)
  if (!verifier) {
    throw new Error(
      'Could not find pending OAuth verifier for this callback URL state. Start login with `egaki login --provider antigravity` first, then pass the callback URL.',
    )
  }

  try {
    const tokens = await exchangeCodeForTokens({ code, verifier })
    const auth = await createAuthFromTokens(tokens)
    deletePendingState(state)
    return auth
  } catch (error) {
    throw error
  }
}
