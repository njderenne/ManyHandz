import { Hono } from 'hono'
import Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, requireRole, type AuthEnv } from '../middleware/org'
import { unlockAchievement } from '../achievements'
import type { Env } from '../env'

/**
 * Stripe — checkout, billing portal, and the webhook that syncs subscription state onto the
 * `organization` table. Per decision #9, billing columns are written by Stripe webhooks via
 * Drizzle (never by Better-Auth), and billing is per-organization (the tenant). Checkout/portal
 * are owner/admin-only; the webhook is verified by signature instead.
 *
 * Worker-safe: the fetch HTTP client + async signature verification via SubtleCrypto.
 */
export const stripeRoutes = new Hono<AuthEnv>()

const client = (env: Env) =>
  new Stripe(env.STRIPE_SECRET_KEY ?? '', { httpClient: Stripe.createFetchHttpClient() })

/** Coerce Stripe's status set to our enum (incomplete/paused → null). */
const STATUS: Record<string, 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'unpaid',
}

/** Map a Stripe price → our subscription tier (configured via env price IDs). */
function tierForPrice(env: Env, priceId?: string) {
  if (priceId && priceId === env.STRIPE_PRICE_PREMIUM) return 'PREMIUM' as const
  if (priceId && priceId === env.STRIPE_PRICE_STANDARD) return 'STANDARD' as const
  return 'FREE' as const
}

/** current_period_end lives on the subscription item in Stripe's current API. */
const periodEnd = (sub: Stripe.Subscription) => {
  const ts = sub.items.data[0]?.current_period_end
  return ts ? new Date(ts * 1000) : null
}

// POST /api/stripe/checkout { priceId } — start a subscription for the active org.
// Billing is admin-only: members can't commit the org to a paid plan.
stripeRoutes.post('/checkout', requireOrg, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('orgId')

  const { priceId } = await c.req.json<{ priceId?: string }>()
  if (!priceId) return c.json({ error: 'priceId is required' }, 400)
  // Only the two prices we sell — anything else (a stale id, another account's price) never
  // reaches Stripe, where the failure mode would be a confusing checkout error.
  if (priceId !== c.env.STRIPE_PRICE_STANDARD && priceId !== c.env.STRIPE_PRICE_PREMIUM) {
    // Loud log: if the worker-side price vars are unset/drifted from the client's
    // EXPO_PUBLIC_STRIPE_PRICE_*, EVERY checkout 400s — make that diagnosable.
    console.warn('checkout rejected: unknown priceId', {
      standardSet: Boolean(c.env.STRIPE_PRICE_STANDARD),
      premiumSet: Boolean(c.env.STRIPE_PRICE_PREMIUM),
    })
    return c.json({ error: 'unknown priceId' }, 400)
  }

  const db = getDb(c.env.DATABASE_URL)
  const [org] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  if (!org) return c.json({ error: 'organization not found' }, 404)

  const stripe = client(c.env)

  // Ensure the org has a Stripe customer (created once, stored on the org).
  let customerId = org.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      metadata: { organizationId: org.id },
    })
    customerId = customer.id
    await db
      .update(schema.organization)
      .set({ stripeCustomerId: customerId })
      .where(eq(schema.organization.id, org.id))
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // Land on the web app root — /billing doesn't exist in the template; a minted app with a
    // billing screen should point these there (builder/MINT.md §8).
    success_url: `${c.env.BETTER_AUTH_URL}/?checkout=success`,
    cancel_url: `${c.env.BETTER_AUTH_URL}/?checkout=cancelled`,
    subscription_data: { metadata: { organizationId: org.id } },
    metadata: { organizationId: org.id },
  })
  return c.json({ url: checkout.url })
})

// POST /api/stripe/portal — open the Stripe billing portal for the active org.
// Admin-only like /checkout: the portal can cancel or change the org's plan.
stripeRoutes.post('/portal', requireOrg, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('orgId')

  const db = getDb(c.env.DATABASE_URL)
  const [org] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  if (!org?.stripeCustomerId) return c.json({ error: 'no billing account' }, 400)

  const portal = await client(c.env).billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${c.env.BETTER_AUTH_URL}/billing`,
  })
  return c.json({ url: portal.url })
})

// POST /api/stripe/webhook — Stripe → us. Verify the signature, then sync billing columns.
stripeRoutes.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature')
  const secret = c.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) return c.json({ error: 'missing signature' }, 400)

  const body = await c.req.text()
  const stripe = client(c.env)
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch {
    return c.json({ error: 'invalid signature' }, 400)
  }

  const db = getDb(c.env.DATABASE_URL)

  // Idempotency: Stripe RETRIES deliveries. Record each event id once; a replay inserts nothing
  // and is acknowledged without re-applying (the standard webhook_event ledger pattern).
  const claimed = await db
    .insert(schema.webhookEvent)
    .values({ provider: 'stripe', eventId: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvent.id })
  if (!claimed.length) return c.json({ received: true, duplicate: true })

  const sync = async (sub: Stripe.Subscription) => {
    const values = {
      stripeSubscriptionId: sub.id,
      subscriptionStatus: STATUS[sub.status] ?? null,
      subscriptionTier: tierForPrice(c.env, sub.items.data[0]?.price.id),
      currentPeriodEnd: periodEnd(sub),
    }
    const orgId = sub.metadata?.organizationId
    await db
      .update(schema.organization)
      .set(values)
      .where(
        orgId
          ? eq(schema.organization.id, orgId)
          : eq(schema.organization.stripeCustomerId, sub.customer as string),
      )

    // 'supporter' achievement for the org OWNER on an active subscription. No prior-status read
    // needed: unlockAchievement is idempotent (unique org/user/key), so calling it on EVERY
    // active sync is safe — only the first insert lands and notifies; it also never throws, so
    // the webhook ack can't fail on it. Skips silently when the org/owner can't be resolved.
    if (values.subscriptionStatus === 'active') {
      let resolvedOrgId = orgId
      if (!resolvedOrgId) {
        const [org] = await db
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(eq(schema.organization.stripeCustomerId, sub.customer as string))
          .limit(1)
        resolvedOrgId = org?.id
      }
      if (resolvedOrgId) {
        const [owner] = await db
          .select({ userId: schema.member.userId })
          .from(schema.member)
          .where(
            and(eq(schema.member.organizationId, resolvedOrgId), eq(schema.member.role, 'owner')),
          )
          .limit(1)
        if (owner) {
          await unlockAchievement(db, c.env, {
            organizationId: resolvedOrgId,
            userId: owner.userId,
            achievementKey: 'supporter',
          })
        }
      }
    }
  }

  // The ledger row is claimed BEFORE processing, and the Neon HTTP driver has no transactions —
  // so a failure below would otherwise leave the claim in place and Stripe's retry would hit the
  // duplicate fast-path, losing the state change forever (fatal for subscription.deleted, which
  // no later event re-sends). Compensate instead: release the claim, then rethrow so the global
  // onError returns 500 and Stripe retries the event cleanly.
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await sync(event.data.object)
        break
      case 'customer.subscription.deleted':
        // Keep the tier and the period end: entitlements honor a canceled subscription through
        // currentPeriodEnd + gracePeriodDays (APP_CONFIG.subscription), so access winds down
        // gracefully instead of cutting off mid-period the user already paid for.
        await db
          .update(schema.organization)
          .set({
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
            currentPeriodEnd: periodEnd(event.data.object),
          })
          .where(eq(schema.organization.stripeCustomerId, event.data.object.customer as string))
        break
      default:
        break
    }
  } catch (e) {
    await db.delete(schema.webhookEvent).where(eq(schema.webhookEvent.id, claimed[0].id))
    throw e
  }

  return c.json({ received: true })
})
