/**
 * Paywall platform branch — the anti-steering decision as a PURE function so the invariant is
 * unit-testable without rendering (paywall-mode.test.ts is the regression gate).
 *
 * Apple guideline 3.1.1 / anti-steering: on native (especially iOS) the ONLY buy path is the
 * store IAP — never a Stripe CTA, price, or external purchase link. So the branch keys on the
 * PLATFORM first, IAP availability second: a native build without RevenueCat gets the honest
 * "not configured" notice, NEVER the Stripe fallback (that failure mode is an App Store
 * rejection, not a UX bug).
 *
 *   'stripe'              → web only: Stripe checkout cards + billing portal
 *   'store'               → native with RevenueCat configured: store offerings + Restore
 *   'store-unconfigured'  → native without RevenueCat: honest notice, no purchase path
 */
export type PaywallMode = 'stripe' | 'store' | 'store-unconfigured'

export function paywallMode(platformOS: string, iapAvailable: boolean): PaywallMode {
  if (platformOS !== 'web') return iapAvailable ? 'store' : 'store-unconfigured'
  return 'stripe'
}
