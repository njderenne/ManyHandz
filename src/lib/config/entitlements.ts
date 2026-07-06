/**
 * Entitlements config — the FREE / STANDARD / PREMIUM split as ONE source of truth, read by BOTH the
 * client (TierGate UI) and the Worker (requireFeature / checkAiQuota). This file is dependency-free
 * (no react-query / expo / auth-client imports) so the Worker can import it.
 *
 * Per-app contract: the factory fills FEATURE_TIERS + AI_MONTHLY_LIMITS with THIS app's gated
 * resources and AI features. The entries below are EXAMPLES — replace them. The mechanism
 * (resolveTier / requireFeature / checkAiQuota) lives in worker/entitlements.ts and never changes.
 */

/** The tier ladder, ranked low → high (index = rank). */
export const TIER_ORDER = ['FREE', 'STANDARD', 'PREMIUM'] as const

export type Tier = (typeof TIER_ORDER)[number]

/**
 * Resource/feature → minimum paid tier. A key ABSENT here is FREE. requireFeature(db, orgId, key)
 * enforces these server-side; the client TierGate hides the UI. Replace the examples per app.
 */
export const FEATURE_TIERS = {
  /** CHASSIS key (keep): MINTING share grants (features.shareGrants) is paid; list/revoke/delete/
   *  activity stay free forever — the wind-down asymmetry law (worker/routes/grants.ts). */
  shareGrants: 'STANDARD',
  // EXAMPLE — replace with this app's gated resources:
  // advancedAnalytics: 'STANDARD',
  // dataExport: 'STANDARD',
  // teamSeats: 'PREMIUM',
} as const satisfies Record<string, Exclude<Tier, 'FREE'>>

export type GatedFeature = keyof typeof FEATURE_TIERS

/**
 * AI per-feature monthly quotas by tier. FREE can get a real monthly TASTE; Infinity = uncapped.
 * Counted per USER per calendar month against api_usage (successful calls only) — so each KEY here
 * MUST match the `feature` string the corresponding AI call logs (worker/usage/log.ts → logApiUsage),
 * e.g. 'ai.complete' / 'ai.chat'. Replace the examples with this app's metered AI features.
 */
export const AI_MONTHLY_LIMITS = {
  // EXAMPLE — replace with this app's AI features (key === the logged `feature`):
  // 'ai.complete': { FREE: 5, STANDARD: 100, PREMIUM: Infinity },
  // 'ai.chat': { FREE: 10, STANDARD: 500, PREMIUM: Infinity },
} as const satisfies Record<string, Record<Tier, number>>

export type AiFeature = keyof typeof AI_MONTHLY_LIMITS

/** Monthly allowance for an AI feature at a tier (Infinity = uncapped). */
export function aiLimitFor(feature: AiFeature, tier: Tier): number {
  return AI_MONTHLY_LIMITS[feature][tier]
}

/**
 * Native in-app-purchase product → tier. Apple rejects in-app Stripe for digital goods (3.1.1), so
 * iOS/Android buy via StoreKit / Play Billing through RevenueCat (web keeps Stripe). The CLIENT
 * (src/lib/billing/purchases.ts) and the WORKER (worker/routes/revenuecat.ts) BOTH read this map, so
 * a product resolves to the SAME tier on device and on the server. Keys are the store product ids
 * you register in the RevenueCat dashboard — the IAP analogue of STRIPE_PRICE_STANDARD / _PREMIUM.
 * EMPTY by default (a minted app fills it); until then native IAP resolves nothing and the paywall
 * shows its "not configured yet" notice. Replace the examples per app.
 */
export const IAP_PRODUCT_TIERS = {
  /**
   * ManyHandz locked grid (appfactory-manyhandz-pricing): the sold plan is "Premium" in the
   * STANDARD slot — weekly $2.99 · monthly $5.99 · yearly $39.99. RevenueCat is NOT provisioned
   * yet (no EXPO_PUBLIC_REVENUECAT_KEY, react-native-purchases not installed), so the native
   * paywall renders the honest notice; when the dashboard is set up, the product ids registered
   * there MUST match these keys (or update this map in the same change).
   */
  manyhandz_standard_weekly: 'STANDARD',
  manyhandz_standard_monthly: 'STANDARD',
  manyhandz_standard_yearly: 'STANDARD',
} as const satisfies Record<string, Exclude<Tier, 'FREE'>>

/**
 * Fallback: RevenueCat ENTITLEMENT id → tier, used when an event's product id isn't in
 * IAP_PRODUCT_TIERS (so a NEW SKU under an existing entitlement still resolves).
 */
export const IAP_ENTITLEMENT_TIERS = {
  standard: 'STANDARD',
  premium: 'PREMIUM',
} as const satisfies Record<string, Exclude<Tier, 'FREE'>>

/**
 * Resolve the tier an IAP product/entitlement grants: product id first, then any entitlement id,
 * else null (unknown — the webhook acks + logs, the client shows no tier). Shared by client + worker
 * so device and server never disagree.
 */
export function iapTierForProduct(
  productId: string | null | undefined,
  entitlementIds: readonly string[] = [],
): Tier | null {
  const products = IAP_PRODUCT_TIERS as Record<string, Tier>
  if (productId && productId in products) return products[productId]
  const entitlements = IAP_ENTITLEMENT_TIERS as Record<string, Tier>
  for (const ent of entitlementIds) {
    if (ent in entitlements) return entitlements[ent]
  }
  return null
}
