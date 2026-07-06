import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import { authClient } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'

/**
 * useSubscription — the client side of the entitlement layer. Queries the Worker's billing
 * summary (Stripe webhooks sync it onto the active organization) under an org-scoped query key,
 * and exposes the tier-ladder helpers the gating UI (TierGate, paywall) builds on. Loading,
 * error, and signed-out states all resolve to FREE so paid surfaces fail closed.
 *
 * usePlans + the formatters are the paywall's live-pricing half: GET /api/billing/plans is
 * PUBLIC (prices are public; the landing/paywall may render pre-auth) and composed server-side
 * from Stripe products, so pricing + copy change with no app rebuild.
 */

/** The tier ladder, ranked low → high. Index = rank for `isAtLeast` comparisons. */
export const TIER_ORDER = ['FREE', 'STANDARD', 'PREMIUM'] as const

export type Tier = keyof typeof APP_CONFIG.monetization.tiers

/**
 * Shape of GET /api/billing/summary — derived from the active org's billing columns.
 * `managedBy` = the provider of the winning live subscription row ('stripe' | 'apple' | 'google'
 * today; typed string because provider is a vocabulary column — treat unknown values as
 * "managed externally"). null = no live row (e.g. a bootstrap trial).
 */
export type BillingSummary = {
  tier: Tier
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  managedBy: string | null
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

// ─── Plans (public pricing) — BILLING_SPEC §9.1 ────────────────────────────────────────────────

/**
 * Shapes of GET /api/billing/plans (worker/billing/catalog.ts PlansResponse, re-declared
 * client-side). `null` fields mean the price isn't readable (Stripe unset/unreachable) — callers
 * fall back to the baked config copy (tierFallback in src/lib/config/monetization.ts).
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
  /** Primary (cheapest) price — the legacy flat contract. */
  priceId: string | null
  unitAmount: number | null
  currency: string | null
  interval: 'day' | 'week' | 'month' | 'year' | null
  intervalCount: number | null
  /** Display label + feature bullets from Stripe Product metadata (admin-editable). */
  label: string | null
  features: string[]
  productName: string | null
  /** ALL billing frequencies for this tier, cheapest first. */
  prices: PlanPrice[]
}

export interface Plans {
  /** The Worker's Stripe mode (sniffed from the key shape) — null = billing not configured. */
  mode: 'live' | 'test' | null
  subscription: { trialDays: number | null; gracePeriodDays: number | null; trialTier: Tier }
  sellableTiers: Tier[]
  lifetime: (Pick<PlanPrice, 'priceId' | 'unitAmount' | 'currency'> & { tier: Tier }) | null
  /** FREE always + the SELLABLE paid tiers (server-side filter is authoritative). */
  tiers: PlanTier[]
}

/**
 * Live pricing for the paywall. NOT org-scoped (prices are public) and safe pre-auth — the web
 * landing/paywall are reachable signed-out. retry 1: a flaky fetch shouldn't spin forever; the
 * paywall's error branch owns the retry UX.
 */
export function usePlans() {
  return useQuery({
    queryKey: queryKeys.billing.plans(),
    queryFn: () => apiFetch<Plans>('/api/billing/plans'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}

/** Human label for a billing frequency, e.g. "Weekly", "Quarterly", "Yearly". */
export function frequencyLabel(p: Pick<PlanPrice, 'interval' | 'intervalCount'>): string {
  if (!p.interval) return t('billing.frequency.oneTime')
  const n = p.intervalCount ?? 1
  const map: Record<string, string> = {
    'day:1': t('billing.frequency.daily'),
    'week:1': t('billing.frequency.weekly'),
    'month:1': t('billing.frequency.monthly'),
    'month:3': t('billing.frequency.quarterly'),
    'month:6': t('billing.frequency.semiannual'),
    'year:1': t('billing.frequency.yearly'),
  }
  return (
    map[`${p.interval}:${n}`] ??
    (n > 1
      ? t('billing.frequency.every', { n, interval: p.interval })
      : t('billing.frequency.per', { interval: p.interval }))
  )
}

/** Just the amount, e.g. "$6.99" — null if unknown (caller falls back to baked copy). */
export function formatPriceAmount(p: Pick<PlanPrice, 'unitAmount' | 'currency'>): string | null {
  if (p.unitAmount == null || !p.currency) return null
  try {
    return (p.unitAmount / 100).toLocaleString(undefined, {
      style: 'currency',
      currency: p.currency.toUpperCase(),
    })
  } catch {
    return `${(p.unitAmount / 100).toFixed(2)} ${p.currency.toUpperCase()}`
  }
}

/** Format a plan's primary price for display, e.g. "$6.99 / month" — null if unknown. */
export function formatPlanPrice(plan: PlanTier): string | null {
  const amount = formatPriceAmount(plan)
  if (amount == null) return null
  if (!plan.interval) return amount
  const every =
    plan.intervalCount && plan.intervalCount > 1
      ? `${plan.intervalCount} ${plan.interval}s`
      : plan.interval
  return `${amount} / ${every}`
}
