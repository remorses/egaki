// Egaki Gateway — Cloudflare Worker that sits between egaki CLI and Vercel AI Gateway.
// Handles: API key validation, dollar-based usage tracking, Stripe subscriptions,
// and proxying AI requests to the upstream Vercel AI Gateway with our own API key.
//
// Usage is tracked in dollars: each generation costs (provider_cost × markup).
// The spending cap per period equals the plan price. Our profit = markup portion.
//
// Endpoints:
//   ALL /v1/ai/*       — AI Gateway proxy (validates key, checks spending, forwards)
//   GET /buy           — Stripe checkout redirect (with ?plan=pro&email=user@example.com)
//   GET /success       — Post-checkout page showing API key
//   POST /stripe/webhook — Stripe webhook handler
//   GET /api/usage     — Spending usage for an API key
//   GET /api/status    — Subscription status for an API key
//   POST /api/cancel   — Cancel subscription
//   GET /api/plans     — Available plans and pricing

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Stripe from 'stripe'
import { Resend } from 'resend'
import type { Env } from './env.js'
import { requireEnv, getPublicUrl } from './env.js'
import { EgakiKv, type ApiKeyRecord } from './kv.js'
import { PLANS, PLAN_IDS, DEFAULT_PLAN, MARKUP_MULTIPLIER, getModelUserCost, getPlanByPriceId, type PlanId, type Plan } from './plans.js'

const app = new Hono<{ Bindings: Env }>()

const UPSTREAM_BASE = 'https://ai-gateway.vercel.sh'

// ── Helpers ───────────────────────────────────────────────────────────────

function generateApiKey(): string {
  const raw = crypto.randomUUID().replace(/-/g, '')
  return `egaki_${raw}`
}

function extractApiKey(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const auth = c.req.header('Authorization')
  if (!auth) return null
  // Support "Bearer egaki_xxx" and plain "egaki_xxx"
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim()
  if (!token.startsWith('egaki_')) return null
  return token
}

/**
 * Extract the model ID from AI SDK protocol headers.
 * The AI SDK sends model IDs in headers, not the JSON body:
 *   - ai-image-model-id: for image generation requests
 *   - ai-language-model-id: for text generation requests
 * Falls back to parsing the JSON body "model" field.
 */
function extractModelId(c: { req: { header: (name: string) => string | undefined } }, bodyModel?: string): string {
  return (
    c.req.header('ai-image-model-id') ??
    c.req.header('ai-language-model-id') ??
    bodyModel ??
    'unknown'
  )
}

/**
 * Extract the image count (n) from the request body for credit calculation.
 */
function extractImageCount(bodyText: string | null): number {
  if (!bodyText) return 1
  try {
    const parsed = JSON.parse(bodyText) as { n?: number }
    return Math.max(1, Number(parsed.n ?? 1))
  } catch {
    return 1
  }
}

// ── Stripe signature verification (same as critique) ─────────────────────

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function computeStripeSignature(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return toHex(signature)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

function parseStripeSignature(header: string): { timestamp: string; signatures: string[] } | null {
  const parts = header.split(',')
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2)
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3))
  if (!timestamp || signatures.length === 0) return null
  return { timestamp, signatures }
}

async function verifyStripeSignature(body: string, header: string, secret: string): Promise<boolean> {
  const parsed = parseStripeSignature(header)
  if (!parsed) return false

  // Reject events older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(parsed.timestamp)) > 300) return false

  const payload = `${parsed.timestamp}.${body}`
  const expected = await computeStripeSignature(secret, payload)
  return parsed.signatures.some((sig) => timingSafeEqual(sig, expected))
}

// ── Email ─────────────────────────────────────────────────────────────────

async function sendApiKeyEmail(env: Env, email: string, apiKey: string, plan: Plan): Promise<void> {
  const resendKey = env.RESEND_API_KEY
  const from = env.RESEND_FROM
  if (!resendKey || !from) return

  const command = `egaki login --provider egaki --key ${apiKey}`
  const resend = new Resend(resendKey)

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; color: #0f172a;">
      <p>Thanks for subscribing to Egaki <strong>${plan.name}</strong>.</p>
      <p>Run this on any machine to start generating images:</p>
      <pre style="background: #0b1117; color: #e6edf3; padding: 12px 14px; border-radius: 8px; font-family: 'Courier New', Courier, monospace;">${command}</pre>
      <p>Your plan includes <strong>$${plan.price}/month</strong> of image generation across all models.</p>
      <p>To check usage: <code>egaki usage</code></p>
      <p>To cancel: <code>egaki unsubscribe</code></p>
    </div>
  `
  const text = [
    `Thanks for subscribing to Egaki ${plan.name}.`,
    '',
    'Run this on any machine to start generating images:',
    command,
    '',
    `Your plan includes $${plan.price}/month of image generation across all models.`,
    'To check usage: egaki usage',
    'To cancel: egaki unsubscribe',
  ].join('\n')

  await resend.emails.send({
    from,
    to: [email],
    replyTo: ['tommy@unframer.co'],
    tags: [{ name: 'egaki', value: 'api-key' }],
    subject: 'Your Egaki API key',
    html,
    text,
  })
}

// ── CORS ──────────────────────────────────────────────────────────────────

app.use('*', cors())

// ── Root ──────────────────────────────────────────────────────────────────

app.get('/', (c) => {
  return c.redirect('https://github.com/remorses/egaki')
})

// ── AI Gateway Proxy ─────────────────────────────────────────────────────
// Proxies all /v1/* requests to the upstream Vercel AI Gateway.
// Validates egaki API key, checks credit balance, deducts on response.

app.all('/v1/ai/*', async (c) => {
  const kv = new EgakiKv(c.env.EGAKI_KV)

  // 1. Extract and validate API key
  const apiKey = extractApiKey(c)
  if (!apiKey) {
    return c.json(
      {
        error: 'Missing or invalid API key. Expected Authorization: Bearer egaki_xxx',
        help: 'Run `egaki subscribe` to get an API key, or visit https://egaki.org/buy',
      },
      401,
    )
  }

  const record = await kv.getApiKey(apiKey)
  if (!record) {
    return c.json({ error: 'Invalid API key', help: 'Run `egaki subscribe` to get a valid key' }, 401)
  }

  if (record.status !== 'active') {
    return c.json(
      {
        error: `Subscription is ${record.status}`,
        help: record.status === 'canceled'
          ? 'Your subscription was canceled. Run `egaki subscribe` to resubscribe.'
          : 'Your subscription is inactive. Check your payment method.',
      },
      403,
    )
  }

  // 2. Check spending — reset if new billing period
  const now = Date.now()
  const periodMs = 30 * 24 * 60 * 60 * 1000
  if (now - record.periodStart > periodMs) {
    record.dollarsUsed = 0
    record.periodStart = now
    await kv.setApiKey(apiKey, record)
  }

  if (record.dollarsUsed >= record.spendingCap) {
    return c.json(
      {
        error: 'Spending limit reached for this billing period',
        dollarsUsed: record.dollarsUsed,
        spendingCap: record.spendingCap,
        help: 'Upgrade your plan at https://egaki.org/buy or wait for the next billing period.',
      },
      402,
    )
  }

  // 3. Read body as raw bytes for faithful forwarding (preserves binary/multipart)
  const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
  const bodyBytes = hasBody ? await c.req.raw.clone().arrayBuffer() : null
  const bodyText = bodyBytes ? new TextDecoder().decode(bodyBytes) : null

  // Extract model from AI SDK protocol headers first, then fall back to body
  let bodyModel: string | undefined
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as { model?: string }
      bodyModel = parsed.model && typeof parsed.model === 'string' ? parsed.model : undefined
    } catch { /* not JSON, that's fine */ }
  }
  const modelId = extractModelId(c, bodyModel)
  const imageCount = extractImageCount(bodyText)

  // 4. Forward to upstream Vercel AI Gateway (preserve path + query string)
  const reqUrl = new URL(c.req.url)
  const upstreamUrl = `${UPSTREAM_BASE}${reqUrl.pathname}${reqUrl.search}`

  const upstreamHeaders = new Headers()
  for (const [key, value] of c.req.raw.headers.entries()) {
    if (key.toLowerCase() === 'authorization') continue // Replace with our key
    if (key.toLowerCase() === 'host') continue
    upstreamHeaders.set(key, value)
  }
  upstreamHeaders.set('Authorization', `Bearer ${c.env.AI_GATEWAY_API_KEY}`)

  const upstreamResponse = await fetch(upstreamUrl, {
    method: c.req.method,
    headers: upstreamHeaders,
    body: hasBody && bodyBytes ? bodyBytes : undefined,
  })

  // 5. Deduct usage on successful response (marked-up cost × image count)
  if (upstreamResponse.ok) {
    const userCost = getModelUserCost(modelId) * imageCount
    await kv.incrementUsage(apiKey, userCost)
  }

  // 6. Return upstream response
  const responseHeaders = new Headers(upstreamResponse.headers)
  responseHeaders.delete('transfer-encoding')

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
})

// ── Stripe Checkout ──────────────────────────────────────────────────────

app.get('/buy', async (c) => {
  try {
    const stripeSecret = requireEnv(c.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY')
    const publicUrl = getPublicUrl(c)

    const email = c.req.query('email')
    const planId = (c.req.query('plan') || DEFAULT_PLAN) as PlanId
    const plan = PLANS[planId]
    if (!plan) {
      return c.text(`Invalid plan: ${planId}. Available: ${PLAN_IDS.join(', ')}`, 400)
    }

    const stripe = new Stripe(stripeSecret)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      allow_promotion_codes: true,
      success_url: `${publicUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicUrl}/success?canceled=1`,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      customer_email: email || undefined,
      metadata: { plan: planId },
    })

    if (!session.url) {
      return c.text('Stripe session missing redirect URL', 500)
    }

    return c.redirect(session.url, 303)
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      return c.text(`Checkout failed: ${error.message}`, 500)
    }
    return c.text('Failed to start checkout', 500)
  }
})

// ── Success page ─────────────────────────────────────────────────────────

app.get('/success', async (c) => {
  const sessionId = c.req.query('session_id')
  const canceled = c.req.query('canceled') === '1'
  const kv = new EgakiKv(c.env.EGAKI_KV)

  let apiKey: string | undefined
  let status: string | undefined

  if (sessionId) {
    const key = await kv.getCheckoutApiKey(sessionId)
    if (key) {
      const record = await kv.getApiKey(key)
      status = record?.status || 'inactive'
      if (record?.status === 'active') {
        apiKey = key
      }
    }
  }

  const headline = canceled
    ? 'Checkout canceled'
    : apiKey
      ? 'Your Egaki API key'
      : 'Subscription processing'
  const message = canceled
    ? 'No charge was made. You can return anytime to subscribe.'
    : apiKey
      ? 'Run this on any machine to start generating images with egaki.'
      : 'Your payment is confirmed. This page will update once the API key is ready.'
  const command = apiKey ? `egaki login --provider egaki --key ${apiKey}` : null

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${canceled ? 'Checkout canceled' : 'Egaki subscription'}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #0f1419; color: #e6edf3; margin: 0; }
    .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px; }
    .card { max-width: 560px; width: 100%; background: #151b23; border: 1px solid #2d3440; border-radius: 16px; padding: 28px; }
    h1 { font-size: 24px; margin: 0 0 12px; }
    p { color: #9aa4b2; margin: 0 0 20px; line-height: 1.5; }
    .key { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #0b1117; border: 1px solid #2d3440; padding: 12px 14px; border-radius: 10px; word-break: break-all; }
    .status { margin-top: 16px; font-size: 14px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${headline}</h1>
      <p>${message}</p>
      ${command ? `<div class="key">${command}</div>` : ''}
      ${status ? `<div class="status">Status: ${status}</div>` : ''}
    </div>
  </div>
</body>
</html>`

  return c.html(html)
})

// ── Stripe Webhook ───────────────────────────────────────────────────────

app.post('/stripe/webhook', async (c) => {
  const sig = c.req.header('Stripe-Signature')
  if (!sig) return c.text('Missing Stripe signature', 400)

  const body = await c.req.text()
  const secret = requireEnv(c.env.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET')
  const valid = await verifyStripeSignature(body, sig, secret)
  if (!valid) return c.text('Invalid Stripe signature', 400)

  const event = JSON.parse(body) as { type: string; data: { object: any } }
  const kv = new EgakiKv(c.env.EGAKI_KV)

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as {
      id: string
      subscription?: string | null
      customer?: string | null
      customer_details?: { email?: string | null }
      customer_email?: string | null
      metadata?: { plan?: string }
    }

    const existing = await kv.getCheckoutApiKey(session.id)
    if (!existing) {
      const apiKey = generateApiKey()
      const planId = (session.metadata?.plan || DEFAULT_PLAN) as PlanId
      const plan = PLANS[planId] || PLANS[DEFAULT_PLAN]
      const email = session.customer_details?.email || session.customer_email || undefined

      const record: ApiKeyRecord = {
        status: 'active',
        plan: plan.id,
        subscriptionId: session.subscription || undefined,
        customerId: session.customer || undefined,
        email,
        dollarsUsed: 0,
        spendingCap: plan.price,
        periodStart: Date.now(),
        createdAt: Date.now(),
      }

      await kv.setApiKey(apiKey, record)
      await kv.setCheckoutApiKey(session.id, apiKey)

      if (session.subscription) {
        await kv.setSubscriptionApiKey(session.subscription, apiKey)
      }

      if (email) {
        try {
          await sendApiKeyEmail(c.env, email, apiKey, plan)
        } catch (err) {
          console.error('Failed to send API key email', err)
        }
      }
    }
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const subscription = event.data.object as {
      id: string
      status?: string
      items?: { data?: Array<{ price?: { id?: string } }> }
    }

    const apiKey = await kv.getSubscriptionApiKey(subscription.id)
    if (apiKey) {
      const record = await kv.getApiKey(apiKey)
      if (record) {
        const isActive = subscription.status === 'active' || subscription.status === 'trialing'
        record.status = isActive ? 'active' : 'canceled'
        record.updatedAt = Date.now()

        // Update plan if subscription items changed
        const priceId = subscription.items?.data?.[0]?.price?.id
        if (priceId) {
          const plan = getPlanByPriceId(priceId)
          if (plan) {
            record.plan = plan.id
            record.spendingCap = plan.price
          }
        }

        await kv.setApiKey(apiKey, record)
      }
    }
  }

  return c.text('Received', 200)
})

// ── API: Usage ───────────────────────────────────────────────────────────

app.get('/api/usage', async (c) => {
  const kv = new EgakiKv(c.env.EGAKI_KV)
  const apiKey = extractApiKey(c)
  if (!apiKey) return c.json({ error: 'Missing API key' }, 401)

  const record = await kv.getApiKey(apiKey)
  if (!record) return c.json({ error: 'Invalid API key' }, 401)

  const plan = PLANS[record.plan]
  return c.json({
    plan: record.plan,
    planName: plan?.name || record.plan,
    dollarsUsed: record.dollarsUsed,
    spendingCap: record.spendingCap,
    dollarsRemaining: Math.max(0, record.spendingCap - record.dollarsUsed),
    periodStart: record.periodStart,
    status: record.status,
  })
})

// ── API: Status ──────────────────────────────────────────────────────────

app.get('/api/status', async (c) => {
  const kv = new EgakiKv(c.env.EGAKI_KV)
  const apiKey = extractApiKey(c)
  if (!apiKey) return c.json({ error: 'Missing API key' }, 401)

  const record = await kv.getApiKey(apiKey)
  if (!record) return c.json({ error: 'Invalid API key' }, 401)

  const plan = PLANS[record.plan]
  return c.json({
    status: record.status,
    plan: record.plan,
    planName: plan?.name || record.plan,
    email: record.email,
    dollarsUsed: record.dollarsUsed,
    spendingCap: record.spendingCap,
    createdAt: record.createdAt,
  })
})

// ── API: Cancel ──────────────────────────────────────────────────────────

app.post('/api/cancel', async (c) => {
  const kv = new EgakiKv(c.env.EGAKI_KV)
  const apiKey = extractApiKey(c)
  if (!apiKey) return c.json({ error: 'Missing API key' }, 401)

  const record = await kv.getApiKey(apiKey)
  if (!record) return c.json({ error: 'Invalid API key' }, 401)
  if (!record.subscriptionId) return c.json({ error: 'No subscription to cancel' }, 400)

  try {
    const stripeSecret = requireEnv(c.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY')
    const stripe = new Stripe(stripeSecret)
    await stripe.subscriptions.cancel(record.subscriptionId)

    record.status = 'canceled'
    record.updatedAt = Date.now()
    await kv.setApiKey(apiKey, record)

    return c.json({ success: true, message: 'Subscription canceled. You can resubscribe anytime.' })
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      return c.json({ error: `Failed to cancel: ${error.message}` }, 500)
    }
    return c.json({ error: 'Failed to cancel subscription' }, 500)
  }
})

// ── API: Plans ───────────────────────────────────────────────────────────

app.get('/api/plans', (c) => {
  const plans = PLAN_IDS.map((id) => {
    const plan = PLANS[id]
    return {
      id: plan.id,
      name: plan.name,
      price: plan.price,
      spendingCap: plan.price,
      markup: MARKUP_MULTIPLIER,
      priceFormatted: `$${plan.price}/mo`,
    }
  })
  return c.json({ plans })
})

// ── Export ─────────────────────────────────────────────────────────────────

export default app
