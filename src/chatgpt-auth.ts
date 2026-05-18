// ChatGPT OAuth authentication for egaki.
// Implements the same device-code login flow used by OpenAI Codex CLI.
// Tokens are stored inside credentials.json under the 'chatgpt' key as a
// structured object (not a plain string like other providers).
import { log, note, spinner } from '@clack/prompts'
import pc from 'picocolors'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const DEVICE_CODE_TIMEOUT_MS = 15 * 60 * 1000

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

type DeviceCodeResponse = {
  device_auth_id: string
  user_code: string
  interval?: string
}

type DeviceCode = {
  verificationUrl: string
  userCode: string
  deviceAuthId: string
  intervalSec: number
}

type DeviceCodeTokenResponse = {
  authorization_code: string
  code_challenge: string
  code_verifier: string
}

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
  const accessAuth = accessClaims?.['https://api.openai.com/auth'] as Record<string, unknown> | undefined

  return (
    (typeof idClaims?.chatgpt_account_id === 'string' ? idClaims.chatgpt_account_id : undefined) ??
    (typeof idAuth?.chatgpt_account_id === 'string' ? idAuth.chatgpt_account_id : undefined) ??
    (typeof accessClaims?.chatgpt_account_id === 'string' ? accessClaims.chatgpt_account_id : undefined) ??
    (typeof accessAuth?.chatgpt_account_id === 'string' ? accessAuth.chatgpt_account_id : undefined)
  )
}

export function extractPlanType(auth: ChatGptAuth): string | undefined {
  if (auth.plan) return auth.plan
  const claims = parseJwtClaims(auth.access)
  const authClaim = claims?.['https://api.openai.com/auth'] as { chatgpt_plan_type?: string } | undefined
  return authClaim?.chatgpt_plan_type
}

async function requestDeviceCode(): Promise<DeviceCode> {
  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })

  if (!response.ok) {
    throw new Error(`Device code request failed: ${response.status}`)
  }

  const json = (await response.json()) as DeviceCodeResponse
  return {
    verificationUrl: `${ISSUER}/codex/device`,
    userCode: json.user_code,
    deviceAuthId: json.device_auth_id,
    intervalSec: Number.parseInt(json.interval ?? '5', 10) || 5,
  }
}

async function pollForAuthorizationCode(deviceCode: DeviceCode): Promise<DeviceCodeTokenResponse> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < DEVICE_CODE_TIMEOUT_MS) {
    const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: deviceCode.deviceAuthId,
        user_code: deviceCode.userCode,
      }),
    })

    if (response.ok) {
      return (await response.json()) as DeviceCodeTokenResponse
    }

    if (response.status === 403 || response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, deviceCode.intervalSec * 1000))
      continue
    }

    throw new Error(`Device auth failed: ${response.status}`)
  }

  throw new Error('Device auth timed out after 15 minutes')
}

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri = `${ISSUER}/deviceauth/callback`,
): Promise<OAuthTokens> {
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
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return (await response.json()) as OAuthTokens
}

export async function chatGptOAuthLogin(): Promise<ChatGptAuth> {
  const deviceCode = await requestDeviceCode()

  note(
    `Open this URL in your browser and sign in with your ChatGPT account:

  ${pc.cyan(pc.underline(deviceCode.verificationUrl))}

Enter this one-time code:

  ${pc.bold(pc.cyan(deviceCode.userCode))}

${pc.dim('The code expires in 15 minutes. Never share it.')}`,
    'ChatGPT device login',
  )

  const s = spinner()
  s.start('Waiting for device authorization...')

  const codeResponse = await pollForAuthorizationCode(deviceCode)
  const tokens = await exchangeCodeForTokens(
    codeResponse.authorization_code,
    codeResponse.code_verifier,
  )

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
  log.success(`Signed in as ${pc.bold(label)}` + (plan ? ` (${pc.cyan(plan)} plan)` : ''))

  return auth
}

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
