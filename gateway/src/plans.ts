// Subscription plan definitions for Egaki.
// Usage is tracked in dollars (marked-up provider costs), not abstract credits.
// Each generation costs: actual_provider_cost × MARKUP_MULTIPLIER.
// Our profit = markup portion of each generation.
//
// Cost data is imported directly from the model catalog (src/model-catalog.ts)
// so there's no duplication. Wrangler's bundler resolves the cross-directory import.

import { CATALOG, type ModelEntry } from '../../src/model-catalog.js'

export type PlanId = 'plus' | 'pro'

export type Plan = {
  id: PlanId
  name: string
  /** Monthly price in USD — this is also the spending cap */
  price: number
  /** Stripe Price ID — set after creating products in Stripe */
  stripePriceId: string
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
    stripePriceId: 'REPLACE_WITH_STRIPE_PRICE_ID_PLUS',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 99,
    stripePriceId: 'REPLACE_WITH_STRIPE_PRICE_ID_PRO',
  },
}

export const PLAN_IDS = Object.keys(PLANS) as PlanId[]
export const DEFAULT_PLAN: PlanId = 'plus'

// ── Per-model provider costs (derived from catalog) ──────────────────────
// Built at module init from the single source of truth in src/model-catalog.ts.
// For per-image models: use the perImage cost directly.
// For per-token models (Gemini text+image): estimate ~$0.05/image based on
// typical token usage (~200 input + ~1500 output tokens). This is a rough
// estimate — actual costs vary by prompt length and output complexity.

const ESTIMATED_TOKENS_PER_IMAGE = { input: 200, output: 1500 }

function estimatePerImageCost(entry: ModelEntry): number {
  if (entry.cost.type === 'per-image') {
    return entry.cost.perImage
  }
  // per-token: estimate based on typical image generation token counts
  const { input, output } = ESTIMATED_TOKENS_PER_IMAGE
  return (input * entry.cost.inputPerM + output * entry.cost.outputPerM) / 1_000_000
}

const MODEL_COSTS = new Map<string, number>(
  CATALOG.map((m) => [m.id, estimatePerImageCost(m)]),
)

// Default cost for unknown models (conservative estimate)
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

/**
 * Get a plan by its Stripe Price ID.
 */
export function getPlanByPriceId(priceId: string): Plan | undefined {
  return Object.values(PLANS).find((p) => p.stripePriceId === priceId)
}
