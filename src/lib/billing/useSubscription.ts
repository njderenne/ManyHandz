import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import { authClient } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * useSubscription — the client side of the entitlement layer. Queries the Worker's billing
 * summary (Stripe webhooks sync it onto the active organization) under an org-scoped query key,
 * and exposes the tier-ladder helpers the gating UI (TierGate, paywall) builds on. Loading,
 * error, and signed-out states all resolve to FREE so paid surfaces fail closed.
 */

/** The tier ladder, ranked low → high. Index = rank for `isAtLeast` comparisons. */
export const TIER_ORDER = ['FREE', 'STANDARD', 'PREMIUM'] as const

export type Tier = keyof typeof APP_CONFIG.monetization.tiers

/** Shape of GET /api/billing/summary — derived from the active org's billing columns. */
export type BillingSummary = {
  tier: Tier
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
}

/** The active organization's billing summary. Disabled (and FREE-equivalent) without an org. */
export function useSubscription() {
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''
  return useQuery({
    queryKey: queryKeys.billing.summary(orgId),
    queryFn: () => apiFetch<BillingSummary>('/api/billing/summary'),
    enabled: Boolean(orgId),
  })
}

/** True when `tier` ranks at or above `min` on the FREE → STANDARD → PREMIUM ladder. */
export function isAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min)
}

/** True when the active org's subscription meets `min`. FREE (false) while loading/signed out. */
export function useHasTier(min: Tier): boolean {
  const { data } = useSubscription()
  return isAtLeast(data?.tier ?? 'FREE', min)
}
