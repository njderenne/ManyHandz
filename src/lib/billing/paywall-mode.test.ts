import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { paywallMode } from './paywall-mode'

/**
 * Anti-steering regression gate (BILLING acceptance): the paywall renders NO startCheckout
 * affordance when Platform.OS !== 'web'. app/paywall.tsx branches exclusively on paywallMode(),
 * and only the 'stripe' mode reaches the Stripe cards/CTAs — so "native never resolves to
 * 'stripe'" IS the invariant.
 */
describe('paywallMode — native never reaches the Stripe branch', () => {
  const nativePlatforms = ['ios', 'android', 'macos', 'windows']

  it.each(nativePlatforms)('%s + IAP configured → store', (os) => {
    expect(paywallMode(os, true)).toBe('store')
  })

  it.each(nativePlatforms)('%s + IAP NOT configured → honest notice, never stripe', (os) => {
    expect(paywallMode(os, false)).toBe('store-unconfigured')
  })

  it('web → stripe (regardless of the impossible iapAvailable=true)', () => {
    expect(paywallMode('web', false)).toBe('stripe')
    // isIapAvailable() is false-by-construction on web; even if it lied, web stays Stripe.
    expect(paywallMode('web', true)).toBe('stripe')
  })

  it('the stripe mode is exactly the web mode', () => {
    for (const os of [...nativePlatforms, 'web']) {
      for (const iap of [true, false]) {
        const mode = paywallMode(os, iap)
        expect(mode === 'stripe').toBe(os === 'web')
      }
    }
  })
})

describe('app/paywall.tsx actually branches on paywallMode (source guard)', () => {
  // The pure-function invariant above only protects the screen if the screen USES it. This
  // source-level guard (theme-guard.test.ts idiom) fails if a refactor detaches the paywall from
  // paywallMode or renders the Stripe section outside the mode ternary.
  const src = readFileSync(resolve(process.cwd(), 'app/paywall.tsx'), 'utf8')

  it('imports and calls paywallMode with the real platform', () => {
    expect(src).toContain("from '@/lib/billing/paywall-mode'")
    expect(src).toContain('paywallMode(Platform.OS')
  })

  it('renders the Stripe surface only through the mode branch', () => {
    // Exactly one <StripeSection mount, and it sits in the mode ternary's web arm.
    expect(src.match(/<StripeSection/g)).toHaveLength(1)
    expect(src).toMatch(/mode === 'store'[\s\S]*?mode === 'store-unconfigured'[\s\S]*?<StripeSection/)
  })

  it('startCheckout is never referenced outside the Stripe-only components', () => {
    // NativeSection + NativePlans (the only code reachable off-web) must not touch startCheckout.
    const nativeHalf = src.slice(src.indexOf('function NativeSection'))
    expect(nativeHalf).not.toContain('startCheckout')
  })
})
