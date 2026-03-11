// Subscription management for egaki.
// Handles the subscribe, unsubscribe, and usage flows.
// Communicates with the egaki gateway API at egaki.org.

import pc from 'picocolors'
import {
  intro,
  outro,
  text,
  select,
  confirm,
  isCancel,
  cancel,
  log,
  note,
  spinner,
} from '@clack/prompts'
import { EGAKI_GATEWAY_URL, saveProviderKey, getProviderKey } from './credentials.js'

// Strip /v1/ai suffix to get the base URL for non-proxy endpoints (/buy, /api/*)
const GATEWAY_BASE = EGAKI_GATEWAY_URL.replace(/\/v1\/ai$/, '')

type PlanInfo = {
  id: string
  name: string
  price: number
  spendingCap: number
  markup: number
  priceFormatted: string
}

type UsageInfo = {
  plan: string
  planName: string
  dollarsUsed: number
  spendingCap: number
  dollarsRemaining: number
  periodStart: number
  status: string
}

type StatusInfo = {
  status: string
  plan: string
  planName: string
  email?: string
  dollarsUsed: number
  spendingCap: number
  createdAt: number
}

// ── Subscribe ─────────────────────────────────────────────────────────────

export async function subscribeInteractive(): Promise<void> {
  intro(pc.bold('egaki subscribe'))

  // Fetch available plans
  const s = spinner()
  s.start('Fetching plans...')

  let plans: PlanInfo[]
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/plans`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { plans: PlanInfo[] }
    plans = data.plans
    s.stop('Plans loaded')
  } catch {
    s.stop('Failed to fetch plans')
    log.error('Could not connect to egaki.org. Check your internet connection.')
    process.exit(1)
  }

  // Select plan
  const planId = await select({
    message: 'Choose a plan',
    options: plans.map((p) => ({
      value: p.id,
      label: `${p.name} — ${p.priceFormatted}`,
      hint: `$${p.spendingCap} spending cap, all models`,
    })),
  })

  if (isCancel(planId)) {
    cancel('Subscribe cancelled.')
    process.exit(0)
  }

  // Optional email prefill for checkout
  const prefillEmail = await confirm({
    message: 'Prefill your email in checkout URL? (optional)',
  })

  if (isCancel(prefillEmail)) {
    cancel('Subscribe cancelled.')
    process.exit(0)
  }

  let email: string | undefined
  if (prefillEmail) {
    const enteredEmail = await text({
      message: 'Email for the subscription',
      placeholder: 'you@example.com',
      validate: (value) => {
        if (!value || !value.includes('@')) {
          return 'Please enter a valid email'
        }
      },
    })

    if (isCancel(enteredEmail)) {
      cancel('Subscribe cancelled.')
      process.exit(0)
    }

    email = enteredEmail
  }

  // Show checkout URL
  const params = new URLSearchParams({ plan: planId })
  if (email) {
    params.set('email', email)
  }
  const checkoutUrl = `${GATEWAY_BASE}/buy?${params.toString()}`

  log.info('')
  note(
    [
      `Open this URL to complete payment:`,
      '',
      pc.cyan(checkoutUrl),
      '',
      `After payment, you'll receive your API key via email.`,
      `Then run:`,
      '',
      `  ${pc.cyan('egaki login --provider egaki --key egaki_...')}`,
    ].join('\n'),
    'Checkout',
  )

  // Ask if they want to enter the key now
  const hasKey = await confirm({
    message: 'Do you already have your API key?',
  })

  if (isCancel(hasKey)) {
    outro('You can enter your key later with: egaki login --provider egaki --key <key>')
    return
  }

  if (hasKey) {
    const key = await text({
      message: 'Paste your egaki API key',
      placeholder: 'egaki_...',
      validate: (value) => {
        if (!value || !value.startsWith('egaki_')) {
          return 'API key should start with egaki_'
        }
      },
    })

    if (isCancel(key)) {
      outro('You can enter your key later with: egaki login --provider egaki --key <key>')
      return
    }

    saveProviderKey('egaki', key.trim())
    log.success('API key saved')
    outro('You can now generate images with any model: egaki image "your prompt"')
  } else {
    outro('After payment, run: egaki login --provider egaki --key <your-key>')
  }
}

export function subscribeNonInteractive(email?: string, plan?: string): void {
  const emailParam = email ? `&email=${encodeURIComponent(email)}` : ''

  if (plan) {
    // Specific plan requested
    const checkoutUrl = `${GATEWAY_BASE}/buy?plan=${plan}${emailParam}`
    console.log(pc.bold('Egaki Subscription'))
    console.log('')
    console.log('Open this URL to complete payment:')
    console.log('')
    console.log(pc.cyan(checkoutUrl))
  } else {
    // No plan specified — show all options
    console.log(pc.bold('Egaki Subscription'))
    console.log('')
    console.log('Choose a plan:')
    console.log('')
    console.log(`  ${pc.bold('Plus')}  $29/mo  ${pc.cyan(`${GATEWAY_BASE}/buy?plan=plus${emailParam}`)}`)
    console.log(`  ${pc.bold('Pro')}   $99/mo  ${pc.cyan(`${GATEWAY_BASE}/buy?plan=pro${emailParam}`)}`)
  }

  console.log('')
  console.log('After payment, your API key is shown on the success page.')
  console.log('If an email was provided to Stripe checkout, a copy is also sent by email.')
  console.log(`Then run: ${pc.cyan('egaki login --provider egaki --key egaki_...')}`)
  console.log('')
  console.log('Tip: egaki supports both BYOK and subscription mode.')
  console.log('BYOK = add provider keys (google/openai/replicate/fal) with egaki login.')
  console.log('Subscription = one egaki key to access all models without per-provider key setup.')
}

// ── Unsubscribe ───────────────────────────────────────────────────────────

export async function unsubscribe(): Promise<void> {
  const apiKey = getProviderKey('egaki') || process.env['EGAKI_API_KEY']

  if (!apiKey) {
    console.error(pc.red('No egaki API key found.'))
    console.error(
      `If you have a key, set it first: ${pc.cyan('egaki login --provider egaki --key <key>')}`,
    )
    process.exit(1)
  }

  console.error(pc.dim('Canceling subscription...'))

  try {
    const res = await fetch(`${GATEWAY_BASE}/api/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    const data = (await res.json()) as { success?: boolean; message?: string; error?: string }

    if (!res.ok) {
      console.error(pc.red(data.error || 'Failed to cancel subscription'))
      process.exit(1)
    }

    console.log(pc.green(data.message || 'Subscription canceled.'))
    console.log(pc.dim('You can resubscribe anytime with: egaki subscribe'))
  } catch {
    console.error(pc.red('Could not connect to egaki.org. Check your internet connection.'))
    process.exit(1)
  }
}

// ── Usage ─────────────────────────────────────────────────────────────────

export async function showUsage(): Promise<void> {
  const apiKey = getProviderKey('egaki') || process.env['EGAKI_API_KEY']

  if (!apiKey) {
    console.error(pc.red('No egaki API key found.'))
    console.error(
      `Set your key first: ${pc.cyan('egaki login --provider egaki --key <key>')}`,
    )
    console.error(
      `Or subscribe: ${pc.cyan('egaki subscribe')}`,
    )
    process.exit(1)
  }

  try {
    const res = await fetch(`${GATEWAY_BASE}/api/usage`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      console.error(pc.red(data.error || 'Failed to fetch usage'))
      process.exit(1)
    }

    const usage = (await res.json()) as UsageInfo
    const pct = usage.spendingCap > 0
      ? Math.round((usage.dollarsUsed / usage.spendingCap) * 100)
      : 0
    const remaining = Math.max(0, usage.spendingCap - usage.dollarsUsed)

    console.log(pc.bold(`Egaki ${usage.planName} Plan\n`))
    console.log(`  Status:    ${usage.status === 'active' ? pc.green('active') : pc.red(usage.status)}`)
    console.log(`  Spent:     $${usage.dollarsUsed.toFixed(2)} / $${usage.spendingCap.toFixed(2)} (${pct}%)`)
    console.log(`  Remaining: $${remaining.toFixed(2)}`)
    console.log(`  Period:    started ${new Date(usage.periodStart).toLocaleDateString()}`)

    if (pct >= 90) {
      console.log('')
      console.log(pc.yellow('  Running low on budget! Consider upgrading your plan.'))
      console.log(pc.dim(`  Visit: https://egaki.org/buy`))
    }
  } catch {
    console.error(pc.red('Could not connect to egaki.org. Check your internet connection.'))
    process.exit(1)
  }
}
