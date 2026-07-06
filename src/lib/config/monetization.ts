import { APP_CONFIG } from './app'

/**
 * Monetization normalizer — the ONE place chassis code reads the merge-sensitive monetization /
 * subscription config keys (BILLING_SPEC §6.2). Dependency-free (no react-query / expo / auth
 * imports) so the Worker imports it too.
 *
 * WHY a normalizer instead of direct APP_CONFIG reads: nine shipped apps backport this billing
 * chassis in waves, and a worker file merged BEFORE an app's app.ts gains the new keys must still
 * typecheck AND behave exactly as it did pre-merge. Every new key therefore resolves through a
 * tolerant `??` default that reproduces pre-merge behavior when the key is absent:
 *   sellableTiers absent      → full FREE→STANDARD→PREMIUM ladder sellable
 *   requireSubscription absent → no hard wall (freemium)
 *   lifetimeTier absent        → PREMIUM (feature stays dormant without the env price anyway)
 *   trialOnOrgCreate absent    → 'all' (today's stamp-on-every-org-create behavior)
 *   limits absent              → {} (every cap enforcement is a no-op)
 * This is the merge-ordering armor that makes the backport safe without a codemod (the only
 * codemod is the V5 paywall-copy lift, BILLING §11.4).
 */

/** The tier ladder, ranked low → high. Local const — no import cycle with billing hooks. */
const TIER_ORDER = ['FREE', 'STANDARD', 'PREMIUM'] as const

export type Tier = (typeof TIER_ORDER)[number]
export type TrialOnOrgCreate = 'all' | 'personal' | 'none'

/** Baked per-tier paywall copy — `fallback` is the V5 shape; bare `priceLabel` is the pre-V5
 *  legacy key old app.ts files still carry (tolerated forever). */
type TierCopy = {
  label: string
  priceLabel?: string
  fallback?: { priceLabel?: string; features?: readonly string[] }
}

/** The subset of APP_CONFIG the normalizer reads — every new key optional (half-merged apps). */
type RawMonetizationConfig = {
  monetization?: {
    tiers?: Readonly<Partial<Record<Tier, TierCopy>>>
    sellableTiers?: readonly Tier[]
    requireSubscription?: boolean
    lifetimeTier?: Exclude<Tier, 'FREE'>
    limits?: Readonly<Record<string, number>>
  }
  subscription?: {
    trialOnOrgCreate?: TrialOnOrgCreate
  }
}

export interface NormalizedMonetization {
  sellableTiers: readonly Tier[]
  requireSubscription: boolean
  lifetimeTier: Exclude<Tier, 'FREE'>
  trialOnOrgCreate: TrialOnOrgCreate
  limits: Readonly<Record<string, number>>
  tiers: Readonly<Partial<Record<Tier, TierCopy>>>
}

/**
 * Pure normalizer core — exported so the half-merged-app fallback behavior is unit-testable
 * (monetization.test.ts feeds it configs with the new keys stripped; the module-level consts
 * below apply it to the real APP_CONFIG).
 */
export function normalizeMonetizationConfig(raw: RawMonetizationConfig): NormalizedMonetization {
  const m = raw.monetization
  const s = raw.subscription
  return {
    sellableTiers: m?.sellableTiers ?? ['FREE', 'STANDARD', 'PREMIUM'],
    requireSubscription: m?.requireSubscription ?? false,
    lifetimeTier: m?.lifetimeTier ?? 'PREMIUM',
    trialOnOrgCreate: s?.trialOnOrgCreate ?? 'all',
    limits: m?.limits ?? {},
    tiers: m?.tiers ?? {},
  }
}

const normalized = normalizeMonetizationConfig(APP_CONFIG as RawMonetizationConfig)

/** Tiers the paywall SELLS (server-side /plans filter is authoritative; client filters too). */
export const SELLABLE_TIERS: readonly Tier[] = normalized.sellableTiers

/** cadio's hard wall — true routes signed-in unpaid users to /paywall (use-require-subscription). */
export const REQUIRE_SUBSCRIPTION: boolean = normalized.requireSubscription

/** Tier the one-time Lifetime SKU grants (dormant without STRIPE_PRICE_LIFETIME / an IAP SKU). */
export const LIFETIME_TIER: Exclude<Tier, 'FREE'> = normalized.lifetimeTier

/** Which org creations bootstrap an in-app trial (worker/billing/trial.ts reads this). */
export const TRIAL_ON_ORG_CREATE: TrialOnOrgCreate = normalized.trialOnOrgCreate

/** True when the paywall may sell `tier`. */
export const isSellable = (tier: Tier): boolean => SELLABLE_TIERS.includes(tier)

/** Free-tier numeric cap for `key` (monetization.limits); undefined = uncapped (enforcement no-op). */
export const limitFor = (key: string): number | undefined => normalized.limits[key]

/**
 * Baked paywall copy for a tier — the V5 `fallback` block first, the pre-V5 bare `priceLabel`
 * tolerated for un-codemodded apps. Renders whenever live Stripe metadata is unresolved.
 */
export const tierFallback = (t: Tier): { priceLabel: string | null; features: string[] } => {
  const tier = normalized.tiers[t]
  return {
    priceLabel: tier?.fallback?.priceLabel ?? tier?.priceLabel ?? null,
    features: [...(tier?.fallback?.features ?? [])],
  }
}
