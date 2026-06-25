import { Hono } from 'hono'
import Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { requireOrg, type AuthEnv } from '../middleware/org'

/**
 * Billing — the READ side of subscriptions, separate from routes/stripe.ts (which owns the
 * write side: checkout, portal, webhook sync). The client's subscription hook polls this to
 * decide what to render; the SERVER-side gate stays in worker/entitlements.ts (requireTier).
 *
 *   GET /api/billing/summary → { tier, status, trialEndsAt, currentPeriodEnd }
 *     Auth-gated; reflects the session's ACTIVE organization (billing is per-org, decision #9).
 *     Field shape is a contract with the client hook — do not rename.
 *
 *   GET /api/billing/plans → { tiers: [{ tier, priceId, unitAmount, currency, interval, … }] }
 *     PUBLIC (prices are shown to anyone) + the source of truth for the paywall: composed LIVE
 *     from the env tier→price mapping (STRIPE_PRICE_STANDARD/PREMIUM) + each Stripe Price
 *     (amount/interval) + its Product metadata (label, features). The studio admin (Criterial)
 *     manages the Stripe products/prices + this mapping, so pricing + marketing copy change
 *     with NO app rebuild. Field shape is a contract with the client hook — do not rename.
 */
export const billingRoutes = new Hono<AuthEnv>()

billingRoutes.get('/summary', requireOrg, async (c) => {
  const orgId = c.get('orgId')

  const [org] = await getDb(c.env.DATABASE_URL)
    .select({
      tier: schema.organization.subscriptionTier,
      status: schema.organization.subscriptionStatus,
      trialEndsAt: schema.organization.trialEndsAt,
      currentPeriodEnd: schema.organization.currentPeriodEnd,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  if (!org) return c.json({ error: 'organization not found' }, 404)

  return c.json(org)
})

// --- Plans (public) — the dynamic pricing source for the paywall + Criterial admin ---

type Interval = 'day' | 'week' | 'month' | 'year'

// One Stripe price for a tier. A tier can have more than one (e.g. monthly + yearly).
export interface PlanPrice {
  priceId: string
  unitAmount: number | null // null = id set but unresolvable (placeholder/archived/wrong-mode)
  currency: string | null
  interval: Interval | null
  intervalCount: number | null
}

export interface PlanTier {
  tier: 'FREE' | 'STANDARD' | 'PREMIUM'
  /** Primary price (first/monthly) — kept for the existing paywall contract. */
  priceId: string | null
  unitAmount: number | null
  currency: string | null
  interval: Interval | null
  intervalCount: number | null
  /** Display label + feature bullets, from the Stripe Product's metadata (admin-editable). */
  label: string | null
  features: string[]
  productName: string | null
  /** ALL prices for this tier (monthly + any yearly), in env order. */
  prices: PlanPrice[]
}

export interface PlansResponse {
  /** The Worker's Stripe mode (from STRIPE_SECRET_KEY) — never the key. */
  mode: 'live' | 'test' | null
  /** From APP_CONFIG.subscription — trial/grace live in app config, not Stripe. */
  subscription: { trialDays: number | null; gracePeriodDays: number | null }
  tiers: PlanTier[]
}

// Per-isolate cache: plans change rarely, so collapse the Stripe round-trips. A Criterial
// price change reflects within the TTL (or immediately on a fresh isolate).
let plansCache: { at: number; data: PlansResponse } | null = null
const PLANS_TTL_MS = 60_000

// Product.metadata.features is a flat string — accept a JSON array or newline/`|`-separated list.
function parseFeatures(raw?: string | null): string[] {
  if (!raw) return []
  const s = raw.trim()
  if (s.startsWith('[')) {
    try {
      const j = JSON.parse(s)
      if (Array.isArray(j)) return j.map((x) => String(x)).filter(Boolean)
    } catch {
      /* fall through to delimiter split */
    }
  }
  return s
    .split(/\r?\n|\s*\|\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
}

async function resolvePrice(
  stripe: Stripe | null,
  priceId: string,
): Promise<{ price: PlanPrice; product: Stripe.Product | null }> {
  const base: PlanPrice = { priceId, unitAmount: null, currency: null, interval: null, intervalCount: null }
  if (!stripe) return { price: base, product: null }
  try {
    const p = await stripe.prices.retrieve(priceId, { expand: ['product'] })
    const product =
      p.product && typeof p.product === 'object' && !('deleted' in p.product) ? (p.product as Stripe.Product) : null
    return {
      price: {
        priceId,
        unitAmount: p.unit_amount ?? null,
        currency: p.currency ?? null,
        interval: (p.recurring?.interval as Interval | undefined) ?? null,
        intervalCount: p.recurring?.interval_count ?? null,
      },
      product,
    }
  } catch {
    // A bad/deleted/cross-account/placeholder price id shouldn't 500 — surface it unresolved.
    return { price: base, product: null }
  }
}

const emptyTier = (tier: 'STANDARD' | 'PREMIUM'): PlanTier => ({
  tier, priceId: null, unitAmount: null, currency: null, interval: null, intervalCount: null, label: null, features: [], productName: null, prices: [],
})

function tierFromPrices(tier: 'STANDARD' | 'PREMIUM', prices: PlanPrice[], product: Stripe.Product | null): PlanTier {
  const primary = prices[0]
  return {
    tier,
    priceId: primary?.priceId ?? null,
    unitAmount: primary?.unitAmount ?? null,
    currency: primary?.currency ?? null,
    interval: primary?.interval ?? null,
    intervalCount: primary?.intervalCount ?? null,
    label: product?.metadata?.label ?? null,
    features: parseFeatures(product?.metadata?.features),
    productName: product?.name ?? null,
    prices,
  }
}

async function buildTier(
  stripe: Stripe | null,
  tier: 'STANDARD' | 'PREMIUM',
  productId: string | undefined,
  fallbackPriceIds: Array<string | undefined>,
): Promise<PlanTier> {
  // Product-centric: every active recurring price on the tier's product is a frequency
  // (weekly / monthly / quarterly = month×3 / semi = month×6 / yearly).
  if (stripe && productId) {
    try {
      const list = await stripe.prices.list({ product: productId, active: true, limit: 100, expand: ['data.product'] })
      const recurring = list.data.filter((p) => p.recurring)
      if (recurring.length) {
        const prices: PlanPrice[] = recurring
          .map((p) => ({
            priceId: p.id,
            unitAmount: p.unit_amount ?? null,
            currency: p.currency ?? null,
            interval: (p.recurring?.interval as Interval | undefined) ?? null,
            intervalCount: p.recurring?.interval_count ?? null,
          }))
          .sort((a, b) => (a.unitAmount ?? 0) - (b.unitAmount ?? 0)) // cheapest first
        const prod = recurring[0].product
        const product = prod && typeof prod === 'object' && !('deleted' in prod) ? (prod as Stripe.Product) : null
        return tierFromPrices(tier, prices, product)
      }
    } catch {
      /* fall through to the legacy price-id env */
    }
  }
  // Legacy fallback: explicit price-id env vars (STRIPE_PRICE_<TIER>[_YEARLY]).
  const ids = fallbackPriceIds.filter((x): x is string => !!x)
  if (!ids.length) return emptyTier(tier)
  const resolved = await Promise.all(ids.map((id) => resolvePrice(stripe, id)))
  return tierFromPrices(tier, resolved.map((r) => r.price), resolved.find((r) => r.product)?.product ?? null)
}

billingRoutes.get('/plans', async (c) => {
  if (plansCache && Date.now() - plansCache.at < PLANS_TTL_MS) {
    return c.json(plansCache.data)
  }
  // Read string env generically so optional *_YEARLY vars (not in every app's Env type) work.
  const raw = c.env as unknown as Record<string, string | undefined>
  const secret = raw.STRIPE_SECRET_KEY
  const stripe = secret ? new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() }) : null
  const mode = secret?.includes('_live_') ? 'live' : secret?.includes('_test_') ? 'test' : null

  const free: PlanTier = {
    tier: 'FREE',
    priceId: null,
    unitAmount: 0,
    currency: null,
    interval: null,
    intervalCount: null,
    label: null,
    features: [],
    productName: null,
    prices: [],
  }
  const [standard, premium] = await Promise.all([
    buildTier(stripe, 'STANDARD', raw.STRIPE_PRODUCT_STANDARD, [raw.STRIPE_PRICE_STANDARD, raw.STRIPE_PRICE_STANDARD_YEARLY]),
    buildTier(stripe, 'PREMIUM', raw.STRIPE_PRODUCT_PREMIUM, [raw.STRIPE_PRICE_PREMIUM, raw.STRIPE_PRICE_PREMIUM_YEARLY]),
  ])

  const data: PlansResponse = {
    mode,
    subscription: {
      trialDays: APP_CONFIG.subscription?.trialDays ?? null,
      gracePeriodDays: APP_CONFIG.subscription?.gracePeriodDays ?? null,
    },
    tiers: [free, standard, premium],
  }
  plansCache = { at: Date.now(), data }
  return c.json(data)
})
