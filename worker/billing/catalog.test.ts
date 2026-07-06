import { describe, it, expect, beforeEach } from 'vitest'
import type Stripe from 'stripe'
import {
  tierForPrice,
  isLifetimePrice,
  classifyPrice,
  periodDays,
  composePlans,
  resetPlansCache,
} from './catalog'
import type { Env } from '../env'

/** Minimal Stripe.Price fixture — only the fields the catalog reads. */
function price(over: Partial<Record<string, unknown>> = {}): Stripe.Price {
  return {
    id: 'price_x',
    active: true,
    product: 'prod_x',
    unit_amount: 999,
    currency: 'usd',
    recurring: { interval: 'month', interval_count: 1 },
    ...over,
  } as unknown as Stripe.Price
}

/** Env fixture — products + legacy prices + lifetime, all distinct so precedence is observable. */
const env = {
  STRIPE_PRODUCT_STANDARD: 'prod_std',
  STRIPE_PRODUCT_PREMIUM: 'prod_prem',
  STRIPE_PRICE_STANDARD: 'price_std_legacy',
  STRIPE_PRICE_PREMIUM: 'price_prem_legacy',
  STRIPE_PRICE_STANDARD_YEARLY: 'price_std_yearly',
  STRIPE_PRICE_PREMIUM_YEARLY: 'price_prem_yearly',
  STRIPE_PRICE_LIFETIME: 'price_lifetime',
} as unknown as Env

/** A stripe client whose prices.retrieve returns the given price (or throws). */
function stripeWith(p: Stripe.Price | Error): Stripe {
  return {
    prices: {
      retrieve: async () => {
        if (p instanceof Error) throw p
        return p
      },
    },
  } as unknown as Stripe
}

describe('tierForPrice — §5 precedence: product id → legacy price id → FREE', () => {
  it('product id wins (any price on the tier product)', () => {
    expect(tierForPrice(env, price({ id: 'price_anything', product: 'prod_prem' }))).toBe('PREMIUM')
    expect(tierForPrice(env, price({ id: 'price_anything', product: 'prod_std' }))).toBe('STANDARD')
  })

  it('product beats a conflicting legacy price id (precedence order)', () => {
    // A legacy STANDARD price id living on the PREMIUM product resolves by PRODUCT.
    expect(tierForPrice(env, price({ id: 'price_std_legacy', product: 'prod_prem' }))).toBe('PREMIUM')
  })

  it('legacy price ids resolve when the product does not match (grandfathering)', () => {
    expect(tierForPrice(env, price({ id: 'price_std_legacy', product: 'prod_other' }))).toBe('STANDARD')
    expect(tierForPrice(env, price({ id: 'price_prem_legacy', product: 'prod_other' }))).toBe('PREMIUM')
    expect(tierForPrice(env, price({ id: 'price_std_yearly', product: 'prod_other' }))).toBe('STANDARD')
    expect(tierForPrice(env, price({ id: 'price_prem_yearly', product: 'prod_other' }))).toBe('PREMIUM')
  })

  it('reads an EXPANDED product object too (webhook payloads vary)', () => {
    expect(tierForPrice(env, price({ product: { id: 'prod_prem' } }))).toBe('PREMIUM')
  })

  it('unknown price → FREE (the webhook clobber guard owns the live-sub case)', () => {
    expect(tierForPrice(env, price({ id: 'price_unknown', product: 'prod_other' }))).toBe('FREE')
    expect(tierForPrice(env, undefined)).toBe('FREE')
  })

  it('no env config at all → FREE', () => {
    expect(tierForPrice({} as Env, price())).toBe('FREE')
  })
})

describe('isLifetimePrice', () => {
  it('matches only the configured lifetime price', () => {
    expect(isLifetimePrice(env, 'price_lifetime')).toBe(true)
    expect(isLifetimePrice(env, 'price_std_legacy')).toBe(false)
  })

  it('unset env = feature entirely dormant', () => {
    expect(isLifetimePrice({} as Env, 'price_lifetime')).toBe(false)
  })
})

describe('classifyPrice — the one-round-trip checkout validation', () => {
  it('lifetime short-circuits FIRST (no retrieve round-trip)', async () => {
    const cls = await classifyPrice(stripeWith(new Error('should not be called')), env, 'price_lifetime')
    expect(cls).toEqual({ kind: 'lifetime' })
  })

  it('active recurring price on a tier product → recurring + tier + the price object', async () => {
    const p = price({ id: 'price_weekly', product: 'prod_std', recurring: { interval: 'week', interval_count: 1 } })
    const cls = await classifyPrice(stripeWith(p), env, 'price_weekly')
    expect(cls.kind).toBe('recurring')
    if (cls.kind === 'recurring') {
      expect(cls.tier).toBe('STANDARD')
      expect(cls.price).toBe(p) // the OBJECT rides along for the trial clamp
    }
  })

  it('legacy price id short-circuits sellable without a product match', async () => {
    const p = price({ id: 'price_std_legacy', product: 'prod_other' })
    const cls = await classifyPrice(stripeWith(p), env, 'price_std_legacy')
    expect(cls.kind).toBe('recurring')
    if (cls.kind === 'recurring') expect(cls.tier).toBe('STANDARD')
  })

  it('legacy PREMIUM price id → unsellable (ManyHandz sells FREE+STANDARD only — sellableTiers collapse)', async () => {
    const p = price({ id: 'price_prem_legacy', product: 'prod_other' })
    const cls = await classifyPrice(stripeWith(p), env, 'price_prem_legacy')
    expect(cls).toEqual({ kind: 'unsellable' })
  })

  it('inactive price → unsellable', async () => {
    const cls = await classifyPrice(stripeWith(price({ active: false, product: 'prod_std' })), env, 'price_x')
    expect(cls).toEqual({ kind: 'unsellable' })
  })

  it('non-recurring price → unsellable (payment-mode SKUs go through the lifetime env var)', async () => {
    const cls = await classifyPrice(stripeWith(price({ recurring: null, product: 'prod_std' })), env, 'price_x')
    expect(cls).toEqual({ kind: 'unsellable' })
  })

  it('price resolving FREE (unknown product + id) → unsellable', async () => {
    const cls = await classifyPrice(stripeWith(price({ id: 'price_mystery', product: 'prod_other' })), env, 'price_mystery')
    expect(cls).toEqual({ kind: 'unsellable' })
  })

  it('retrieve failure (bad/deleted/cross-account id) → unsellable, never a throw', async () => {
    const cls = await classifyPrice(stripeWith(new Error('No such price')), env, 'price_gone')
    expect(cls).toEqual({ kind: 'unsellable' })
  })
})

describe('periodDays — the trial-clamp input', () => {
  it.each([
    ['day', 1, 1],
    ['week', 1, 7],
    ['month', 1, 30],
    ['month', 3, 90],
    ['month', 6, 180],
    ['year', 1, 365],
    ['week', 2, 14],
  ] as const)('%s × %d → %d days', (interval, count, expected) => {
    expect(periodDays(price({ recurring: { interval, interval_count: count } }))).toBe(expected)
  })

  it('interval_count missing → 1×', () => {
    expect(periodDays(price({ recurring: { interval: 'week' } }))).toBe(7)
  })

  it('non-recurring / unknown → null', () => {
    expect(periodDays(price({ recurring: null }))).toBeNull()
    expect(periodDays(price({ recurring: { interval: 'fortnight' } }))).toBeNull()
  })
})

describe('composePlans — honest degradation with STRIPE_SECRET_KEY unset (BILLING §10)', () => {
  beforeEach(() => resetPlansCache())

  // Table-driven over the degraded env shapes: no key means NO Stripe round-trips are possible,
  // so every row must resolve locally, instantly, and without a throw.
  it.each([
    ['bare env', {} as Env],
    ['products set but no key', { STRIPE_PRODUCT_STANDARD: 'prod_std' } as unknown as Env],
    ['legacy prices set but no key', { STRIPE_PRICE_STANDARD: 'price_std' } as unknown as Env],
    ['lifetime set but no key', { STRIPE_PRICE_LIFETIME: 'price_life' } as unknown as Env],
  ])('%s → mode:null + FREE + empty sellable shells + lifetime:null', async (_label, degradedEnv) => {
    const plans = await composePlans(degradedEnv)
    expect(plans.mode).toBeNull()
    expect(plans.lifetime).toBeNull() // even when the price var is set — no client to resolve it
    expect(plans.sellableTiers).toEqual(['FREE', 'STANDARD']) // ManyHandz sellableTiers collapse
    expect(plans.tiers.map((t) => t.tier)).toEqual(['FREE', 'STANDARD'])
    const free = plans.tiers[0]
    expect(free.unitAmount).toBe(0)
    for (const paid of plans.tiers.slice(1)) {
      // Empty shells: the client renders config fallback copy with DISABLED CTAs — never fake prices.
      expect(paid.priceId).toBeNull()
      expect(paid.unitAmount).toBeNull()
      expect(paid.prices).toEqual([])
      expect(paid.features).toEqual([])
    }
    resetPlansCache() // each table row composes fresh
  })

  it('carries the config subscription block (trial copy comes from config, not Stripe)', async () => {
    const plans = await composePlans({} as Env)
    expect(plans.subscription).toEqual({ trialDays: 14, gracePeriodDays: 3, trialTier: 'STANDARD' })
  })

  it('mode sniffs the key SHAPE and never echoes the key', async () => {
    // No network happens for mode-sniffing itself; buildTier network failures degrade to empty
    // shells (fetch against api.stripe.com with a fake key rejects → caught → legacy → none set).
    const plans = await composePlans({ STRIPE_SECRET_KEY: 'sk_test_abc123' } as unknown as Env)
    expect(plans.mode).toBe('test')
    expect(JSON.stringify(plans)).not.toContain('sk_test_abc123')
  })
})
