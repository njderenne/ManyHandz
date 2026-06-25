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

/**
 * Shape of GET /api/billing/plans — the dynamic pricing source. Composed server-side from the
 * Stripe price (amount/interval) + product metadata (label/features), so the paywall renders
 * live pricing the studio admin (Criterial) manages, with no app rebuild. `null` fields mean the
 * tier's price isn't readable (Stripe unset/unreachable) — callers fall back to baked defaults.
 */
export interface PlanPrice {
  priceId: string
  unitAmount: number | null
  currency: string | null
  interval: 'day' | 'week' | 'month' | 'year' | null
  intervalCount: number | null
}
export interface PlanTier {
  tier: Tier
  priceId: string | null
  unitAmount: number | null
  currency: string | null
  interval: 'day' | 'week' | 'month' | 'year' | null
  intervalCount: number | null
  label: string | null
  features: string[]
  productName: string | null
  /** All prices for this tier (each a billing frequency). */
  prices?: PlanPrice[]
}
export interface Plans {
  tiers: PlanTier[]
}

/** Human label for a billing frequency, e.g. "Weekly", "Quarterly", "Yearly". */
export function frequencyLabel(p: Pick<PlanPrice, 'interval' | 'intervalCount'>): string {
  if (!p.interval) return 'One-time'
  const n = p.intervalCount ?? 1
  const map: Record<string, string> = {
    'week:1': 'Weekly',
    'month:1': 'Monthly',
    'month:3': 'Quarterly',
    'month:6': 'Semi-annual',
    'year:1': 'Yearly',
    'day:1': 'Daily',
  }
  return map[`${p.interval}:${n}`] ?? (n > 1 ? `Every ${n} ${p.interval}s` : `Per ${p.interval}`)
}

/** Just the amount, e.g. "$6.99" — null if unknown. */
export function formatPriceAmount(p: Pick<PlanPrice, 'unitAmount' | 'currency'>): string | null {
  if (p.unitAmount == null || !p.currency) return null
  try {
    return (p.unitAmount / 100).toLocaleString(undefined, { style: 'currency', currency: p.currency.toUpperCase() })
  } catch {
    return `${(p.unitAmount / 100).toFixed(2)} ${p.currency.toUpperCase()}`
  }
}

/** Live pricing for the paywall. Not org-scoped; safe to fetch before sign-in. */
export function usePlans() {
  return useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: () => apiFetch<Plans>('/api/billing/plans'),
    staleTime: 5 * 60 * 1000,
  })
}

/** Format a plan's price for display, e.g. "$6.99 / month" — null if the amount isn't known. */
export function formatPlanPrice(plan: PlanTier): string | null {
  if (plan.unitAmount == null || !plan.currency) return null
  let amount: string
  try {
    amount = (plan.unitAmount / 100).toLocaleString(undefined, {
      style: 'currency',
      currency: plan.currency.toUpperCase(),
    })
  } catch {
    amount = `${(plan.unitAmount / 100).toFixed(2)} ${plan.currency.toUpperCase()}`
  }
  if (!plan.interval) return amount
  const every =
    plan.intervalCount && plan.intervalCount > 1
      ? `${plan.intervalCount} ${plan.interval}s`
      : plan.interval
  return `${amount} / ${every}`
}
