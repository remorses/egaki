// Login command — interactive and non-interactive API key management.
// Interactive mode uses clack prompts for provider selection and key input.
// Non-interactive mode supports --provider + --key flags and stdin piping.
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
import pc from 'picocolors'
import {
  PROVIDERS,
  saveProviderKey,
  removeProviderKey,
  getKeyStatus,
  readCredentials,
} from './credentials.js'

export async function loginInteractive(): Promise<void> {
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
      return pc.dim('(not configured)')
    })()
    return {
      value: key,
      label: `${info.label} ${statusLabel}`,
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

export function loginNonInteractive({
  provider,
  key,
}: {
  provider: string
  key: string
}): void {
  const info = PROVIDERS[provider]
  if (!info) {
    const available = Object.keys(PROVIDERS).join(', ')
    console.error(
      pc.red(`Unknown provider: ${provider}. Available: ${available}`),
    )
    process.exit(1)
  }

  if (!key || key.trim().length === 0) {
    console.error(pc.red('API key cannot be empty'))
    process.exit(1)
  }

  saveProviderKey(provider, key.trim())
  console.log(pc.green(`${info.label} key saved`))
}

export function showLoginStatus(): void {
  console.log(pc.bold('Configured providers:\n'))

  for (const [key, info] of Object.entries(PROVIDERS)) {
    const status = getKeyStatus(key)
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
  console.log(pc.green(`${info.label} key removed`))
}

// Read API key from stdin (for piping: echo "sk-xxx" | egaki login --provider google)
export async function readKeyFromStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8').trim()
}
