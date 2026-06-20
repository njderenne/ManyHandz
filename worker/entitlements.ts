import { eq } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Entitlements — the server-side feature gate. Routes that sell a premium feature call
 * `requireTier` BEFORE doing the work; the client's subscription hook only hides buttons, it is
 * never the authorization (golden rule: the app layer authorizes, the UI just decorates).
 *
 * Tier ordering: FREE < STANDARD < PREMIUM. A `trialing` org whose trialEndsAt is still in the
 * future is treated as at-least-STANDARD, so trials unlock paid features without a Stripe
 * subscription row. Billing columns are synced onto `organization` by the Stripe webhook
 * (routes/stripe.ts) — this helper only reads.
 *
 *   const gate = await requireTier(db, orgId, 'PREMIUM')
 *   if (!gate.ok) return c.json({ error: gate.reason }, 402)
 */

const TIER_RANK = { FREE: 0, STANDARD: 1, PREMIUM: 2 } as const

export type Tier = keyof typeof TIER_RANK

export type EntitlementCheck = { ok: true } | { ok: false; reason: string }

export async function requireTier(
  db: DB,
  orgId: string,
  minTier: 'STANDARD' | 'PREMIUM',
): Promise<EntitlementCheck> {
  const [org] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  if (!org) return { ok: false, reason: 'organization not found' }

  let tier: Tier = org.subscriptionTier
  const inTrial =
    org.subscriptionStatus === 'trialing' &&
    org.trialEndsAt !== null &&
    org.trialEndsAt.getTime() > Date.now()
  if (inTrial && TIER_RANK[tier] < TIER_RANK.STANDARD) tier = 'STANDARD'

  // Canceled subscriptions keep their tier through the paid period + the configured grace
  // window (APP_CONFIG.subscription.gracePeriodDays) — after that the tier reads as FREE.
  if (org.subscriptionStatus === 'canceled') {
    const graceMs = APP_CONFIG.subscription.gracePeriodDays * 24 * 60 * 60 * 1000
    const accessUntil = org.currentPeriodEnd ? org.currentPeriodEnd.getTime() + graceMs : 0
    if (accessUntil < Date.now()) tier = 'FREE'
  }

  if (TIER_RANK[tier] >= TIER_RANK[minTier]) return { ok: true }
  return { ok: false, reason: `requires the ${minTier} plan (current: ${tier})` }
}
