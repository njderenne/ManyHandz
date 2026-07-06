import * as WebBrowser from 'expo-web-browser'
import { apiFetch, ApiError } from '@/lib/api/client'

/**
 * Billing client — calls the auth-gated Stripe Worker routes and opens the returned Stripe URL in
 * an in-app browser. Subscription state lands on the active organization (the webhook syncs it),
 * so refetch the org after the browser closes to reflect the new tier. Requires a signed-in session.
 *
 * WEB ONLY by policy: native digital goods buy via RevenueCat IAP (src/lib/billing/purchases.ts)
 * — Apple 3.1.1 rejects in-app Stripe, and the paywall never renders these CTAs off-web.
 */

/** Start a subscription checkout (or the one-time Lifetime purchase) for the given Stripe price. */
export async function startCheckout(priceId: string) {
  const { url } = await apiFetch<{ url: string | null }>('/api/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify({ priceId }),
  })
  if (url) await WebBrowser.openBrowserAsync(url)
}

/** Open the Stripe billing portal (manage / cancel / update payment method). */
export async function openBillingPortal() {
  const { url } = await apiFetch<{ url: string | null }>('/api/stripe/portal', { method: 'POST' })
  if (url) await WebBrowser.openBrowserAsync(url)
}

// ─── 402 routing (BILLING_SPEC §9.4) ───────────────────────────────────────────────────────────

/**
 * The canonical billing-denial codes — MIRRORS worker/billing/limits.ts BillingErrorCode (the
 * client can't import worker files; keep the lists in sync). Every denial the Worker sends rides
 * `{ error, code, limit?, used?, upgradeTier? }` with HTTP 402 ('billing_not_configured' is the
 * one 503 — an operator problem, never an upsell).
 */
const BILLING_ERROR_CODES = [
  'tier_required',
  'entity_cap_exceeded',
  'member_cap_exceeded',
  'tenant_limit_exceeded',
  'storage_quota_exceeded',
  'ai_quota_exceeded',
  'billing_not_configured',
] as const

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number]

/**
 * Classify an error as an upgradeable billing denial. Returns the denial code for a 402 carrying
 * a known `code`, else null. Call sites toast the server's `error` copy with an "Upgrade" action:
 *
 *   const code = isUpgradeError(e)
 *   if (code) toast({ title: e.message, action: { label: t('billing.upgradeAction'),
 *                     onPress: () => router.push(`/paywall?reason=${code}`) } })
 *
 * 'billing_not_configured' never matches (it's a 503) — there is nothing to sell.
 */
export function isUpgradeError(e: unknown): BillingErrorCode | null {
  if (!(e instanceof ApiError) || e.status !== 402) return null
  const code = (e.data as { code?: unknown } | undefined)?.code
  return typeof code === 'string' && (BILLING_ERROR_CODES as readonly string[]).includes(code)
    ? (code as BillingErrorCode)
    : null
}
