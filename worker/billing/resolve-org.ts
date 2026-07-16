import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { can, normalizeKind } from '@/lib/config/roles'

/**
 * Which org does a STORE purchase attach to? Entitlements are per-ORG but an Apple/Google receipt
 * belongs to a PERSON (the RevenueCat app_user_id = our Better-Auth user id), so the webhook must
 * map user → org. The template assumed `kind='personal'` — correct only for solo-first apps
 * (tenant.autoPersonalOrg=true). ManyHandz is TEAM-FIRST (autoPersonalOrg=false: households are
 * created/joined in onboarding; personal orgs never exist — the fresh-eyes review confirmed zero
 * `kind='personal'` rows in the live DB), so that lookup could never grant a purchased tier.
 *
 * This module is the tenancy-posture-aware seam (upstream candidate for
 * template/worker/routes/revenuecat.ts, which carries the same solo-first assumption):
 *
 *   ① a `subscription` row already exists for (provider, externalId) → its org. Renewals,
 *      cancellations, billing issues and expirations always land on the org the purchase
 *      originally granted — sticky across sessions and membership churn.
 *   ② solo-first (APP_CONFIG.tenant.autoPersonalOrg=true): the buyer's personal org — the
 *      template's original behavior, kept verbatim.
 *   ③ team-first: the buyer's ACTIVE org from their most recent session, verified against a live
 *      (non-archived) membership. A purchase can only start inside an active household context and
 *      the webhook arrives seconds later, so this is the household they bought FROM.
 *   ④ last resort (no live session — e.g. a very late replay): the EARLIEST live membership whose
 *      (kind, role) grants `org:billing`. Capability-aware, never role-literal — family creators
 *      are 'parent', not 'owner' (CAPABILITY LAW, src/lib/config/roles.ts).
 *
 * Returns null when nothing matches; the webhook warns loudly + acks (never 500 a store webhook
 * into a retry loop over a mapping problem).
 */

/** Live-membership row the pure picker consumes (queried by resolveBillingOrgId). */
export type BillingMembership = {
  orgId: string
  kind: string
  /** SPINE §10.3 cutover COMPLETE: member.role carries the household vocabulary (personal orgs
   *  keep 'owner') — the same single read as requireOrg (worker/middleware/org.ts). */
  role: string
}

/**
 * Pure decision core for steps ③+④ (exported for tests): active-session org first (any role — a
 * store purchase made from inside a household should grant THAT household even if the buyer isn't
 * its billing admin; the store already took their money), then the earliest membership that can
 * administer billing for its org. `memberships` must be live-only, ordered by member.createdAt asc.
 */
export function pickMembershipOrg(
  activeOrgId: string | null | undefined,
  memberships: readonly BillingMembership[],
): string | null {
  const active = activeOrgId ? memberships.find((m) => m.orgId === activeOrgId) : undefined
  if (active) return active.orgId
  const billable = memberships.find((m) => can(normalizeKind(m.kind), m.role, 'org:billing'))
  return billable?.orgId ?? null
}

/** Full ladder ①→④ — the webhook's org resolution. See the module comment. */
export async function resolveBillingOrgId(
  db: DB,
  userId: string,
  provider: 'apple' | 'google',
  externalId: string,
): Promise<string | null> {
  // ① Sticky: this transaction already has a row — its org is decided.
  const [existing] = await db
    .select({ orgId: schema.subscription.organizationId })
    .from(schema.subscription)
    .where(and(eq(schema.subscription.provider, provider), eq(schema.subscription.externalId, externalId)))
    .limit(1)
  if (existing) return existing.orgId

  // ② Solo-first: the auto-provisioned personal org (template behavior, kept verbatim).
  if (APP_CONFIG.tenant.autoPersonalOrg) {
    const [personalOrg] = await db
      .select({ id: schema.member.organizationId })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(and(eq(schema.member.userId, userId), eq(schema.organization.kind, 'personal')))
      .limit(1)
    if (personalOrg) return personalOrg.id
    // fall through — even a solo-first app can resolve a team membership below
  }

  // ③+④ Team-first: latest session's active org, else earliest billing-capable live membership.
  const [sess] = await db
    .select({ orgId: schema.session.activeOrganizationId })
    .from(schema.session)
    .where(and(eq(schema.session.userId, userId), isNotNull(schema.session.activeOrganizationId)))
    .orderBy(desc(schema.session.updatedAt))
    .limit(1)
  const memberships = await db
    .select({
      orgId: schema.member.organizationId,
      kind: schema.organization.kind,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), isNull(schema.member.archivedAt)))
    .orderBy(asc(schema.member.createdAt))
  return pickMembershipOrg(sess?.orgId ?? null, memberships)
}
