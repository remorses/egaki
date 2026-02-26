// KV wrapper for the Egaki gateway.
// Stores API keys, subscription records, usage tracking, and checkout mappings.
// Follows the same pattern as critique's CritiqueKv class.
//
// KV key schema:
//   apikey:{key}          → ApiKeyRecord    (subscription state + usage)
//   checkout:{sessionId}  → CheckoutRecord  (Stripe checkout → API key mapping)
//   subscription:{subId}  → SubRecord       (Stripe subscription → API key mapping)

import type { KVNamespace } from '@cloudflare/workers-types'
import type { PlanId } from './plans.js'

// ── KV value types ────────────────────────────────────────────────────────
// Every value stored in KV has an explicit type here.

/** Primary record for an egaki API key. Stored at `apikey:{key}`. */
export type ApiKeyRecord = {
  status: 'active' | 'inactive' | 'canceled'
  plan: PlanId
  /** Stripe subscription ID (sub_xxx) */
  subscriptionId?: string
  /** Stripe customer ID (cus_xxx) */
  customerId?: string
  /** Stripe Price ID used for this subscription (price_xxx) */
  stripePriceId?: string
  /** Stripe account ID that owns this subscription (acct_xxx).
   *  Tracked so we can migrate to a different Stripe account later. */
  stripeAccountId?: string
  email?: string
  /** Dollars spent in the current billing period (marked-up costs) */
  dollarsUsed: number
  /** Spending cap for the current period (= plan price) */
  spendingCap: number
  /** Start of current billing period (epoch ms) */
  periodStart: number
  createdAt: number
  updatedAt?: number
}

/** Maps a Stripe checkout session to an API key. Stored at `checkout:{sessionId}`. */
export type CheckoutRecord = {
  apiKey: string
  /** Stripe account ID that processed this checkout */
  stripeAccountId: string
  createdAt: number
}

/** Maps a Stripe subscription to an API key. Stored at `subscription:{subId}`. */
export type SubRecord = {
  apiKey: string
  /** Stripe account ID that owns this subscription */
  stripeAccountId: string
  createdAt: number
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ── KV class ──────────────────────────────────────────────────────────────

export class EgakiKv {
  private kv: KVNamespace

  constructor(kv: KVNamespace) {
    this.kv = kv
  }

  // ── API key records ───────────────────────────────────────────────────

  async getApiKey(key: string): Promise<ApiKeyRecord | null> {
    return parseJson<ApiKeyRecord>(await this.kv.get(`apikey:${key}`))
  }

  async setApiKey(key: string, record: ApiKeyRecord): Promise<void> {
    await this.kv.put(`apikey:${key}`, JSON.stringify(record))
  }

  // ── Usage tracking ────────────────────────────────────────────────────

  /**
   * Increment dollars used for an API key.
   * Returns the updated record, or null if the key doesn't exist.
   */
  async incrementUsage(key: string, dollars: number): Promise<ApiKeyRecord | null> {
    const record = await this.getApiKey(key)
    if (!record) return null

    // Reset usage if we're in a new billing period (30 days)
    const now = Date.now()
    const periodMs = 30 * 24 * 60 * 60 * 1000
    if (now - record.periodStart > periodMs) {
      record.dollarsUsed = 0
      record.periodStart = now
    }

    record.dollarsUsed = Math.round((record.dollarsUsed + dollars) * 10000) / 10000
    record.updatedAt = now
    await this.setApiKey(key, record)
    return record
  }

  // ── Checkout ↔ API key mapping ────────────────────────────────────────

  async getCheckoutApiKey(sessionId: string): Promise<string | null> {
    const record = parseJson<CheckoutRecord>(await this.kv.get(`checkout:${sessionId}`))
    return record?.apiKey ?? null
  }

  async setCheckoutRecord(sessionId: string, record: CheckoutRecord): Promise<void> {
    await this.kv.put(`checkout:${sessionId}`, JSON.stringify(record))
  }

  // ── Subscription ↔ API key mapping ────────────────────────────────────

  async getSubscriptionApiKey(subscriptionId: string): Promise<string | null> {
    const record = parseJson<SubRecord>(await this.kv.get(`subscription:${subscriptionId}`))
    return record?.apiKey ?? null
  }

  async setSubRecord(subscriptionId: string, record: SubRecord): Promise<void> {
    await this.kv.put(`subscription:${subscriptionId}`, JSON.stringify(record))
  }
}
