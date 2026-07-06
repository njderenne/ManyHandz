import { describe, it, expect } from 'vitest'
import {
  normalizeMonetizationConfig,
  SELLABLE_TIERS,
  REQUIRE_SUBSCRIPTION,
  LIFETIME_TIER,
  TRIAL_ON_ORG_CREATE,
  isSellable,
  limitFor,
  tierFallback,
} from './monetization'

/**
 * The half-merged-app posture (BILLING acceptance): a backported worker file importing this
 * normalizer BEFORE the app's app.ts gains the 2026-07 keys must see pre-merge behavior —
 * full ladder sellable, no hard wall, PREMIUM lifetime, 'all' trials, uncapped limits.
 */
describe('normalizeMonetizationConfig — half-merged-app fallbacks', () => {
  it('reproduces pre-merge behavior when every new key is absent', () => {
    const n = normalizeMonetizationConfig({
      // A pre-merge app.ts: tiers with labels (and the old bare priceLabel), nothing else.
      monetization: {
        tiers: {
          FREE: { label: 'Free' },
          STANDARD: { label: 'Plus', priceLabel: '$4.99 / month' },
          PREMIUM: { label: 'Family' },
        },
      },
      subscription: {},
    })
    expect(n.sellableTiers).toEqual(['FREE', 'STANDARD', 'PREMIUM'])
    expect(n.requireSubscription).toBe(false)
    expect(n.lifetimeTier).toBe('PREMIUM')
    expect(n.trialOnOrgCreate).toBe('all')
    expect(n.limits).toEqual({})
  })

  it('tolerates monetization/subscription blocks missing entirely', () => {
    const n = normalizeMonetizationConfig({})
    expect(n.sellableTiers).toEqual(['FREE', 'STANDARD', 'PREMIUM'])
    expect(n.requireSubscription).toBe(false)
    expect(n.limits).toEqual({})
    expect(n.tiers).toEqual({})
  })

  it('passes explicit values through untouched', () => {
    const n = normalizeMonetizationConfig({
      monetization: {
        sellableTiers: ['FREE', 'STANDARD'],
        requireSubscription: true,
        lifetimeTier: 'STANDARD',
        limits: { pets: 1, historyDays: 7 },
      },
      subscription: { trialOnOrgCreate: 'none' },
    })
    expect(n.sellableTiers).toEqual(['FREE', 'STANDARD'])
    expect(n.requireSubscription).toBe(true)
    expect(n.lifetimeTier).toBe('STANDARD')
    expect(n.trialOnOrgCreate).toBe('none')
    expect(n.limits).toEqual({ pets: 1, historyDays: 7 })
  })
})

describe('module-level consts — the ManyHandz APP_CONFIG', () => {
  it('app config resolves to the locked ManyHandz posture (BILLING §11.7 wave 1)', () => {
    // Single sold plan ("Premium" in the STANDARD slot); PREMIUM stays unsold.
    expect(SELLABLE_TIERS).toEqual(['FREE', 'STANDARD'])
    expect(REQUIRE_SUBSCRIPTION).toBe(false)
    expect(LIFETIME_TIER).toBe('PREMIUM')
    expect(TRIAL_ON_ORG_CREATE).toBe('all')
  })

  it('isSellable mirrors SELLABLE_TIERS', () => {
    expect(isSellable('FREE')).toBe(true)
    expect(isSellable('STANDARD')).toBe(true)
    expect(isSellable('PREMIUM')).toBe(false) // intentionally unsold
  })

  it('limitFor reads monetization.limits; absent keys are uncapped no-ops', () => {
    expect(limitFor('members')).toBe(3) // FREE household member cap
    expect(limitFor('lists')).toBe(3) // FREE chore-library cap
    expect(limitFor('anything-else')).toBeUndefined()
  })
})

describe('tierFallback — baked paywall copy', () => {
  it('reads the V5 fallback block from the template config', () => {
    const free = tierFallback('FREE')
    expect(free.priceLabel).toBe('$0')
    expect(free.features.length).toBeGreaterThan(0)
  })

  it('tolerates the pre-V5 bare priceLabel (un-codemodded backports)', () => {
    const n = normalizeMonetizationConfig({
      monetization: { tiers: { STANDARD: { label: 'Plus', priceLabel: '$4.99 / month' } } },
    })
    // Re-derive through the same precedence the exported helper uses.
    const tier = n.tiers.STANDARD
    const priceLabel = tier?.fallback?.priceLabel ?? tier?.priceLabel ?? null
    expect(priceLabel).toBe('$4.99 / month')
  })
})
