import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'

/**
 * Billing — the READ side of subscriptions, separate from routes/stripe.ts (which owns the
 * write side: checkout, portal, webhook sync). The client's subscription hook polls this to
 * decide what to render; the SERVER-side gate stays in worker/entitlements.ts (requireTier).
 *
 *   GET /api/billing/summary → { tier, status, trialEndsAt, currentPeriodEnd }
 *     Auth-gated; reflects the session's ACTIVE organization (billing is per-org, decision #9).
 *     Field shape is a contract with the client hook — do not rename.
 */
export const billingRoutes = new Hono<AuthEnv>()

billingRoutes.get('/summary', requireOrg, async (c) => {
  const orgId = c.get('orgId')

  const [org] = await getDb(c.env.DATABASE_URL)
    .select({
      tier: schema.organization.subscriptionTier,
      status: schema.organization.subscriptionStatus,
      trialEndsAt: schema.organization.trialEndsAt,
      currentPeriodEnd: schema.organization.currentPeriodEnd,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  if (!org) return c.json({ error: 'organization not found' }, 404)

  return c.json(org)
})
