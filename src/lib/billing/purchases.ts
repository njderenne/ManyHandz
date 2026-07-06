import { Platform } from 'react-native'
import { iapTierForProduct, IAP_ENTITLEMENT_TIERS, TIER_ORDER, type Tier } from '@/lib/config/entitlements'

/**
 * RevenueCat IAP adapter — a BUILD-SAFE thin wrapper around `react-native-purchases`.
 *
 * Apple rejects in-app Stripe for digital goods (3.1.1), so NATIVE purchases must go through
 * StoreKit / Play Billing via RevenueCat; web keeps Stripe. But the native SDK + its public key
 * are a documented DEVICE-FINALIZATION step (see the bottom of this file), so this module must NOT
 * hard-depend on `react-native-purchases`: it isn't in package.json, and `npm run export:web` /
 * the current EAS build must stay green without it.
 *
 * The trick: every reference to the SDK goes through a GUARDED dynamic `require`, wrapped so that
 * - on web (Platform.OS === 'web') we never even attempt the require, and
 * - when the module / native binary / public key is absent, every call returns a clear
 *   `{ configured: false }` instead of throwing — so the paywall shows "in-app purchases aren't
 *   configured yet" rather than crashing.
 *
 * Product → tier comes from src/lib/config/entitlements.ts (IAP_PRODUCT_TIERS / IAP_ENTITLEMENT_
 * TIERS) — the SAME map the Worker's revenuecat webhook reads, so device + server never disagree.
 *
 * To FINALIZE on device (one-time, per app): `npm i react-native-purchases`, add its config plugin
 * to app.config.js, fill IAP_PRODUCT_TIERS, set EXPO_PUBLIC_REVENUECAT_KEY to the platform public
 * SDK key, and rebuild via EAS. No code here changes — these guards light up once the module + key
 * exist. See builder/MINT.md.
 */

/** The RevenueCat public SDK key, inlined at build time. Absent today → IAP reports unconfigured. */
const REVENUECAT_KEY = process.env.EXPO_PUBLIC_REVENUECAT_KEY

/** A package offering shown on the paywall — the minimal shape the screen renders + buys. */
export type IapPackage = {
  /** RevenueCat package identifier (the opaque id passed back to purchasePackage). */
  identifier: string
  /** Localized product title from the store (e.g. "Pro (Monthly)"). */
  title: string
  /** Localized price string from the store (e.g. "$3.99"). */
  priceString: string
  /** Which tier this package grants — mapped from the product id (best-effort; null if unknown). */
  tier: Tier | null
  /** The raw RevenueCat package object — passed straight back to purchasePackage(). */
  raw: unknown
}

/** Result envelope — `configured:false` is the build-safe "SDK/key not present" signal. */
export type IapResult<T> = ({ configured: true } & T) | { configured: false }

/**
 * Lazy, guarded handle to the `react-native-purchases` default export. Returns null on web, when
 * the module isn't installed, or when the public key is unset — callers treat null as unconfigured.
 * The `require` is dynamic + wrapped so the bundler never hard-resolves a missing module (web
 * export + the EAS build both succeed without `react-native-purchases` on disk).
 */
function getPurchases(): { Purchases: any; LOG_LEVEL: any } | null {
  if (Platform.OS === 'web' || !REVENUECAT_KEY) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-purchases')
    const Purchases = mod?.default ?? mod?.Purchases ?? mod
    if (!Purchases || typeof Purchases.configure !== 'function') return null
    return { Purchases, LOG_LEVEL: mod?.LOG_LEVEL }
  } catch {
    // Module not installed / native binary missing (Expo Go, web, pre-finalization build).
    return null
  }
}

/**
 * Is native IAP available right now? True only on a native platform where the SDK module + a
 * configured public key both exist. The paywall reads this to decide between the RevenueCat
 * offerings UI and the Stripe fallback. Pure + synchronous so it's safe to call during render.
 */
export function isIapAvailable(): boolean {
  return Platform.OS !== 'web' && Boolean(REVENUECAT_KEY) && getPurchases() !== null
}

function tierForProductId(productId: string | undefined): Tier | null {
  return iapTierForProduct(productId)
}

let configuredFor: string | null = null

/**
 * Configure the RevenueCat SDK with the Better-Auth USER id as the App User ID — THIS is what makes
 * the webhook's `app_user_id` map back to our user (worker/routes/revenuecat.ts resolves the
 * personal org from it). Idempotent per user id; a no-op (returns unconfigured) when IAP is absent.
 */
export function configurePurchases(userId: string): { configured: boolean } {
  const handle = getPurchases()
  if (!handle || !REVENUECAT_KEY) return { configured: false }
  try {
    if (configuredFor !== userId) {
      handle.Purchases.configure({ apiKey: REVENUECAT_KEY, appUserID: userId })
      configuredFor = userId
    }
    return { configured: true }
  } catch {
    return { configured: false }
  }
}

/**
 * Fetch the current offering's packages, normalized to IapPackage[]. Returns `configured:false`
 * when IAP isn't wired up so the UI can fall back rather than crash.
 */
export async function getOfferings(): Promise<IapResult<{ packages: IapPackage[] }>> {
  const handle = getPurchases()
  if (!handle) return { configured: false }
  try {
    const offerings = await handle.Purchases.getOfferings()
    const current = offerings?.current
    const pkgs: any[] = current?.availablePackages ?? []
    const packages: IapPackage[] = pkgs.map((p) => {
      const product = p?.product ?? {}
      const productId: string | undefined = product.identifier
      return {
        identifier: p?.identifier ?? productId ?? 'package',
        title: product.title ?? p?.identifier ?? 'Plan',
        priceString: product.priceString ?? '',
        tier: tierForProductId(productId),
        raw: p,
      }
    })
    return { configured: true, packages }
  } catch {
    return { configured: false }
  }
}

/** Outcome of a purchase/restore: which tier (if any) is now ENTITLED, per the SDK's view. */
export type PurchaseOutcome = { tier: Tier | null; cancelled: boolean }

/** Highest tier among the customer info's ACTIVE entitlements (the SDK's client-side view). */
function tierFromCustomerInfo(info: any): Tier | null {
  const active = info?.entitlements?.active ?? {}
  const entitlements = IAP_ENTITLEMENT_TIERS as Record<string, Tier>
  let best: Tier | null = null
  const rank = (tier: Tier) => TIER_ORDER.indexOf(tier)
  for (const id of Object.keys(active)) {
    const tier = entitlements[id]
    if (tier && (!best || rank(tier) > rank(best))) best = tier
  }
  return best
}

/**
 * Purchase a package. The store + RevenueCat are the source of truth; the SERVER webhook is what
 * actually grants the org entitlement (this only drives the local UI + a refetch). A user-cancelled
 * purchase resolves with `cancelled:true` rather than throwing.
 */
export async function purchasePackage(pkg: IapPackage): Promise<IapResult<PurchaseOutcome>> {
  const handle = getPurchases()
  if (!handle) return { configured: false }
  try {
    const { customerInfo } = await handle.Purchases.purchasePackage(pkg.raw)
    return { configured: true, tier: tierFromCustomerInfo(customerInfo), cancelled: false }
  } catch (e: any) {
    if (e?.userCancelled) return { configured: true, tier: null, cancelled: true }
    throw e
  }
}

/**
 * Restore previous purchases — Apple REQUIRES a visible Restore action on any paywall. Returns the
 * highest restored tier (or null). `configured:false` when IAP is absent.
 */
export async function restorePurchases(): Promise<IapResult<PurchaseOutcome>> {
  const handle = getPurchases()
  if (!handle) return { configured: false }
  try {
    const customerInfo = await handle.Purchases.restorePurchases()
    return { configured: true, tier: tierFromCustomerInfo(customerInfo), cancelled: false }
  } catch {
    return { configured: false }
  }
}
