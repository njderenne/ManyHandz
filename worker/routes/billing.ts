import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'
import { effectiveTier, resolveOrgEntitlementDetail } from '../entitlements'
import { composePlans } from '../billing/catalog'

/**
 * Billing — the READ side of subscriptions, separate from routes/stripe.ts (which owns the
 * write side: checkout, portal, webhook sync). The client's subscription hook polls this to
 * decide what to render; the SERVER-side gate stays in worker/entitlements.ts (requireTier).
 *
 *   GET /api/billing/summary → { tier, status, trialEndsAt, currentPeriodEnd, managedBy }
 *     Auth-gated; reflects the session's ACTIVE organization (billing is per-org, decision #9).
 *     `tier` is the EFFECTIVE tier (effectiveTier) — a live trial lifts to the configured trial
 *     tier and grace windows apply — so the client's useHasTier matches requireTier exactly (else
 *     premium UI hides from trial/grace orgs the server still honors). `managedBy` is the provider
 *     of the winning live subscription row (portal-vs-store manage UX); null = no live row (e.g.
 *     a bootstrap trial). Field shape is a contract with the client hook — no renames, additive only.
 *
 *   GET /api/billing/plans → PlansResponse (worker/billing/catalog.ts)
 *     PUBLIC — prices are public, and the payload is consumed pre-auth (web landing/paywall
 *     reachable signed-out) and by the Criterial admin. Composed LIVE, product-centric: every
 *     active recurring price on STRIPE_PRODUCT_<TIER> is a sellable frequency, with Product
 *     metadata (label/features) driving display copy — pricing + marketing copy change with NO
 *     app rebuild. Legacy STRIPE_PRICE_<TIER>[_YEARLY] vars are the fallback. Served through a
 *     60s per-isolate cache, so a Criterial price change propagates within TTL + isolate churn.
 *     Degradation: no STRIPE_SECRET_KEY → mode:null + empty sellable shells (client renders its
 *     config fallback copy, disabled CTAs) — never a crash, never fake prices.
 */
export const billingRoutes = new Hono<AuthEnv>()

billingRoutes.get('/summary', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)

  const [org] = await db
    .select({
      subscriptionTier: schema.organization.subscriptionTier,
      subscriptionStatus: schema.organization.subscriptionStatus,
      trialEndsAt: schema.organization.trialEndsAt,
      currentPeriodEnd: schema.organization.currentPeriodEnd,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  if (!org) return c.json({ error: 'organization not found' }, 404)

  // managedBy = the provider of the winning live subscription row. One extra indexed select per
  // summary poll — the accepted cost of the portal-vs-store manage UX (BILLING §7.5).
  const detail = await resolveOrgEntitlementDetail(db, orgId)

  return c.json({
    tier: effectiveTier(org),
    status: org.subscriptionStatus,
    trialEndsAt: org.trialEndsAt,
    currentPeriodEnd: org.currentPeriodEnd,
    managedBy: detail.provider,
  })
})

// PUBLIC by design — no requireOrg. Prices are public information; the paywall may render before
// sign-in and the static fallback path depends on this never 401ing.
billingRoutes.get('/plans', async (c) => {
  return c.json(await composePlans(c.env))
})
