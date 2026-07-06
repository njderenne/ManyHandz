import { describe, it, expect } from 'vitest'
import type Stripe from 'stripe'
import type { DB } from '@/lib/db'
import { trialBootstrapFields, bootstrapTrial, hasEverSubscribed, checkoutTrialDays } from './trial'

/**
 * checkoutTrialDays truth table (BILLING_SPEC §7.3). The template config is the fixture:
 * trialDays 14 · trialOnOrgCreate 'all' — the four-step rule is exercised against it.
 */

const DAY = 86_400_000

/**
 * Minimal thenable-chain Drizzle mock: every method returns the chain; each AWAIT of the chain
 * pops the next queued result set. Enough for `db.select().from().where().limit(1)`.
 */
function fakeDb(results: unknown[][] = []): DB {
  const queue = [...results]
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          const rows = queue.shift() ?? []
          return (resolve: (v: unknown) => void) => resolve(rows)
        }
        return () => chain
      },
    },
  )
  return chain as DB
}

/** Price fixture — only `recurring` matters here (periodDays input). */
function priceWith(interval: 'week' | 'month' | 'year', count = 1): Stripe.Price {
  return { id: 'price_x', recurring: { interval, interval_count: count } } as unknown as Stripe.Price
}

const monthly = priceWith('month')
const weekly = priceWith('week')

const NO_PRIOR_SUBS: unknown[][] = [[]] // hasEverSubscribed → no rows
const PRIOR_SUB: unknown[][] = [[{ id: 'sub_1' }]] // hasEverSubscribed → a row exists

describe('checkoutTrialDays — the ratified four-step rule', () => {
  it('live in-app trial → the REMAINING days (Stripe trial ends when it would have)', async () => {
    const org = { id: 'org1', trialEndsAt: new Date(Date.now() + 5 * DAY + 60_000) }
    expect(await checkoutTrialDays(fakeDb(NO_PRIOR_SUBS), org, monthly)).toBe(6) // ceil(5d + 1min)
  })

  it('expired trial → 0 (they had it; no re-trial via checkout)', async () => {
    const org = { id: 'org1', trialEndsAt: new Date(Date.now() - DAY) }
    expect(await checkoutTrialDays(fakeDb(), org, monthly)).toBe(0)
  })

  it('untrialed org (trialEndsAt null) → the full configured trialDays', async () => {
    const org = { id: 'org1', trialEndsAt: null }
    expect(await checkoutTrialDays(fakeDb(NO_PRIOR_SUBS), org, monthly)).toBe(14)
  })

  it('ANY prior subscription row → 0 (cancel-and-recheckout never re-trials)', async () => {
    const org = { id: 'org1', trialEndsAt: null }
    expect(await checkoutTrialDays(fakeDb(PRIOR_SUB), org, monthly)).toBe(0)
  })

  it('weekly price clamps 14 → 7 (never a trial longer than ~a billing cycle)', async () => {
    const org = { id: 'org1', trialEndsAt: null }
    expect(await checkoutTrialDays(fakeDb(NO_PRIOR_SUBS), org, weekly)).toBe(7)
  })

  it('monthly price does NOT clamp (pd 30 ≥ 28 keeps the full trial)', async () => {
    const org = { id: 'org1', trialEndsAt: null }
    expect(await checkoutTrialDays(fakeDb(NO_PRIOR_SUBS), org, monthly)).toBe(14)
  })

  it('yearly price does NOT clamp', async () => {
    const org = { id: 'org1', trialEndsAt: null }
    expect(await checkoutTrialDays(fakeDb(NO_PRIOR_SUBS), org, priceWith('year'))).toBe(14)
  })

  it('the clamp applies to remaining-days too (live trial + weekly price)', async () => {
    const org = { id: 'org1', trialEndsAt: new Date(Date.now() + 10 * DAY + 60_000) }
    expect(await checkoutTrialDays(fakeDb(NO_PRIOR_SUBS), org, weekly)).toBe(7)
  })

  it('days ≥ 1 invariant: a sliver of remaining trial ceils to 1, never a fractional day', async () => {
    const org = { id: 'org1', trialEndsAt: new Date(Date.now() + 30 * 60_000) } // 30 minutes left
    const days = await checkoutTrialDays(fakeDb(NO_PRIOR_SUBS), org, monthly)
    expect(days).toBe(1)
    expect(Number.isInteger(days)).toBe(true)
  })
})

describe('hasEverSubscribed', () => {
  it('true with any row, false with none', async () => {
    expect(await hasEverSubscribed(fakeDb(PRIOR_SUB), 'org1')).toBe(true)
    expect(await hasEverSubscribed(fakeDb(NO_PRIOR_SUBS), 'org1')).toBe(false)
  })
})

describe('trialBootstrapFields — the org-INSERT fragment', () => {
  it("template config (trialDays 14, 'all') stamps trialing + ~14 days out", () => {
    const fields = trialBootstrapFields()
    expect('subscriptionStatus' in fields && fields.subscriptionStatus).toBe('trialing')
    if ('trialEndsAt' in fields) {
      const delta = fields.trialEndsAt.getTime() - Date.now()
      expect(delta).toBeGreaterThan(13.9 * DAY)
      expect(delta).toBeLessThanOrEqual(14 * DAY)
    }
  })
})

describe('bootstrapTrial — the Better-Auth afterCreate path', () => {
  it("stamps trialing (template config is 'all') through an idempotent guarded UPDATE", async () => {
    const sets: Array<Record<string, unknown>> = []
    const db = {
      update: () => ({
        set: (v: Record<string, unknown>) => {
          sets.push(v)
          return { where: async () => [] }
        },
      }),
    } as unknown as DB
    await bootstrapTrial(db, 'org1')
    expect(sets).toHaveLength(1)
    expect(sets[0].subscriptionStatus).toBe('trialing')
    expect(sets[0].trialEndsAt).toBeInstanceOf(Date)
  })
})
