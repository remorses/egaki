// Type-safe environment bindings for the Egaki gateway Cloudflare Worker.
// All secrets are managed via Doppler and injected as wrangler secrets.
// KV namespace is bound via wrangler.jsonc.

import type { KVNamespace } from '@cloudflare/workers-types'

export type Env = {
  // ── KV ──────────────────────────────────────────────────────────────────
  /** Cloudflare KV namespace for API keys, usage, subscriptions */
  EGAKI_KV: KVNamespace

  // ── Vercel AI Gateway ──────────────────────────────────────────────────
  /** Our Vercel AI Gateway API key — used to forward requests upstream */
  AI_GATEWAY_API_KEY: string

  // ── Stripe ─────────────────────────────────────────────────────────────
  /** Stripe secret key for creating checkout sessions and managing subs */
  STRIPE_SECRET_KEY: string
  /** Stripe webhook signing secret for verifying webhook payloads */
  STRIPE_WEBHOOK_SECRET: string

  // ── Email ──────────────────────────────────────────────────────────────
  /** Resend API key for sending license emails */
  RESEND_API_KEY?: string
  /** Resend sender address, e.g. "Egaki <tommy@unframer.co>" */
  RESEND_FROM?: string

  // ── Public ─────────────────────────────────────────────────────────────
  /** Public URL override (defaults to request origin) */
  PUBLIC_URL?: string
}

export function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing env var ${name}`)
  }
  return value
}

export function getPublicUrl(c: { req: { url: string }; env: Env }): string {
  return c.env.PUBLIC_URL || new URL(c.req.url).origin
}
