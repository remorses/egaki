// Login command — interactive and non-interactive API key management.
// Interactive mode uses clack prompts for provider selection and key input.
// Non-interactive mode supports --provider + --key flags and stdin piping.
// OAuth providers run through the login command's goke daemon.
import {
  intro,
  outro,
  select,
  password,
  isCancel,
  cancel,
  log,
  note,
} from '@clack/prompts'
import { colors as pc } from 'goke'
import {
  PROVIDERS,
  saveProviderKey,
  removeProviderKey,
  getKeyStatus,
  getChatGptAuth,
  saveChatGptAuth,
  getXaiAuth,
  saveXaiAuth,
} from './credentials.js'
import { chatGptOAuthLogin, extractPlanType } from './chatgpt-auth.js'
import { xaiOAuthLogin } from './xai-auth.js'

type LoginAction =
  | { type: 'show' }
  | { type: 'remove'; provider: string }
  | { type: 'oauth-daemon'; provider: string }
  | { type: 'oauth-client'; provider: string }
  | { type: 'api-key'; provider: string; key: string | undefined }
  | { type: 'interactive' }

function isOAuthProvider(provider: string) {
  return provider === 'chatgpt' || provider === 'xai-oauth'
}

export function resolveLoginAction({
  options,
  daemonProvider,
  isAgent,
}: {
  options: {
    provider?: string
    key?: string
    show?: boolean
    remove?: string
  }
  daemonProvider: string | undefined
  isAgent: boolean
}): LoginAction | Error {
  if (options.show) return { type: 'show' }
  if (options.remove) return { type: 'remove', provider: options.remove }
  if (daemonProvider && !isOAuthProvider(daemonProvider)) {
    return new Error(`Invalid background login provider: ${daemonProvider}`)
  }
  if (daemonProvider) return { type: 'oauth-daemon', provider: daemonProvider }
  if (options.provider && isOAuthProvider(options.provider)) {
    return { type: 'oauth-client', provider: options.provider }
  }
  if (options.provider) {
    return { type: 'api-key', provider: options.provider, key: options.key }
  }
  if (isAgent) {
    return new Error('Missing --provider. Run egaki login --provider <name>.')
  }
  return { type: 'interactive' }
}

export async function loginInteractive({
  loginOAuth,
}: {
  loginOAuth: (provider: string) => Promise<void>
}): Promise<void> {
  intro(pc.bold('egaki login'))

  const providerOptions = Object.entries(PROVIDERS).map(([key, info]) => {
    const status = getKeyStatus(key)
    const statusLabel = (() => {
      if (status.source === 'env') {
        return pc.green('(set via env)')
      }
      if (status.source === 'stored') {
        return pc.green('(saved)')
      }
      if (status.source === 'oauth') {
        if (key === 'chatgpt') {
          const auth = getChatGptAuth()
          const email = auth?.email
          return pc.green(`(signed in${email ? ` as ${email}` : ''})`)
        }
        if (key === 'xai-oauth') {
          const auth = getXaiAuth()
          const email = auth?.email
          return pc.green(`(signed in${email ? ` as ${email}` : ''})`)
        }
        return pc.green('(signed in)')
      }
      return pc.dim('(not configured)')
    })()
    // Highlight the egaki option as recommended
    const label = key === 'egaki'
      ? `${pc.bold(info.label)} ${pc.cyan('← recommended')} ${statusLabel}`
      : `${info.label} ${statusLabel}`
    return {
      value: key,
      label,
      hint: info.hint,
    }
  })

  const provider = await select({
    message: 'Select a provider to configure',
    options: providerOptions,
  })

  if (isCancel(provider)) {
    cancel('Login cancelled.')
    process.exit(0)
  }

  const info = PROVIDERS[provider]
  if (!info) {
    log.error(`Unknown provider: ${provider}`)
    process.exit(1)
  }

  // ChatGPT uses browser OAuth instead of key paste
  if (provider === 'chatgpt') {
    await loginOAuth(provider)
    return
  }

  // xAI Grok Build uses browser OAuth
  if (provider === 'xai-oauth') {
    await loginOAuth(provider)
    return
  }

  log.info(
    `${pc.dim('Env var:')} ${info.envVar} ${pc.dim('(also used by the CLI when set)')}`,
  )
  log.info(`${pc.dim('Get key:')} ${info.hint}`)

  const key = await password({
    message: `Paste your ${info.label} API key`,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'API key cannot be empty'
      }
    },
  })

  if (isCancel(key)) {
    cancel('Login cancelled.')
    process.exit(0)
  }

  saveProviderKey(provider, key.trim())

  log.success(`${info.label} key saved`)
  note(
    `You can also set ${pc.bold(info.envVar)} as an env var.\nThe CLI reads it automatically, so you can pass it inline too:\n  ${pc.dim(`${info.envVar}=... egaki generate "prompt"`)}`,
    'Tip',
  )

  outro('Done')
}

export async function loginNonInteractive({
  provider,
  key,
  background = false,
}: {
  provider: string
  key: string
  background?: boolean
}): Promise<void> {
  const info = PROVIDERS[provider]
  if (!info) {
    const available = Object.keys(PROVIDERS).join(', ')
    console.error(
      pc.red(`Unknown provider: ${provider}. Available: ${available}`),
    )
    process.exit(1)
  }

  // ChatGPT uses browser OAuth — key flag is not needed
  if (provider === 'chatgpt') {
    const auth = await chatGptOAuthLogin({ openInBackground: background })
    saveChatGptAuth(auth)
    console.log(pc.green('ChatGPT OAuth saved'))
    return
  }

  // xAI Grok Build uses browser OAuth — key flag is not needed
  if (provider === 'xai-oauth') {
    const auth = await xaiOAuthLogin({ openInBackground: background })
    saveXaiAuth(auth)
    console.log(pc.green('xAI OAuth saved'))
    return
  }

  if (!key || key.trim().length === 0) {
    console.error(pc.red('API key cannot be empty'))
    process.exit(1)
  }

  saveProviderKey(provider, key.trim())
  console.log(pc.green(`${info.label} key saved`))
}

export function showLoginStatus({ loginRunning = false } = {}): void {
  if (loginRunning) console.log(pc.cyan('OAuth login is running in the background.\n'))
  console.log(pc.bold('Configured providers:\n'))

  for (const [key, info] of Object.entries(PROVIDERS)) {
    const status = getKeyStatus(key)

    if (key === 'chatgpt') {
      const auth = getChatGptAuth()
      if (auth) {
        const plan = extractPlanType(auth)
        const email = auth.email ?? auth.accountId ?? 'unknown'
        const expired = auth.expires < Date.now()
        const expiryLabel = expired
          ? pc.yellow('(token expired, will auto-refresh)')
          : pc.dim(`(token valid)`)
        console.log(`${pc.green('*')} ${info.label} ${pc.green('(signed in)')}`)
        console.log(pc.dim(`  account: ${email}${plan ? `, plan: ${plan}` : ''}`))
        console.log(`  ${expiryLabel}`)
      } else {
        console.log(`${pc.dim('-')} ${info.label} ${pc.dim('(not signed in)')}`)
        console.log(pc.dim(`  run: egaki login → select ChatGPT`))
      }
      continue
    }

    if (key === 'xai-oauth') {
      const auth = getXaiAuth()
      if (auth) {
        const email = auth.email ?? 'unknown'
        const expired = auth.expires < Date.now()
        const expiryLabel = expired
          ? pc.yellow('(token expired, will auto-refresh)')
          : pc.dim('(token valid)')
        console.log(`${pc.green('*')} ${info.label} ${pc.green('(signed in)')}`)
        console.log(pc.dim(`  account: ${email}`))
        console.log(`  ${expiryLabel}`)
      } else {
        console.log(`${pc.dim('-')} ${info.label} ${pc.dim('(not signed in)')}`)
        console.log(pc.dim(`  run: egaki login → select xAI Grok Build`))
      }
      continue
    }

    const icon = status.available ? pc.green('*') : pc.dim('-')
    const source = (() => {
      if (status.source === 'env') {
        return pc.cyan('(from env)')
      }
      if (status.source === 'stored') {
        return pc.green('(saved)')
      }
      return pc.dim('(not set)')
    })()
    const envHint = pc.dim(
      `  env: ${info.envVar} (set in shell or pass inline to CLI)`,
    )
    console.log(`${icon} ${info.label} ${source}`)
    console.log(envHint)
  }
}

export function removeLogin(provider: string): void {
  const info = PROVIDERS[provider]
  if (!info) {
    const available = Object.keys(PROVIDERS).join(', ')
    console.error(
      pc.red(`Unknown provider: ${provider}. Available: ${available}`),
    )
    process.exit(1)
  }

  removeProviderKey(provider)
  const label = provider === 'chatgpt' ? 'ChatGPT OAuth' : info.label
  console.log(pc.green(`${label} key removed`))
}

// Read API key from stdin (for piping: echo "sk-xxx" | egaki login --provider google)
export async function readKeyFromStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8').trim()
}
