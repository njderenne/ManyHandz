import { Hono } from 'hono'
import Stripe from 'stripe'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { LIFETIME_TIER } from '@/lib/config/monetization'
import { requireOrg, requireCapability, type AuthEnv } from '../middleware/org'
import { unlockAchievement } from '../achievements'
import { resolveOrgEntitlement } from '../entitlements'
import { stripeClient, STATUS, tierForPrice, classifyPrice } from '../billing/catalog'
import { checkoutTrialDays } from '../billing/trial'

/**
 * Stripe — checkout, billing portal, and the webhook that syncs subscription state onto the
 * `organization` table. Per decision #9, billing columns are written by Stripe webhooks via
 * Drizzle (never by Better-Auth), and billing is per-organization (the tenant). Checkout/portal
 * are gated by requireCapability('org:billing') — the capability matrix (roles.ts) grants it to
 * owner+admin on the default kind, byte-identical to the old requireRole gate, while custom
 * role-vocabulary kinds keep a working billing path (B-1). The webhook is verified by signature.
 *
 * Price→tier resolution, checkout validation, and trial math live in worker/billing/
 * {catalog,trial}.ts — the one Stripe brain — so this file and routes/billing.ts can't drift.
 *
 * Worker-safe: the fetch HTTP client + async signature verification via SubtleCrypto.
 */
export const stripeRoutes = new Hono<AuthEnv>()

/** current_period_end lives on the subscription item in Stripe's current API. */
const periodEnd = (sub: Stripe.Subscription) => {
  const ts = sub.items.data[0]?.current_period_end
  return ts ? new Date(ts * 1000) : null
}

// POST /api/stripe/checkout { priceId } — start a subscription (or the one-time Lifetime
// purchase) for the active org. Billing-capable members only: others can't commit the org to a
// paid plan.
stripeRoutes.post('/checkout', requireOrg, requireCapability('org:billing'), async (c) => {
  const orgId = c.get('orgId')

  // Honest degradation: no STRIPE_SECRET_KEY = billing not configured. An explicit 503 with a
  // machine-readable code — the old template constructed Stripe with '' and threw opaquely.
  const stripe = stripeClient(c.env)
  if (!stripe) {
    return c.json({ error: 'billing not configured', code: 'billing_not_configured' }, 503)
  }

  const { priceId } = await c.req.json<{ priceId?: string }>()
  if (!priceId) return c.json({ error: 'priceId is required' }, 400)

  // One-round-trip validation (catalog.ts): lifetime SKU → payment mode; an active recurring
  // price on a sellable tier product (or a legacy tier price id) → subscription mode; anything
  // else (a stale id, another account's price, an unsold tier) never reaches Stripe, where the
  // failure mode would be a confusing hosted-checkout error.
  const cls = await classifyPrice(stripe, c.env, priceId)
  if (cls.kind === 'unsellable') {
    // Loud log: if the worker-side product/price vars are unset/drifted from what the paywall
    // rendered, EVERY checkout 400s — make that diagnosable from `wrangler tail`.
    console.warn('checkout rejected: price not in a sellable tier', {
      priceId,
      productStandardSet: Boolean(c.env.STRIPE_PRODUCT_STANDARD),
      productPremiumSet: Boolean(c.env.STRIPE_PRODUCT_PREMIUM),
      priceStandardSet: Boolean(c.env.STRIPE_PRICE_STANDARD),
      pricePremiumSet: Boolean(c.env.STRIPE_PRICE_PREMIUM),
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

  const common = {
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // Land on the web app root — /billing doesn't exist in the template; a minted app with a
    // billing screen should point these there (builder/MINT.md §8).
    success_url: `${c.env.BETTER_AUTH_URL}/?checkout=success`,
    cancel_url: `${c.env.BETTER_AUTH_URL}/?checkout=cancelled`,
    metadata: { organizationId: org.id },
  } satisfies Partial<Stripe.Checkout.SessionCreateParams>

  let checkout: Stripe.Checkout.Session
  if (cls.kind === 'lifetime') {
    // One-time Lifetime: mode 'payment'. The grant is written by the checkout.session.completed
    // handler below (subscription webhooks never fire for a one-time purchase).
    // payment_intent_data.metadata carries the org id + the lifetime flag through.
    checkout = await stripe.checkout.sessions.create({
      ...common,
      mode: 'payment',
      payment_intent_data: { metadata: { organizationId: org.id, lifetime: 'true', priceId } },
    })
  } else {
    // Recurring: trial days per the ratified rule (worker/billing/trial.ts — remaining-days →
    // full-days → hasEverSubscribed guard → interval clamp). NO org-column stamp here: a Stripe
    // checkout trial flows back through the webhook as a live `trialing` provider row.
    const trial = await checkoutTrialDays(db, org, cls.price)
    checkout = await stripe.checkout.sessions.create({
      ...common,
      mode: 'subscription',
      subscription_data: {
        metadata: { organizationId: org.id },
        ...(trial > 0 ? { trial_period_days: trial } : {}),
      },
    })
  }
  return c.json({ url: checkout.url })
})

// POST /api/stripe/portal — open the Stripe billing portal for the active org.
// Billing-capable like /checkout: the portal can cancel or change the org's plan.
stripeRoutes.post('/portal', requireOrg, requireCapability('org:billing'), async (c) => {
  const orgId = c.get('orgId')

  const stripe = stripeClient(c.env)
  if (!stripe) {
    return c.json({ error: 'billing not configured', code: 'billing_not_configured' }, 503)
  }

  const db = getDb(c.env.DATABASE_URL)
  const [org] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  if (!org?.stripeCustomerId) return c.json({ error: 'no billing account' }, 400)

  const portal = await stripe.billingPortal.sessions.create({
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

  // A webhook delivery with no API key configured is an operator misconfiguration (checkouts
  // can't have happened from THIS worker) — 503 so Stripe retries after the env is fixed rather
  // than acking an event we can't fully process (grantLifetime needs the API).
  const stripe = stripeClient(c.env)
  if (!stripe) {
    return c.json({ error: 'billing not configured', code: 'billing_not_configured' }, 503)
  }

  const body = await c.req.text()
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

  /** Resolve the org this Stripe subscription belongs to (metadata first, then the customer id). */
  const orgIdFor = async (sub: Stripe.Subscription): Promise<string | undefined> => {
    if (sub.metadata?.organizationId) return sub.metadata.organizationId
    const [org] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.stripeCustomerId, sub.customer as string))
      .limit(1)
    return org?.id
  }

  /** Resolve an org by Stripe customer id alone (invoice events carry no metadata). */
  const orgIdForCustomer = async (customer: string): Promise<string | undefined> => {
    const [org] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.stripeCustomerId, customer))
      .limit(1)
    return org?.id
  }

  /** Recompute the org's billing cache from ALL its subscription rows (Stripe + IAP) and persist
   *  it — the single resolution path shared with the RevenueCat webhook (routes/revenuecat.ts). */
  const syncOrgCache = async (orgId: string) => {
    const resolved = await resolveOrgEntitlement(db, orgId)
    await db
      .update(schema.organization)
      .set({
        subscriptionTier: resolved.tier,
        subscriptionStatus: resolved.status,
        currentPeriodEnd: resolved.currentPeriodEnd,
      })
      .where(eq(schema.organization.id, orgId))
  }

  /** 'supporter' achievement for the org OWNER. unlockAchievement is idempotent (unique
   *  org/user/key) and never throws, so calling it on every qualifying event is safe — only the
   *  first insert lands and notifies. Skips silently when the org/owner can't be resolved. */
  const unlockSupporter = async (orgId: string) => {
    const [owner] = await db
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.role, 'owner')))
      .limit(1)
    if (owner) {
      await unlockAchievement(db, c.env, {
        organizationId: orgId,
        userId: owner.userId,
        achievementKey: 'supporter',
      })
    }
  }

  const sync = async (sub: Stripe.Subscription) => {
    const status = STATUS[sub.status] ?? null
    // The price OBJECT (not the id): tierForPrice resolves product-centric first, legacy price id
    // second — identical to checkout validation, straight off the event payload (no API call).
    const price = sub.items.data[0]?.price
    const tier = tierForPrice(c.env, price)
    const resolvedOrgId = await orgIdFor(sub)

    // Keep stripeSubscriptionId on the org (checkout/portal read it) regardless of cache outcome.
    await db
      .update(schema.organization)
      .set({ stripeSubscriptionId: sub.id })
      .where(
        resolvedOrgId
          ? eq(schema.organization.id, resolvedOrgId)
          : eq(schema.organization.stripeCustomerId, sub.customer as string),
      )

    // Write the per-provider truth row (provider 'stripe', externalId = sub.id) so the shared
    // resolver sees the web subscription alongside any native IAP rows; then recompute the cache.
    if (resolvedOrgId && status) {
      const productId = price?.id ?? 'unknown'
      // Row-level trial observability: Stripe's own trial window for THIS sub. The org-level
      // trialEndsAt stamp (the in-app trial) is NEVER touched by webhooks.
      const rowTrialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null
      // tierForPrice falls through to FREE for any price not matching a product OR legacy price
      // var. If the sub is live/paid but tier resolved FREE, the env drifted from what checkout
      // used: writing FREE would silently deny a paying customer AND clobber a previously-correct
      // row. Log loudly (mirrors the checkout-side guard, including the product-var state) and
      // SKIP the write — a genuine cancellation/expiry has a non-live status and still persists
      // FREE through the normal path.
      //
      // The live set matches isLive()'s grace class (BILLING_SPEC §2): past_due AND 'unpaid' are
      // both still-in-grace states — Stripe moves past_due → unpaid after retries exhaust, and an
      // unpaid sub inside currentPeriodEnd + gracePeriodDays is honored as live. Guarding only
      // past_due would let an unpaid-in-grace sub with a drifted price be clobbered to FREE
      // mid-grace, silently denying a customer whose window the spec says to honor. 'canceled' is
      // deliberately excluded — a real cancellation must be allowed to persist FREE.
      const liveStatus =
        status === 'active' || status === 'trialing' || status === 'past_due' || status === 'unpaid'
      if (liveStatus && tier === 'FREE') {
        console.warn('stripe sync: live subscription with unknown priceId — skipping FREE downgrade', {
          subscriptionId: sub.id,
          priceId: productId,
          organizationId: resolvedOrgId,
          status,
          standardSet: Boolean(c.env.STRIPE_PRICE_STANDARD),
          premiumSet: Boolean(c.env.STRIPE_PRICE_PREMIUM),
          productStandardSet: Boolean(c.env.STRIPE_PRODUCT_STANDARD),
          productPremiumSet: Boolean(c.env.STRIPE_PRODUCT_PREMIUM),
        })
      } else {
        await db
          .insert(schema.subscription)
          .values({
            organizationId: resolvedOrgId,
            provider: 'stripe',
            productId,
            tier,
            status,
            externalId: sub.id,
            periodEnd: periodEnd(sub),
            trialEndsAt: rowTrialEndsAt,
          })
          .onConflictDoUpdate({
            target: [schema.subscription.provider, schema.subscription.externalId],
            set: { tier, status, productId, periodEnd: periodEnd(sub), trialEndsAt: rowTrialEndsAt },
          })
        await syncOrgCache(resolvedOrgId)
      }
    }

    // tier !== 'FREE' mirrors the skip above — don't grant the supporter achievement off a live
    // sub whose price we couldn't resolve (entitlement unconfirmed).
    if (status === 'active' && resolvedOrgId && tier !== 'FREE') {
      await unlockSupporter(resolvedOrgId)
    }
  }

  /**
   * One-time Lifetime grant — fired by checkout.session.completed (mode 'payment'), since a
   * one-time purchase produces NO customer.subscription.* events. Writes a provider 'stripe'
   * subscription row with tier LIFETIME_TIER (config) and a NULL periodEnd: resolveOrgEntitlement
   * treats an active row with no period end as live FOREVER, so this reads as a permanent grant.
   * Idempotent on (provider, externalId = the payment intent id); recomputes the org cache after.
   *
   * REQUIRED: piMeta.lifetime === 'true'. Payment-mode checkout is only the lifetime flow TODAY —
   * requiring the flag means some future payment-mode use (credits top-up, one-off invoice) can
   * never silently grant a permanent tier. The PI retrieve is NOT swallowed: a transient failure
   * propagates to the outer catch, which releases the ledger claim so Stripe retries the event.
   */
  const grantLifetime = async (session: Stripe.Checkout.Session) => {
    const piId =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
    if (!piId) {
      console.warn('payment-mode session ignored: no payment intent', { session: session.id })
      return
    }
    const piMeta = (await stripe.paymentIntents.retrieve(piId)).metadata
    if (piMeta?.lifetime !== 'true') {
      console.warn('payment-mode session ignored: not a lifetime purchase', { session: session.id })
      return
    }

    const orgId =
      piMeta.organizationId ||
      session.metadata?.organizationId ||
      (
        await db
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(eq(schema.organization.stripeCustomerId, session.customer as string))
          .limit(1)
      )[0]?.id
    if (!orgId) {
      console.warn('lifetime grant skipped: no org for session', { session: session.id })
      return
    }

    const productId = c.env.STRIPE_PRICE_LIFETIME ?? piMeta.priceId ?? 'lifetime'
    await db
      .insert(schema.subscription)
      .values({
        organizationId: orgId,
        provider: 'stripe',
        productId,
        tier: LIFETIME_TIER,
        status: 'active',
        externalId: piId, // stable per purchase — replays upsert the same row
        periodEnd: null, // null + active = live forever (the lifetime mechanism)
        metadata: { lifetime: true, sessionId: session.id },
      })
      .onConflictDoNothing({
        target: [schema.subscription.provider, schema.subscription.externalId],
      })
    await syncOrgCache(orgId)
    await unlockSupporter(orgId)
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
      case 'checkout.session.completed': {
        // ONLY the one-time Lifetime purchase needs handling here — subscription-mode sessions
        // are covered by customer.subscription.* (which carry the recurring period + status).
        const session = event.data.object
        if (session.mode === 'payment' && session.payment_status === 'paid') {
          await grantLifetime(session)
        }
        break
      }
      case 'customer.subscription.deleted': {
        const deleted = event.data.object
        // Mark the per-provider row canceled (keep its periodEnd): resolveOrgEntitlement honors a
        // canceled sub through currentPeriodEnd + gracePeriodDays (APP_CONFIG.subscription), so
        // access winds down gracefully instead of cutting off mid-period the user already paid for.
        // Recomputing the cache (rather than forcing the org to 'canceled') means a live native IAP
        // sub on the SAME org keeps the tenant entitled when only the web sub ends.
        await db
          .update(schema.subscription)
          .set({ status: 'canceled', periodEnd: periodEnd(deleted), canceledAt: new Date() })
          .where(
            and(eq(schema.subscription.provider, 'stripe'), eq(schema.subscription.externalId, deleted.id)),
          )
        const orgId = await orgIdFor(deleted)
        if (orgId) {
          await db
            .update(schema.organization)
            .set({ stripeSubscriptionId: null })
            .where(eq(schema.organization.id, orgId))
          await syncOrgCache(orgId)
        } else {
          // No org row resolved (customer never finished checkout) — clear the dangling sub id +
          // mark the cache canceled directly (no per-provider row to recompute from).
          await db
            .update(schema.organization)
            .set({ subscriptionStatus: 'canceled', stripeSubscriptionId: null, currentPeriodEnd: periodEnd(deleted) })
            .where(eq(schema.organization.stripeCustomerId, deleted.customer as string))
        }
        break
      }
      // Dunning: a failed charge flips the org's stripe sub row to past_due (entitlements keep the
      // tier through the grace window); a recovered charge restores active. subscription.updated
      // also covers these, but reacting to the invoice events is faster + explicit. Both mutate the
      // per-provider stripe `subscription` row(s), then recompute the shared org cache — so a live
      // native IAP sub on the SAME org is never clobbered, only the stripe row moves.
      case 'invoice.payment_failed': {
        const customer = event.data.object.customer as string
        const orgId = await orgIdForCustomer(customer)
        if (orgId) {
          await db
            .update(schema.subscription)
            .set({ status: 'past_due' })
            .where(
              and(
                eq(schema.subscription.organizationId, orgId),
                eq(schema.subscription.provider, 'stripe'),
                inArray(schema.subscription.status, ['active', 'trialing']),
              ),
            )
          await syncOrgCache(orgId)
        }
        break
      }
      case 'invoice.payment_succeeded': {
        // Only a RECOVERY (past_due/unpaid → active); a normal renewal is already active/trialing,
        // and subscription.updated owns the tier. Scoped to the lapsed states so it never clobbers
        // an active tier (nor a deliberately canceled sub winding down through its grace window).
        const customer = event.data.object.customer as string
        const orgId = await orgIdForCustomer(customer)
        if (orgId) {
          await db
            .update(schema.subscription)
            .set({ status: 'active' })
            .where(
              and(
                eq(schema.subscription.organizationId, orgId),
                eq(schema.subscription.provider, 'stripe'),
                inArray(schema.subscription.status, ['past_due', 'unpaid']),
              ),
            )
          await syncOrgCache(orgId)
        }
        break
      }
      default:
        break
    }
  } catch (e) {
    await db.delete(schema.webhookEvent).where(eq(schema.webhookEvent.id, claimed[0].id))
    throw e
  }

  return c.json({ received: true })
})
