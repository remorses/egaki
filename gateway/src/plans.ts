// Subscription plan definitions for Egaki.
// Usage is tracked in dollars (marked-up provider costs), not abstract credits.
// Each generation costs: actual_provider_cost × MARKUP_MULTIPLIER.
// Our profit = markup portion of each generation.
//
// Model costs are derived from the catalog (src/model-catalog.ts).
// Wrangler's bundler resolves the cross-directory import at build time.
//
// Stripe Price IDs come from env secrets (not hardcoded) so we can
// rotate them or switch Stripe accounts without redeploying code.

import { CATALOG, type ModelEntry } from '../../src/model-catalog.js'
import type { Env } from './env.js'

export type PlanId = 'plus' | 'pro'

export type Plan = {
  id: PlanId
  name: string
  /** Monthly price in USD — this is also the spending cap */
  price: number
}

// ── Markup ────────────────────────────────────────────────────────────────
// Multiplier applied to actual provider costs.
// 1.4 = 40% markup → ~29% gross margin on each generation.
// At $0.04/image (Imagen 4): user pays $0.056, we keep $0.016.
export const MARKUP_MULTIPLIER = 1.4

// ── Plan catalog ──────────────────────────────────────────────────────────
// The spending cap equals the plan price. Users can generate until their
// cumulative marked-up costs reach the cap. Resets every 30 days.

export const PLANS: Record<PlanId, Plan> = {
  plus: {
    id: 'plus',
    name: 'Plus',
    price: 29,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 99,
  },
}

export const PLAN_IDS = Object.keys(PLANS) as PlanId[]
export const DEFAULT_PLAN: PlanId = 'plus'

export type Currency = 'usd' | 'eur'

/**
 * Resolve a plan's Stripe Price ID from env secrets.
 * Price IDs are stored as STRIPE_PRICE_ID_{PLAN}_{CURRENCY}.
 */
export function getStripePriceId(planId: PlanId, currency: Currency, env: Env): string {
  const map: Record<string, string | undefined> = {
    'plus:usd': env.STRIPE_PRICE_ID_PLUS_USD,
    'plus:eur': env.STRIPE_PRICE_ID_PLUS_EUR,
    'pro:usd': env.STRIPE_PRICE_ID_PRO_USD,
    'pro:eur': env.STRIPE_PRICE_ID_PRO_EUR,
  }
  const priceId = map[`${planId}:${currency}`]
  if (!priceId) {
    throw new Error(`Missing Stripe Price ID for plan: ${planId}, currency: ${currency}`)
  }
  return priceId
}

/**
 * Get all Stripe Price IDs for a given env (flattened for reverse lookup).
 */
function getAllPriceIds(env: Env): Array<{ priceId: string; planId: PlanId; currency: Currency }> {
  const result: Array<{ priceId: string; planId: PlanId; currency: Currency }> = []
  for (const planId of PLAN_IDS) {
    for (const currency of ['usd', 'eur'] as Currency[]) {
      try {
        const priceId = getStripePriceId(planId, currency, env)
        result.push({ priceId, planId, currency })
      } catch { /* skip missing */ }
    }
  }
  return result
}

/**
 * Get a plan by its Stripe Price ID (checks against all env secrets).
 */
export function getPlanByPriceId(priceId: string, env: Env): Plan | undefined {
  const match = getAllPriceIds(env).find((p) => p.priceId === priceId)
  return match ? PLANS[match.planId] : undefined
}

// ── Per-model provider costs (derived from catalog) ──────────────────────
// Built at module init from the single source of truth in src/model-catalog.ts.
// For per-image models: use the perImage cost directly.
// For per-token models (Gemini text+image): estimate based on typical token
// usage (~200 input + ~1500 output tokens). Rough estimate — actual costs
// vary by prompt length and output complexity.

const ESTIMATED_TOKENS_PER_IMAGE = { input: 200, output: 1500 }

function estimatePerImageCost(entry: ModelEntry): number {
  if (entry.cost.type === 'per-image') {
    return entry.cost.perImage
  }
  const { input, output } = ESTIMATED_TOKENS_PER_IMAGE
  return (input * entry.cost.inputPerM + output * entry.cost.outputPerM) / 1_000_000
}

const MODEL_COSTS = new Map<string, number>(
  CATALOG.map((m) => [m.id, estimatePerImageCost(m)]),
)

const DEFAULT_MODEL_COST = 0.04

/**
 * Get the marked-up cost for a single image generation with the given model.
 * Returns the dollar amount the user will be "charged" against their spending cap.
 */
export function getModelUserCost(modelId: string): number {
  const baseCost = MODEL_COSTS.get(modelId) ?? DEFAULT_MODEL_COST
  return baseCost * MARKUP_MULTIPLIER
}

/**
 * Get the raw provider cost for a model (no markup).
 */
export function getModelProviderCost(modelId: string): number {
  return MODEL_COSTS.get(modelId) ?? DEFAULT_MODEL_COST
}
