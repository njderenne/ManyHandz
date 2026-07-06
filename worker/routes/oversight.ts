import { Hono } from 'hono'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { requireOrg, requireCapability, type AuthEnv } from '../middleware/org'
import { assertCanOverseeMember } from '../lib/oversight'

/**
 * Oversight — the REFERENCE cross-member read (SPINE_SPEC §8): what "reading ANOTHER member's
 * data" looks like when done right. App routes that surface one member's data to another member
 * (rosters, coach dashboards, parent views, report cards) copy this exact shape.
 *
 *   GET /api/organizations/:orgId/members/:userId/summary → narrow member summary, or 403
 *
 * THE TWO LAWS THIS FILE DEMONSTRATES:
 *
 * 1. EVERY cross-user read flows through `assertCanOverseeMember` (worker/lib/oversight.ts) —
 *    self short-circuit, then the PURE `member:oversee` matrix gate (attackers with the wrong
 *    role are denied with zero queries), then the same-org ACTIVE-member fence. The route maps a
 *    denial to a bare 403 — never reveal WHICH condition failed. Note the gate is NOT a
 *    `requireCapability('member:oversee')` mount: self-reads must pass without the capability,
 *    so the helper (which owns the self short-circuit) calls `can` itself.
 *
 * 2. COLUMN-SELECTION PRIVACY: an oversight read never `select()`s the full row. Each reader
 *    declares an EXPLICIT column map per audience — adding a column is a code-reviewable diff,
 *    not a `SELECT *`. This summary exposes exactly: display name, role, joined-at, last-active.
 *    Nothing else (no email, no user image, no settings) unless a future diff argues for it.
 *
 * DATA-CLASS ESCALATION: `member:oversee` is only the OUTER door. Stricter data classes (raw
 * health, private journals, messages) get their OWN app-declared capabilities layered on top —
 * append e.g. 'health:view_raw' to the app's Capability union + KIND_CONFIGS matrices and check
 * it here AFTER the oversight gate (grindline keeps coach reads aggregates-only exactly this
 * way). The chassis deliberately ships no such capability: which data classes exist is app-domain.
 *
 * Mounted by worker/index.ts ONLY when APP_CONFIG.features.oversight (stage-0 §3 wiring); the
 * internal guard below is defense-in-depth so a stray mount can never expose the surface.
 */
export const oversightRoutes = new Hono<AuthEnv>()

/** Feature-off ⇒ 404 (not 403): the surface should not exist, and its absence isn't an oracle. */
oversightRoutes.use('*', async (c, next) => {
  if (!APP_CONFIG.features.oversight) return c.json({ error: 'not found' }, 404)
  return next()
})

oversightRoutes.get('/:orgId/members/:userId/summary', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const targetUserId = c.req.param('userId')
  const db = getDb(c.env.DATABASE_URL)

  const allowed = await assertCanOverseeMember({
    db,
    orgId,
    orgKind: c.get('orgKind'),
    requesterRole: c.get('orgRole'),
    requesterUserId: session.user.id,
    targetUserId,
  })
  if (!allowed) return c.json({ error: 'forbidden' }, 403)

  // The NARROW column map (law 2). Last-active is derived from the target's freshest session row
  // (a scalar subquery — no second round-trip on Neon HTTP); null = never seen / sessions expired.
  const [row] = await db
    .select({
      userId: schema.member.userId,
      displayName: schema.member.displayName,
      name: schema.user.name,
      role: schema.member.role,
      joinedAt: schema.member.createdAt,
      lastActiveAt: sql<string | null>`(
        select max(${schema.session.updatedAt}) from ${schema.session}
        where ${schema.session.userId} = ${schema.member.userId}
      )`,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(
      and(
        eq(schema.member.organizationId, orgId),
        eq(schema.member.userId, targetUserId),
        isNull(schema.member.archivedAt),
      ),
    )
    .limit(1)
  // Self-reads pass the gate without a membership check, so re-verify the row exists here (a
  // caller whose own member row vanished mid-request gets a 404, not a crash).
  if (!row) return c.json({ error: 'not found' }, 404)

  return c.json({
    userId: row.userId,
    // Per-org display override first — the same fallback the roster uses (useOrgMembers).
    displayName: row.displayName?.trim() || row.name,
    role: row.role,
    joinedAt: row.joinedAt,
    lastActiveAt: row.lastActiveAt,
  })
})
