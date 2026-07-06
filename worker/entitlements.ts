import { and, count, eq, gte } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { FEATURE_TIERS, aiLimitFor, type GatedFeature, type AiFeature } from '@/lib/config/entitlements'

/**
 * Entitlements — the server-side feature gate. Routes that sell a premium feature call `requireTier`
 * / `requireFeature` BEFORE doing the work; the client's subscription hook only hides buttons, it is
 * never the authorization (golden rule: the app layer authorizes, the UI just decorates).
 *
 * Tier ordering: FREE < STANDARD < PREMIUM. A `trialing` org whose trialEndsAt is still in the future
 * is treated as at-least-STANDARD, so trials unlock paid features without a subscription row. Canceled
 * subs keep their tier through the paid period + grace window. Billing columns are synced onto
 * `organization` by the Stripe webhook / IAP handlers (which call resolveOrgEntitlement) — these
 * helpers only READ.
 *
 *   const gate = await requireTier(db, orgId, 'PREMIUM')
 *   if (!gate.ok) {
 *     return billingError(c, { ok: false, error: gate.reason, code: 'tier_required', upgradeTier: 'PREMIUM' })
 *   }
 *
 * Denials go out through the canonical BILLING §8.1 envelope (worker/billing/limits.ts
 * `billingError`) — a bare `{ error }` 402 is invisible to the client's isUpgradeError() routing.
 */

const TIER_RANK = { FREE: 0, STANDARD: 1, PREMIUM: 2 } as const

export type Tier = keyof typeof TIER_RANK

export type EntitlementCheck = { ok: true } | { ok: false; reason: string }

type SubscriptionStatus = (typeof schema.subscriptionStatusEnum.enumValues)[number]

/** The billing columns effectiveTier reads — a subset of the organization row. */
export type BillingColumns = {
  subscriptionTier: Tier
  subscriptionStatus: SubscriptionStatus | string | null
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
}

/**
 * effectiveTier — pure + synchronous: compute the EFFECTIVE tier from an org's stored billing
 * columns, with NO db read. The single source of truth for "what does this org have right now",
 * shared by the server gate (resolveTier → requireTier) AND the client billing summary
 * (routes/billing.ts) so the UI's useHasTier can never disagree with the gate (the drift that hides
 * the premium nudge from trial users while the server still honors the feature).
 *
 * Rules: the cached billing tier, lifted to the configured trial tier during a live trial
 * (APP_CONFIG.subscription.trialTier — STANDARD by default; bump per app), kept through the grace
 * window for past_due / unpaid / canceled, then dropped to FREE once the paid period + grace lapses.
 */
export function effectiveTier(org: BillingColumns): Tier {
  const now = Date.now()
  let tier: Tier = org.subscriptionTier

  // A LIVE trial lifts to the app's configured trial tier (default STANDARD — see APP_CONFIG).
  // Keyed off trialEndsAt ALONE — NOT subscriptionStatus — because a trial org has no `subscription`
  // row, so resolveOrgEntitlement() (run by every billing webhook) resolves status to null and
  // overwrites org.subscriptionStatus, which would destroy a status-gated lift and drop the org to
  // FREE mid-trial.
  const trialTier = APP_CONFIG.subscription.trialTier
  const inTrial = org.trialEndsAt !== null && org.trialEndsAt.getTime() > now
  if (inTrial && TIER_RANK[tier] < TIER_RANK[trialTier]) tier = trialTier

  // past_due / unpaid / canceled all keep their tier through the paid period + the configured grace
  // window (APP_CONFIG.subscription.gracePeriodDays) — a single failed charge shouldn't lock the
  // tenant out mid-month. After that the tier reads as FREE. No known period end => no paid coverage
  // to grace; fail closed to FREE. (Anchoring to `now` would push the deadline out every call.)
  if (
    org.subscriptionStatus === 'past_due' ||
    org.subscriptionStatus === 'unpaid' ||
    org.subscriptionStatus === 'canceled'
  ) {
    const graceMs = APP_CONFIG.subscription.gracePeriodDays * 24 * 60 * 60 * 1000
    const accessUntil = org.currentPeriodEnd ? org.currentPeriodEnd.getTime() + graceMs : 0
    if (accessUntil < now) tier = 'FREE'
  }

  return tier
}

/**
 * Resolve the org's EFFECTIVE tier (the entitlement the app reads) — the async db-reading wrapper
 * over effectiveTier(). Billing columns are synced onto `organization` by the webhook / IAP handlers.
 */
export async function resolveTier(db: DB, orgId: string): Promise<Tier> {
  const [org] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  if (!org) return 'FREE'
  return effectiveTier(org)
}

export async function requireTier(
  db: DB,
  orgId: string,
  minTier: 'STANDARD' | 'PREMIUM',
): Promise<EntitlementCheck> {
  const tier = await resolveTier(db, orgId)
  if (TIER_RANK[tier] >= TIER_RANK[minTier]) return { ok: true }
  return { ok: false, reason: `requires the ${minTier} plan (current: ${tier})` }
}

/** Gate a named feature by its required tier (FEATURE_TIERS — the per-app FREE/STANDARD/PREMIUM split). */
export async function requireFeature(
  db: DB,
  orgId: string,
  feature: GatedFeature,
): Promise<EntitlementCheck> {
  return requireTier(db, orgId, FEATURE_TIERS[feature])
}

export type AiQuota = { allowed: boolean; limit: number; used: number; tier: Tier }

/**
 * Per-user monthly AI quota for `feature` at the org's tier (AI_MONTHLY_LIMITS). Counts SUCCESSFUL
 * api_usage rows for this user + feature this calendar month — so the `feature` passed here MUST be
 * the same string the AI call logs to the ledger (worker/usage/log.ts). Call BEFORE running the
 * model; on `!allowed` return 402 with {limit, used} so the client can show the upgrade CTA. The
 * `ok=true` filter means a provider failure never burns a user's allowance.
 */
export async function checkAiQuota(
  db: DB,
  orgId: string,
  userId: string,
  feature: AiFeature,
): Promise<AiQuota> {
  const tier = await resolveTier(db, orgId)
  const limit = aiLimitFor(feature, tier)
  if (limit === Infinity) return { allowed: true, limit, used: 0, tier }
  if (limit <= 0) return { allowed: false, limit, used: 0, tier }

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [row] = await db
    .select({ n: count() })
    .from(schema.apiUsage)
    .where(
      and(
        eq(schema.apiUsage.userId, userId),
        eq(schema.apiUsage.feature, feature),
        eq(schema.apiUsage.ok, true),
        gte(schema.apiUsage.createdAt, monthStart),
      ),
    )
  const used = Number(row?.n ?? 0)
  return { allowed: used < limit, limit, used, tier }
}

/** The org's resolved billing cache, derived from its per-provider `subscription` rows. */
export type OrgEntitlement = {
  tier: Tier
  status: SubscriptionStatus | null
  currentPeriodEnd: Date | null
}

/** A subscription is "live access" while active/trialing, or past_due/unpaid/canceled but still inside
 *  its paid period + grace window. isLive MUST grace past_due/unpaid the SAME way effectiveTier does —
 *  otherwise resolveOrgEntitlement stamps the cache PREMIUM/past_due with a long-elapsed period while
 *  effectiveTier resolves the org to FREE, violating the documented "cache and resolved tier never
 *  disagree" invariant (past_due was previously treated as unconditionally live, and unpaid was missed). */
const ACTIVE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(['active', 'trialing'])

function isLive(status: SubscriptionStatus, periodEnd: Date | null): boolean {
  if (ACTIVE_STATUSES.has(status)) return true
  if (status === 'past_due' || status === 'unpaid' || status === 'canceled') {
    const graceMs = APP_CONFIG.subscription.gracePeriodDays * 24 * 60 * 60 * 1000
    // No known period end => no paid coverage to grace; fail closed (matches effectiveTier).
    const accessUntil = periodEnd ? periodEnd.getTime() + graceMs : 0
    return accessUntil >= Date.now()
  }
  return false
}

/**
 * The org's entitlement + WHO manages the winning live row. `provider` is the subscription.provider
 * TEXT of the highest live row — 'stripe' | 'apple' | 'google' today, but deliberately typed
 * `string | null` because provider is a vocabulary column ('comp' grant rows are sanctioned); the
 * client switches on the three knowns and treats anything else as "managed externally". null =
 * no live row (e.g. a bootstrap trial, which has no subscription row at all).
 */
export type OrgEntitlementDetail = OrgEntitlement & { provider: string | null }

/**
 * resolveOrgEntitlementDetail — resolveOrgEntitlement + the provider of the winning live row.
 * Powers GET /api/billing/summary's `managedBy` field (portal-vs-store manage UX: Stripe portal
 * for 'stripe', store subscription settings for 'apple'/'google'). resolveOrgEntitlement DELEGATES
 * here (the select just gains the provider column; the wrapper strips it) so the two resolutions
 * can never drift.
 */
export async function resolveOrgEntitlementDetail(db: DB, orgId: string): Promise<OrgEntitlementDetail> {
  const rows = await db
    .select({
      tier: schema.subscription.tier,
      status: schema.subscription.status,
      periodEnd: schema.subscription.periodEnd,
      provider: schema.subscription.provider,
    })
    .from(schema.subscription)
    .where(eq(schema.subscription.organizationId, orgId))

  let best: OrgEntitlementDetail = { tier: 'FREE', status: null, currentPeriodEnd: null, provider: null }
  for (const row of rows) {
    if (!isLive(row.status, row.periodEnd)) continue
    if (TIER_RANK[row.tier] > TIER_RANK[best.tier]) {
      best = { tier: row.tier, status: row.status, currentPeriodEnd: row.periodEnd, provider: row.provider }
    }
  }
  return best
}

/**
 * resolveOrgEntitlement — collapse ALL of an org's per-provider `subscription` rows (Stripe web +
 * Apple/Google IAP) into the single billing cache the org table holds. Takes the HIGHEST tier among
 * rows that still grant live access (active/trialing, or canceled-within-grace), so a tenant holding
 * both a web Stripe sub and a device IAP sub lands on the better of the two, and a downgrade only
 * drops the cache once NO live row outranks it. With no live row the org reads FREE.
 *
 * Both webhook handlers (routes/stripe.ts, routes/revenuecat.ts) call this AFTER writing their
 * provider row, then persist the result onto organization.{subscriptionTier,subscriptionStatus,
 * currentPeriodEnd} — the cache resolveTier()/the billing summary read.
 */
export async function resolveOrgEntitlement(db: DB, orgId: string): Promise<OrgEntitlement> {
  const { provider: _provider, ...entitlement } = await resolveOrgEntitlementDetail(db, orgId)
  return entitlement
}
