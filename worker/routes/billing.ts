import { Hono } from 'hono'
import Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'
import type { Env } from '../env'

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

// --- Plans (public) — the dynamic pricing source for the paywall ---

type Interval = 'day' | 'week' | 'month' | 'year'
export interface PlanTier {
  tier: 'FREE' | 'STANDARD' | 'PREMIUM'
  priceId: string | null
  /** Smallest currency unit (cents); 0 for FREE, null if the price can't be read. */
  unitAmount: number | null
  currency: string | null
  interval: Interval | null
  intervalCount: number | null
  /** Display label + feature bullets, from the Stripe Product's metadata (admin-editable). */
  label: string | null
  features: string[]
  productName: string | null
}

// Per-isolate cache: plans change rarely, so collapse the Stripe round-trips. A Criterial
// price change reflects within the TTL (or immediately on a fresh isolate).
let plansCache: { at: number; data: { tiers: PlanTier[] } } | null = null
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

async function buildTier(
  stripe: Stripe | null,
  tier: 'STANDARD' | 'PREMIUM',
  priceId: string | undefined,
): Promise<PlanTier> {
  const empty: PlanTier = {
    tier,
    priceId: priceId ?? null,
    unitAmount: null,
    currency: null,
    interval: null,
    intervalCount: null,
    label: null,
    features: [],
    productName: null,
  }
  if (!stripe || !priceId) return empty
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] })
    const product =
      price.product && typeof price.product === 'object' && !('deleted' in price.product)
        ? (price.product as Stripe.Product)
        : null
    return {
      tier,
      priceId,
      unitAmount: price.unit_amount ?? null,
      currency: price.currency ?? null,
      interval: (price.recurring?.interval as Interval | undefined) ?? null,
      intervalCount: price.recurring?.interval_count ?? null,
      label: product?.metadata?.label ?? null,
      features: parseFeatures(product?.metadata?.features),
      productName: product?.name ?? null,
    }
  } catch {
    // A bad/deleted/cross-account price id shouldn't 500 the paywall — degrade to env-only.
    return empty
  }
}

billingRoutes.get('/plans', async (c) => {
  if (plansCache && Date.now() - plansCache.at < PLANS_TTL_MS) {
    return c.json(plansCache.data)
  }
  const env = c.env as Env
  const stripe = env.STRIPE_SECRET_KEY
    ? new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
    : null

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
  }
  const [standard, premium] = await Promise.all([
    buildTier(stripe, 'STANDARD', env.STRIPE_PRICE_STANDARD),
    buildTier(stripe, 'PREMIUM', env.STRIPE_PRICE_PREMIUM),
  ])

  const data = { tiers: [free, standard, premium] }
  plansCache = { at: Date.now(), data }
  return c.json(data)
})
