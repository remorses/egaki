// KV wrapper for the Egaki gateway.
// Stores API keys, subscription records, usage tracking, and checkout mappings.
// Follows the same pattern as critique's CritiqueKv class.

import type { KVNamespace } from '@cloudflare/workers-types'
import type { PlanId } from './plans.js'

// ── Types ─────────────────────────────────────────────────────────────────

export type ApiKeyRecord = {
  status: 'active' | 'inactive' | 'canceled'
  plan: PlanId
  subscriptionId?: string
  customerId?: string
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

// ── KV class ──────────────────────────────────────────────────────────────

export class EgakiKv {
  private kv: KVNamespace

  constructor(kv: KVNamespace) {
    this.kv = kv
  }

  // ── API key records ───────────────────────────────────────────────────

  async getApiKey(key: string): Promise<ApiKeyRecord | null> {
    const raw = await this.kv.get(`apikey:${key}`)
    return raw ? (JSON.parse(raw) as ApiKeyRecord) : null
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
    return this.kv.get(`checkout:${sessionId}`)
  }

  async setCheckoutApiKey(sessionId: string, apiKey: string): Promise<void> {
    await this.kv.put(`checkout:${sessionId}`, apiKey)
  }

  // ── Subscription ↔ API key mapping ────────────────────────────────────

  async getSubscriptionApiKey(subscriptionId: string): Promise<string | null> {
    return this.kv.get(`subscription:${subscriptionId}`)
  }

  async setSubscriptionApiKey(subscriptionId: string, apiKey: string): Promise<void> {
    await this.kv.put(`subscription:${subscriptionId}`, apiKey)
  }
}
