import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { resolveOrgEntitlement } from '../entitlements'
import { resolveBillingOrgId } from '../billing/resolve-org'
import { unlockAchievement } from '../achievements'
import { notify } from '../notify'
import { iapTierForProduct } from '@/lib/config/entitlements'
import type { Env } from '../env'

/**
 * RevenueCat — the NATIVE billing webhook. Apple rejects in-app Stripe for digital goods (3.1.1),
 * so iOS/Android purchases go through StoreKit / Play Billing via RevenueCat; web keeps Stripe
 * (routes/stripe.ts). RevenueCat POSTs a server-to-server event here; this mirrors the Stripe
 * webhook exactly where it matters:
 *
 *   - Idempotency: a `webhook_event` row (provider 'revenuecat', eventId = event.id) inserted with
 *     onConflictDoNothing — a replay inserts nothing and is acked without re-applying.
 *   - Per-provider truth: the event writes an apple/google `subscription` row (NOT the org columns
 *     directly), keyed off (provider, externalId).
 *   - Org cache: resolveOrgEntitlement() then collapses ALL of the org's rows (Stripe + IAP) onto
 *     the organization billing columns the app reads — taking the HIGHEST live entitlement.
 *
 * Auth: there is no signature to verify (unlike Stripe). RevenueCat sends a shared secret in the
 * Authorization header; we compare it to env.REVENUECAT_WEBHOOK_AUTH (401 otherwise). The route is
 * mounted WITHOUT the org-auth middleware for this reason — it authenticates on the header alone.
 *
 * app_user_id mapping: the client sets the RevenueCat App User ID to the Better-Auth USER id (see
 * src/lib/billing/purchases.ts → configurePurchases). So app_user_id IS our user id — entitlements
 * are per-ORG, but a store receipt belongs to a PERSON, so resolveBillingOrgId (../billing/
 * resolve-org.ts) maps user → org TENANCY-POSTURE-AWARE: an existing (provider, externalId) row's
 * org first (renewals stay sticky), then the personal org for solo-first apps
 * (tenant.autoPersonalOrg=true), then — team-first apps like ManyHandz, where personal orgs never
 * exist — the buyer's active-session household, else their earliest org:billing-capable membership.
 *
 * Per-app: the product/entitlement → tier mapping lives in src/lib/config/entitlements.ts
 * (IAP_PRODUCT_TIERS / IAP_ENTITLEMENT_TIERS) so device + server never disagree. Until a minted app
 * fills that map, every event resolves to "unknown product" and is acked without granting.
 *
 * LIFETIME via IAP already works here with NO code change (BILLING_SPEC §7.6): a one-time store
 * purchase arrives as NON_RENEWING_PURCHASE → status 'active' with no expiration_at_ms →
 * periodEnd null → resolveOrgEntitlement treats the row as live FOREVER (the same mechanism as
 * Stripe's payment-mode lifetime grant). A minted app maps its store lifetime SKU in
 * IAP_PRODUCT_TIERS (e.g. `lifetime: 'PREMIUM'`) and is done.
 */
export const revenuecatRoutes = new Hono<{ Bindings: Env }>()

/** RevenueCat event shape — only the fields we read (the payload carries many more). */
type RevenueCatEvent = {
  id?: string
  type?: string
  app_user_id?: string
  /** RevenueCat also sends aliases; original_app_user_id is the canonical id when present. */
  original_app_user_id?: string
  product_id?: string
  entitlement_id?: string | null
  entitlement_ids?: string[] | null
  store?: string // 'APP_STORE' | 'PLAY_STORE' | 'STRIPE' | 'MAC_APP_STORE' | …
  original_transaction_id?: string
  transaction_id?: string
  purchased_at_ms?: number
  expiration_at_ms?: number | null
  period_type?: string // 'NORMAL' | 'TRIAL' | 'INTRO' | …
}

type SubscriptionStatus = (typeof schema.subscriptionStatusEnum.enumValues)[number]

/** Resolve the tier this event grants: product id first, then any entitlement id, else null. */
function tierForEvent(event: RevenueCatEvent) {
  const ents = event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : [])
  return iapTierForProduct(event.product_id, ents)
}

/** Map the RevenueCat store to our `subscription.provider` value ('apple' | 'google'). */
function providerForStore(store?: string): 'apple' | 'google' {
  return store === 'PLAY_STORE' ? 'google' : 'apple'
}

/**
 * Map the event type to a subscription status.
 *   - Purchases/renewals/changes/uncancellations → 'active'.
 *   - CANCELLATION is the user turning OFF auto-renew; they keep access until expiration, so it
 *     reads 'canceled' (the grace-aware wind-down in resolveOrgEntitlement honors periodEnd).
 *   - EXPIRATION → 'canceled' as well (access already lapsed; periodEnd is in the past, so
 *     resolveOrgEntitlement drops it from the live set). BILLING_ISSUE → 'past_due' (still live).
 * Returns null for event types we don't act on (e.g. TEST, TRANSFER, SUBSCRIBER_ALIAS).
 */
const TYPE_STATUS: Record<string, SubscriptionStatus> = {
  INITIAL_PURCHASE: 'active',
  RENEWAL: 'active',
  PRODUCT_CHANGE: 'active',
  UNCANCELLATION: 'active',
  NON_RENEWING_PURCHASE: 'active', // lifetime / consumable grant
  CANCELLATION: 'canceled',
  EXPIRATION: 'canceled',
  BILLING_ISSUE: 'past_due',
}

// POST /api/revenuecat/webhook — RevenueCat → us. Header-auth, idempotent, writes an IAP
// subscription row + recomputes the org's billing cache.
revenuecatRoutes.post('/webhook', async (c) => {
  const expected = c.env.REVENUECAT_WEBHOOK_AUTH
  // No configured secret = the webhook is not wired up; reject rather than accept unauthenticated
  // billing mutations. (Mirrors Stripe's "missing signature" 400 stance, but unauthorized = 401.)
  if (!expected) return c.json({ error: 'revenuecat webhook not configured' }, 401)
  if (c.req.header('authorization') !== expected) return c.json({ error: 'unauthorized' }, 401)

  const payload = await c.req.json<{ event?: RevenueCatEvent }>().catch(() => null)
  const event = payload?.event
  if (!event?.id || !event.type) return c.json({ error: 'invalid payload' }, 400)

  const db = getDb(c.env.DATABASE_URL)

  // Idempotency: RevenueCat RETRIES deliveries. Record each event id once; a replay inserts nothing
  // and is acknowledged without re-applying (the same webhook_event ledger pattern as Stripe).
  const claimed = await db
    .insert(schema.webhookEvent)
    .values({ provider: 'revenuecat', eventId: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvent.id })
  if (!claimed.length) return c.json({ received: true, duplicate: true })

  // Everything below mutates billing — on ANY failure release the claim and rethrow so the global
  // onError returns 500 and RevenueCat retries cleanly (no transactions on the Neon HTTP driver).
  try {
    const status = TYPE_STATUS[event.type]
    if (!status) return c.json({ received: true, ignored: event.type })

    const userId = event.app_user_id || event.original_app_user_id
    if (!userId) return c.json({ received: true, ignored: 'no app_user_id' })

    const tier = tierForEvent(event)
    if (!tier) {
      // Unknown product/entitlement — log loudly (IAP_PRODUCT_TIERS has drifted from the dashboard,
      // or the minted app hasn't filled it yet) and ack so RevenueCat stops retrying.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'revenuecat.unknown_product',
          type: event.type,
          productId: event.product_id ?? null,
          entitlementIds: event.entitlement_ids ?? null,
        }),
      )
      return c.json({ received: true, ignored: 'unknown product/entitlement' })
    }

    const provider = providerForStore(event.store)
    // externalId = the Apple original_transaction_id / Play purchase token — STABLE across renewals,
    // so renewals UPDATE the one row instead of inserting a new one (transaction_id is the fallback
    // for one-time/non-renewing purchases that have no original transaction).
    const externalId = event.original_transaction_id || event.transaction_id
    if (!externalId) return c.json({ received: true, ignored: 'no transaction id' })

    // Resolve the org the purchase attaches to — tenancy-posture aware (../billing/resolve-org.ts:
    // sticky existing row → personal org when autoPersonalOrg → active-session household →
    // earliest org:billing-capable membership). ManyHandz is team-first: personal orgs never
    // exist, so the household ladder is the live path.
    const orgId = await resolveBillingOrgId(db, userId, provider, externalId)
    if (!orgId) {
      console.warn(
        JSON.stringify({ level: 'warn', event: 'revenuecat.no_billing_org', userId, type: event.type }),
      )
      return c.json({ received: true, ignored: 'no billing org' })
    }

    const periodEnd = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null
    const periodStart = event.purchased_at_ms ? new Date(event.purchased_at_ms) : null
    const trialEndsAt = event.period_type === 'TRIAL' && periodEnd ? periodEnd : null
    const metadata = { store: event.store ?? null, periodType: event.period_type ?? null, eventType: event.type }

    // Write/refresh the per-provider row, keyed on (provider, externalId) — the unique index.
    await db
      .insert(schema.subscription)
      .values({
        organizationId: orgId,
        purchaserUserId: userId,
        provider,
        productId: event.product_id ?? 'unknown',
        tier,
        status,
        externalId,
        periodStart,
        periodEnd,
        trialEndsAt,
        canceledAt: status === 'canceled' ? new Date() : null,
        metadata,
      })
      .onConflictDoUpdate({
        target: [schema.subscription.provider, schema.subscription.externalId],
        set: {
          organizationId: orgId,
          purchaserUserId: userId,
          productId: event.product_id ?? 'unknown',
          tier,
          status,
          periodStart,
          periodEnd,
          trialEndsAt,
          canceledAt: status === 'canceled' ? new Date() : null,
          metadata,
        },
        // Event-order guard: RevenueCat can deliver out of order (a stale CANCELLATION after a newer
        // RENEWAL for the same externalId). Only overwrite when the incoming event is at least as new
        // as the stored row, so a late cancel can't flip a live sub back to canceled. Both a stored-null
        // AND an incoming-null periodEnd are overwritable: events like NON_RENEWING_PURCHASE / some
        // PRODUCT_CHANGE flips carry no expiration_at_ms yet represent the latest state, and without the
        // incoming-null clause (false OR NULL = NULL) Postgres would silently DROP them, leaving the row
        // stale. The excluded.* column name is derived from the schema object (Column.name is the DB
        // name) so a rename can't silently desync this raw SQL. (Cancellations carry expiration_at_ms,
        // so a genuinely-stale incoming-null overwriting a newer row is the rarer case.)
        setWhere: sql`${schema.subscription.periodEnd} is null or excluded.${sql.raw(schema.subscription.periodEnd.name)} is null or excluded.${sql.raw(schema.subscription.periodEnd.name)} >= ${schema.subscription.periodEnd}`,
      })

    // Recompute the org's billing cache from ALL its rows (Stripe + IAP) and persist it. Taking the
    // highest LIVE entitlement means a downgrade event only drops the cache when no other live row
    // outranks it, and an org with both web + device subs lands on the better of the two.
    const resolved = await resolveOrgEntitlement(db, orgId)
    await db
      .update(schema.organization)
      .set({
        subscriptionTier: resolved.tier,
        subscriptionStatus: resolved.status,
        currentPeriodEnd: resolved.currentPeriodEnd,
      })
      .where(eq(schema.organization.id, orgId))

    // Best-effort: on an UPGRADE (this event resolves to a paid, live tier) celebrate + notify.
    // unlockAchievement + notify are idempotent / never throw, so this can't fail the ack.
    if (status === 'active' && resolved.tier !== 'FREE') {
      await unlockAchievement(db, c.env, {
        organizationId: orgId,
        userId,
        achievementKey: 'supporter',
      })
      if (event.type === 'INITIAL_PURCHASE' || event.type === 'PRODUCT_CHANGE') {
        await notify(db, c.env, {
          organizationId: orgId,
          userId,
          kind: 'billing.upgraded',
          title: 'Subscription active',
          body: 'Thanks for upgrading — your new plan is unlocked.',
          entityType: 'billing',
        })
      }
    }

    return c.json({ received: true })
  } catch (e) {
    await db.delete(schema.webhookEvent).where(eq(schema.webhookEvent.id, claimed[0].id))
    throw e
  }
})
