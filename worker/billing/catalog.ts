import Stripe from 'stripe'
import { APP_CONFIG } from '@/lib/config/app'
import { SELLABLE_TIERS, LIFETIME_TIER, isSellable } from '@/lib/config/monetization'
import type { Env } from '../env'
import type { Tier } from '../entitlements'

/**
 * Stripe catalog — the ONE Stripe brain (BILLING_SPEC §7.1). Price→tier resolution, checkout
 * validation, trial-clamp inputs, and the /plans composition all live here, imported by BOTH
 * routes/stripe.ts (write side) and routes/billing.ts (read side) — so the webhook, checkout
 * validation, and the paywall's price list can never disagree about what a price is worth.
 *
 * Product-centric doctrine: a tier is a Stripe PRODUCT (STRIPE_PRODUCT_<TIER>); every ACTIVE
 * recurring price on it is a sellable billing frequency (weekly / monthly / quarterly / semi /
 * yearly). Prices + display copy are managed in the Stripe dashboard (Criterial admin), so
 * pricing changes need NO deploy. The legacy per-price env vars (STRIPE_PRICE_<TIER>[_YEARLY])
 * stay recognized FOREVER — they are the grandfathering mechanism for existing subscribers —
 * but are not re-listed for sale once a product var is set.
 */

/** Stripe client, or null when billing isn't configured (honest degradation — callers 503 or
 *  degrade; never construct a client with an empty key and throw opaquely mid-request). */
export function stripeClient(env: Env): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
}

/** Stripe subscription status → our enum (incomplete/paused → undefined; callers `?? null`). */
export const STATUS: Record<string, 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'unpaid',
}

/**
 * Map a Stripe price → our subscription tier (BILLING §5 precedence, implemented ONCE):
 *   1. the price's PRODUCT id matches STRIPE_PRODUCT_PREMIUM/STANDARD → that tier
 *   2. else the price ID matches a legacy STRIPE_PRICE_<TIER>[_YEARLY] → that tier (grandfathered
 *      forever — existing subscribers' price ids must keep resolving)
 *   3. else FREE (unknown) — the webhook's live-sub clobber guard refuses to persist a FREE
 *      downgrade for a live sub (routes/stripe.ts).
 *
 * Takes the PRICE OBJECT (needs .product) so webhook + checkout resolve identically; the webhook
 * passes sub.items.data[0]?.price straight off the event payload — no extra API call. NOTE the
 * signature change vs the old template (env, priceId?: string): every fleet stripe.ts backport
 * picks this up wholesale.
 */
export function tierForPrice(env: Env, price?: Stripe.Price): Tier {
  // Legacy *_YEARLY vars aren't on every app's Env type — read string env generically (fleet trick).
  const e = env as unknown as Record<string, string | undefined>
  const productId =
    typeof price?.product === 'string' ? price.product : (price?.product as Stripe.Product | undefined)?.id
  if (productId && productId === e.STRIPE_PRODUCT_PREMIUM) return 'PREMIUM'
  if (productId && productId === e.STRIPE_PRODUCT_STANDARD) return 'STANDARD'
  const id = price?.id
  if (id && (id === e.STRIPE_PRICE_PREMIUM || id === e.STRIPE_PRICE_PREMIUM_YEARLY)) return 'PREMIUM'
  if (id && (id === e.STRIPE_PRICE_STANDARD || id === e.STRIPE_PRICE_STANDARD_YEARLY)) return 'STANDARD'
  return 'FREE'
}

/** The one-time Lifetime price? Lives OUTSIDE the tier map (mode:'payment' grant, not a sub) and
 *  is checked FIRST at checkout. Unset env = the whole lifetime feature is dormant. */
export function isLifetimePrice(env: Env, priceId: string): boolean {
  return !!env.STRIPE_PRICE_LIFETIME && priceId === env.STRIPE_PRICE_LIFETIME
}

/**
 * One-round-trip checkout validation + trial-clamp input (collapses the fleet's isSellablePrice +
 * the separate prices.retrieve). The discriminated union tells the checkout route which mode to
 * open; `recurring` carries the price OBJECT so checkoutTrialDays can clamp on its interval.
 */
export type PriceClass =
  | { kind: 'lifetime' }
  | { kind: 'recurring'; price: Stripe.Price; tier: Exclude<Tier, 'FREE'> }
  | { kind: 'unsellable' }

export async function classifyPrice(stripe: Stripe, env: Env, priceId: string): Promise<PriceClass> {
  if (isLifetimePrice(env, priceId)) return { kind: 'lifetime' }
  let price: Stripe.Price
  try {
    price = await stripe.prices.retrieve(priceId)
  } catch {
    // Bad/deleted/cross-account/placeholder id — never reaches Stripe checkout, where the failure
    // mode would be a confusing hosted-page error.
    return { kind: 'unsellable' }
  }
  // Sellable iff active + recurring + resolving to a tier we sell. tierForPrice handles BOTH the
  // product match (any frequency on a tier product) and the legacy price-id match — legacy ids
  // short-circuit sellable without needing a product var set.
  if (!price.active || !price.recurring) return { kind: 'unsellable' }
  const tier = tierForPrice(env, price)
  if (tier === 'FREE' || !isSellable(tier)) return { kind: 'unsellable' }
  return { kind: 'recurring', price, tier }
}

/**
 * Billing period of a recurring price in DAYS (week=7, month=30, year=365, day=1, × interval
 * count); null for non-recurring/unknown. Feeds the interval-aware trial clamp (trial.ts): a
 * 14-day trial on a weekly price would bill $0 for two cycles — a lie sold as a trial.
 */
export function periodDays(price: Stripe.Price): number | null {
  const r = price.recurring
  if (!r?.interval) return null
  const per: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 }
  const base = per[r.interval]
  if (base === undefined) return null
  return base * (r.interval_count ?? 1)
}

// ─── /plans composition (fleet shape — pet-pilot billing.ts:67-245, verbatim semantics) ────────

export type Interval = 'day' | 'week' | 'month' | 'year'

/** One Stripe price for a tier. A tier can have many (each a billing frequency). */
export interface PlanPrice {
  priceId: string
  unitAmount: number | null // null = id set but unresolvable (placeholder/archived/wrong-mode)
  currency: string | null
  interval: Interval | null
  intervalCount: number | null
}

export interface PlanTier {
  tier: Tier
  /** Primary (cheapest) price — kept flat for the legacy paywall contract. */
  priceId: string | null
  unitAmount: number | null
  currency: string | null
  interval: Interval | null
  intervalCount: number | null
  /** Display label + feature bullets from the Stripe Product's metadata (admin-editable). */
  label: string | null
  features: string[]
  productName: string | null
  /** ALL frequencies for this tier, cheapest first. */
  prices: PlanPrice[]
}

export interface PlansResponse {
  /** The Worker's Stripe mode, sniffed from the key SHAPE — never the key itself. */
  mode: 'live' | 'test' | null
  /** From APP_CONFIG.subscription — trial/grace policy lives in app config, not Stripe. */
  subscription: {
    trialDays: number | null
    gracePeriodDays: number | null
    trialTier: 'STANDARD' | 'PREMIUM'
  }
  /** Tiers the paywall sells (server-side filter is authoritative; the client filters too). */
  sellableTiers: Tier[]
  /** The one-time Lifetime SKU — null when STRIPE_PRICE_LIFETIME is unset (feature dormant). */
  lifetime: {
    priceId: string
    unitAmount: number | null
    currency: string | null
    tier: 'STANDARD' | 'PREMIUM'
  } | null
  /** FREE always + SELLABLE paid tiers only. */
  tiers: PlanTier[]
}

// Per-isolate cache: plans change rarely, so collapse the Stripe round-trips. A Criterial price
// change propagates within TTL + isolate churn (≤60s on a warm isolate; immediately on a fresh
// one) — documented in the /plans route comment. No KV: this is read-shielding, not persistence.
let plansCache: { at: number; data: PlansResponse } | null = null
const PLANS_TTL_MS = 60_000

/** Drop the per-isolate cache — unit tests (and dev tooling) only; production relies on the TTL. */
export function resetPlansCache(): void {
  plansCache = null
}

// Product.metadata.features is a flat string — accept a JSON array or a newline/`|`-separated list.
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
    // A bad/deleted/cross-account/placeholder price id shouldn't 500 /plans — surface it unresolved.
    return { price: base, product: null }
  }
}

const emptyTier = (tier: Tier): PlanTier => ({
  tier,
  priceId: null,
  unitAmount: null,
  currency: null,
  interval: null,
  intervalCount: null,
  label: null,
  features: [],
  productName: null,
  prices: [],
})

function tierFromPrices(tier: Tier, prices: PlanPrice[], product: Stripe.Product | null): PlanTier {
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
  tier: Exclude<Tier, 'FREE'>,
  productId: string | undefined,
  fallbackPriceIds: Array<string | undefined>,
): Promise<PlanTier> {
  // No key = no resolvable prices. An EMPTY shell (not an echoed price id with null amounts):
  // offering a priceId the Worker can't check out (503 billing_not_configured) would hand the
  // client an enabled CTA into a dead end — the §10 matrix says disabled fallback copy instead.
  if (!stripe) return emptyTier(tier)
  // Product-centric: every active recurring price on the tier's product is a billing frequency.
  if (productId) {
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
  // Legacy fallback: explicit price-id env vars (STRIPE_PRICE_<TIER>[_YEARLY]), resolved
  // individually and failure-tolerant (null amounts, never a 500).
  const ids = fallbackPriceIds.filter((x): x is string => !!x)
  if (!ids.length) return emptyTier(tier)
  const resolved = await Promise.all(ids.map((id) => resolvePrice(stripe, id)))
  return tierFromPrices(tier, resolved.map((r) => r.price), resolved.find((r) => r.product)?.product ?? null)
}

/**
 * Compose the public /plans payload. Degradation contract (BILLING §10): with no
 * STRIPE_SECRET_KEY this returns mode:null + FREE + EMPTY sellable-tier shells (never throws,
 * never fake prices) — the client renders its config fallback copy with disabled CTAs.
 */
export async function composePlans(env: Env): Promise<PlansResponse> {
  if (plansCache && Date.now() - plansCache.at < PLANS_TTL_MS) return plansCache.data

  // Read string env generically so optional *_YEARLY vars (not on every app's Env) still resolve.
  const raw = env as unknown as Record<string, string | undefined>
  const secret = raw.STRIPE_SECRET_KEY
  const stripe = stripeClient(env)
  const mode = secret?.includes('_live_') ? ('live' as const) : secret?.includes('_test_') ? ('test' as const) : null

  const free: PlanTier = { ...emptyTier('FREE'), unitAmount: 0 }
  const [standard, premium] = await Promise.all([
    buildTier(stripe, 'STANDARD', raw.STRIPE_PRODUCT_STANDARD, [raw.STRIPE_PRICE_STANDARD, raw.STRIPE_PRICE_STANDARD_YEARLY]),
    buildTier(stripe, 'PREMIUM', raw.STRIPE_PRODUCT_PREMIUM, [raw.STRIPE_PRICE_PREMIUM, raw.STRIPE_PRICE_PREMIUM_YEARLY]),
  ])

  // One-time Lifetime SKU — present only when configured AND the key exists (a price with no
  // client is unresolvable anyway). Amounts stay failure-tolerant like everything else here.
  let lifetime: PlansResponse['lifetime'] = null
  if (stripe && env.STRIPE_PRICE_LIFETIME) {
    const { price } = await resolvePrice(stripe, env.STRIPE_PRICE_LIFETIME)
    lifetime = {
      priceId: env.STRIPE_PRICE_LIFETIME,
      unitAmount: price.unitAmount,
      currency: price.currency,
      tier: LIFETIME_TIER,
    }
  }

  // FREE always; paid tiers only when the app sells them (single-paid-tier apps collapse here —
  // the server filter is authoritative, the client's filter is decoration).
  const paid = [standard, premium].filter((t) => isSellable(t.tier))

  const data: PlansResponse = {
    mode,
    subscription: {
      trialDays: APP_CONFIG.subscription?.trialDays ?? null,
      gracePeriodDays: APP_CONFIG.subscription?.gracePeriodDays ?? null,
      trialTier: APP_CONFIG.subscription?.trialTier ?? 'STANDARD',
    },
    sellableTiers: [...SELLABLE_TIERS],
    lifetime,
    tiers: [free, ...paid],
  }
  plansCache = { at: Date.now(), data }
  return data
}
