import { and, eq, isNull } from 'drizzle-orm'
import type Stripe from 'stripe'
import { schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { TRIAL_ON_ORG_CREATE } from '@/lib/config/monetization'
import { periodDays } from './catalog'

/**
 * Trial bootstrap + checkout-trial math (BILLING_SPEC §7.3).
 *
 * The trial model: an in-app trial is org columns ONLY — `subscriptionStatus: 'trialing'` +
 * `trialEndsAt`, no `subscription` row. effectiveTier (worker/entitlements.ts) lifts the org to
 * APP_CONFIG.subscription.trialTier while trialEndsAt is in the future, keyed on trialEndsAt
 * ALONE (webhooks recompute and null the status, which would destroy a status-gated lift).
 *
 * THE ratified checkout rule: NO org-column stamp at checkout-session-creation time (rejected —
 * it burns trial eligibility on an abandoned checkout AND grants a card-free entitlement lift to
 * someone who merely clicked Subscribe). A Stripe checkout trial instead flows back through the
 * webhook as a live `trialing` provider row — no special casing anywhere.
 */

/**
 * Column fragment for org INSERTs (worker/provision-user.ts personal-org path). Spread into the
 * insert: `...trialBootstrapFields()`. Empty when trials are off (trialDays 0) or
 * trialOnOrgCreate === 'none' — 'personal' and 'all' both stamp the auto-provisioned personal org.
 */
export function trialBootstrapFields():
  | { subscriptionStatus: 'trialing'; trialEndsAt: Date }
  | Record<string, never> {
  const trialDays = APP_CONFIG.subscription.trialDays
  if (trialDays > 0 && TRIAL_ON_ORG_CREATE !== 'none') {
    return {
      subscriptionStatus: 'trialing',
      trialEndsAt: new Date(Date.now() + trialDays * 86_400_000),
    }
  }
  return {}
}

/**
 * UPDATE path for the Better-Auth afterCreateOrganization hook (team orgs — worker/auth.ts wires
 * it). No-op unless trialOnOrgCreate === 'all' && trialDays > 0 ('personal' means team orgs get
 * their trial as a card-required Stripe checkout trial instead). Idempotent: stamps only when
 * trialEndsAt IS NULL, so a replayed hook (or a pre-stamped org) never extends a trial.
 */
export async function bootstrapTrial(db: DB, orgId: string): Promise<void> {
  if (TRIAL_ON_ORG_CREATE !== 'all') return
  const trialDays = APP_CONFIG.subscription.trialDays
  if (trialDays <= 0) return
  await db
    .update(schema.organization)
    .set({
      subscriptionStatus: 'trialing',
      trialEndsAt: new Date(Date.now() + trialDays * 86_400_000),
    })
    .where(and(eq(schema.organization.id, orgId), isNull(schema.organization.trialEndsAt)))
}

/**
 * ANY prior subscription row for this org — any provider, any status. A customer is a customer:
 * lifetime rows and `legacy-backfill` rows count DELIBERATELY (BILLING §12.2 sign-off — a churned
 * legacy org cannot cancel-and-recheckout into a fresh trial).
 */
export async function hasEverSubscribed(db: DB, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.subscription.id })
    .from(schema.subscription)
    .where(eq(schema.subscription.organizationId, orgId))
    .limit(1)
  return rows.length > 0
}

/**
 * Trial days to grant at Stripe checkout (`subscription_data.trial_period_days`) — the ratified
 * four-step rule:
 *
 *   1. no-double-dip via trialEndsAt: org.trialEndsAt set → ceil(days remaining), floored at 0
 *      (a live in-app trial converts to a Stripe trial that ends when it would have; an expired
 *      trial grants none — they've had it).
 *   2. untrialed org (trialEndsAt null — trialOnOrgCreate 'none'/'personal' team orgs, or
 *      pre-bootstrap legacy orgs) → the full configured trialDays.
 *   3. no-retrial across cancel-and-recheckout (fleet-first's guard): days > 0 &&
 *      hasEverSubscribed → 0. Closes the fresh-trial hole for orgs whose trialEndsAt is null but
 *      who already were customers.
 *   4. interval-aware clamp (§12.1 sign-off flag — ManyHandz weekly plans): pd = periodDays(price);
 *      pd !== null && pd < 28 → days = min(days, pd). A 14-day trial on a weekly price bills $0
 *      for two cycles and then surprises; monthly/yearly prices keep the full configured trial.
 *
 * Stripe requires trial_period_days ≥ 1 — the Math.ceil + the caller's (days > 0) spread already
 * guarantee it (routes/stripe.ts only passes the param when the result is positive).
 */
export async function checkoutTrialDays(
  db: DB,
  org: { id: string; trialEndsAt: Date | null },
  price: Stripe.Price,
): Promise<number> {
  const trialDays = APP_CONFIG.subscription.trialDays
  let days = org.trialEndsAt
    ? Math.max(0, Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : trialDays
  if (days > 0 && (await hasEverSubscribed(db, org.id))) days = 0
  const pd = periodDays(price)
  if (pd !== null && pd < 28) days = Math.min(days, pd)
  return days
}
