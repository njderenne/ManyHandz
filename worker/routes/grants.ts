import { Hono } from 'hono'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { can } from '@/lib/config/roles'
import { FEATURE_TIERS } from '@/lib/config/entitlements'
import { requireOrg, requireCapability, audit, type AuthEnv } from '../middleware/org'
import { requireFeature } from '../entitlements'
import { billingError } from '../billing/limits'
import { mintGrant } from '../lib/access-grant'
import { assertSubjectInOrg } from '../lib/oversight'
import { GRANT_SCOPES } from '../grant-config'

/**
 * Access grants — OWNER side (org-scoped, SUBJECT_SPEC §6.3). Mint / list / revoke / delete
 * named, scoped, time-boxed outsider grants and read the per-grant audit trail. The PUBLIC,
 * account-less surface lives in worker/routes/grant-public.ts (authorized by the code, not a
 * session). Direct generalization of pet-pilot sitter.ts.
 *
 *   GET    /:orgId/grants               requireOrg                          all grants, newest first
 *                                       (`code` redacted unless the caller holds grant:manage)
 *   POST   /:orgId/grants               requireOrg + grant:manage + tier    mint → row incl. `code`
 *   POST   /:orgId/grants/:id/revoke    requireOrg + grant:manage           soft-revoke; idempotent
 *   DELETE /:orgId/grants/:id           requireOrg + grant:manage           hard delete (cascades audit)
 *   GET    /:orgId/grants/:id/activity  requireOrg                          newest first, limit 100
 *
 * AUTHORIZATION (B-1): `grant:manage` replaces pet-pilot's requireRole('owner','admin') literals —
 * the default KIND_CONFIGS matrix grants it to owner+admin (byte-identical for single-kind apps)
 * and custom-vocabulary kinds keep a working grant surface.
 *
 * ENTITLEMENT ASYMMETRY IS THE CONTRACT (pet-pilot, proven in prod): only POST (minting) is
 * tier-gated (FEATURE_TIERS.shareGrants, STANDARD by default). List / revoke / delete / activity
 * are open at FREE forever — never trap a user with un-revokable grants; a lapsed owner can
 * always see and kill outstanding access (SUBJECT_SPEC §6.6 wind-down law).
 *
 * Mounted by worker/index.ts ONLY when APP_CONFIG.features.shareGrants (stage-0 §3.4); the
 * internal guard below is defense-in-depth so a stray mount can never expose the surface.
 */
export const grantRoutes = new Hono<AuthEnv>()

/** Feature-off ⇒ 404 (not 403): the surface should not exist, and its absence isn't an oracle. */
grantRoutes.use('*', async (c, next) => {
  if (!APP_CONFIG.features.shareGrants) return c.json({ error: 'not found' }, 404)
  return next()
})

/**
 * Mint body (pet-pilot's create schema, plus subject pinning). Scopes must be a non-empty subset
 * of the app's GRANT_SCOPES vocabulary (worker/grant-config.ts); the window is validated below
 * (expiry after start, bounded by APP_CONFIG.grants.maxDurationDays).
 */
const createGrantSchema = z.object({
  granteeName: z.string().trim().min(1).max(80),
  granteeEmail: z.string().trim().email().max(120).nullish(),
  // Bounded like every array input in the chassis (input-caps law): duplicates of a valid scope
  // would otherwise let a caller persist an arbitrarily large jsonb/text[] that the PUBLIC surface
  // echoes verbatim to any code holder. Deduped again before mint (belt-and-braces).
  scopes: z
    .array(z.string())
    .min(1)
    .max(32)
    .refine((arr) => arr.every((s) => GRANT_SCOPES.includes(s)), {
      message: 'unknown scope',
    }),
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  /** Optional pin to ONE subject — verified below as an ACTIVE subject of THIS org. */
  subjectId: z.string().min(1).max(64).nullish(),
})

grantRoutes.get('/:orgId/grants', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.accessGrant)
    .where(eq(schema.accessGrant.organizationId, orgId))
    .orderBy(desc(schema.accessGrant.createdAt))
  // `code` is a LIVE credential. It reaches the client at mint (SUBJECT_SPEC §6.7's handoff
  // moment) and, for the re-share affordance, in list rows for callers holding grant:manage —
  // everyone else gets it REDACTED. Without this, a role denied subject:view (or any plain
  // member) could harvest live codes from the list and act on the public /api/grant surface
  // under the grantee's audit identity — a capability-escalation path. The list stays open at
  // every role (the wind-down law needs revocation VISIBILITY), only the credential is gated.
  const canManage = can(c.get('orgKind'), c.get('orgRole'), 'grant:manage')
  return c.json(canManage ? rows : rows.map((row) => ({ ...row, code: null })))
})

grantRoutes.post('/:orgId/grants', requireOrg, requireCapability('grant:manage'), async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const db = getDb(c.env.DATABASE_URL)

  // PAID: minting account-less access is the gated half (the canonical 402 envelope so the
  // client's isUpgradeError routing works). Trialing/active orgs pass; a lapsed FREE org gets a
  // 402 here but can still list/revoke/delete the grants it already minted (asymmetry law).
  const gate = await requireFeature(db, orgId, 'shareGrants')
  if (!gate.ok) {
    return billingError(c, {
      ok: false,
      error: gate.reason,
      code: 'tier_required',
      upgradeTier: FEATURE_TIERS.shareGrants,
    })
  }

  const parsed = createGrantSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid grant' }, 400)
  }
  const body = parsed.data

  const startsAt = new Date(body.startsAt)
  const expiresAt = new Date(body.expiresAt)
  if (expiresAt.getTime() <= startsAt.getTime()) {
    return c.json({ error: 'expiry must be after the start time' }, 400)
  }
  const maxMs = APP_CONFIG.grants.maxDurationDays * 86_400_000
  if (expiresAt.getTime() - startsAt.getTime() > maxMs) {
    return c.json(
      { error: `grants are capped at ${APP_CONFIG.grants.maxDurationDays} days` },
      400,
    )
  }

  // Subject pin must be an ACTIVE subject of THIS org — a foreign/archived id never mints.
  // assertSubjectInOrg is the ONE canonical subject fence (worker/lib/oversight.ts) — never
  // re-inline the predicate; archival/visibility semantics must change in exactly one place.
  if (body.subjectId && !(await assertSubjectInOrg(db, orgId, body.subjectId))) {
    return c.json({ error: 'subject not found' }, 404)
  }

  const created = await mintGrant(db, {
    organizationId: orgId,
    subjectId: body.subjectId ?? null,
    granteeName: body.granteeName,
    granteeEmail: body.granteeEmail ?? null,
    scopes: [...new Set(body.scopes)],
    startsAt,
    expiresAt,
    createdByUserId: session.user.id,
  })

  await audit(c, {
    entityType: 'access_grant',
    entityId: created.id,
    action: 'grant.created',
    metadata: { granteeName: created.granteeName, scopes: created.scopes },
  })
  // The one response that carries `code` to the owner — the UI shows/copies/QRs it right here.
  return c.json(created, 201)
})

grantRoutes.post(
  '/:orgId/grants/:id/revoke',
  requireOrg,
  requireCapability('grant:manage'),
  async (c) => {
    const orgId = c.get('orgId')
    const id = c.req.param('id')
    const db = getDb(c.env.DATABASE_URL)

    // Soft-revoke only when still live — keeps the FIRST revokedAt (the honest audit timestamp).
    const [row] = await db
      .update(schema.accessGrant)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.accessGrant.id, id),
          eq(schema.accessGrant.organizationId, orgId),
          isNull(schema.accessGrant.revokedAt),
        ),
      )
      .returning({ id: schema.accessGrant.id })
    if (row) {
      await audit(c, { entityType: 'access_grant', entityId: row.id, action: 'grant.revoked' })
      return c.json({ ok: true })
    }
    // Idempotent: revoking an already-revoked grant is a success, not a conflict — but a grant
    // that doesn't exist (or isn't this org's) is still an honest 404.
    const [existing] = await db
      .select({ id: schema.accessGrant.id })
      .from(schema.accessGrant)
      .where(and(eq(schema.accessGrant.id, id), eq(schema.accessGrant.organizationId, orgId)))
      .limit(1)
    if (!existing) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  },
)

grantRoutes.delete(
  '/:orgId/grants/:id',
  requireOrg,
  requireCapability('grant:manage'),
  async (c) => {
    const orgId = c.get('orgId')
    const [row] = await getDb(c.env.DATABASE_URL)
      .delete(schema.accessGrant)
      .where(
        and(
          eq(schema.accessGrant.id, c.req.param('id')),
          eq(schema.accessGrant.organizationId, orgId),
        ),
      )
      .returning({ id: schema.accessGrant.id })
    if (!row) return c.json({ error: 'not found' }, 404)
    await audit(c, { entityType: 'access_grant', entityId: row.id, action: 'grant.deleted' })
    return c.json({ ok: true })
  },
)

grantRoutes.get('/:orgId/grants/:id/activity', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)
  // Ownership check first (golden rule 4 on the join key), then the bounded trail.
  const [grant] = await db
    .select({ id: schema.accessGrant.id })
    .from(schema.accessGrant)
    .where(
      and(eq(schema.accessGrant.id, c.req.param('id')), eq(schema.accessGrant.organizationId, orgId)),
    )
    .limit(1)
  if (!grant) return c.json({ error: 'not found' }, 404)
  const rows = await db
    .select()
    .from(schema.accessGrantActivity)
    .where(eq(schema.accessGrantActivity.grantId, grant.id))
    .orderBy(desc(schema.accessGrantActivity.createdAt))
    .limit(100)
  return c.json(rows)
})
