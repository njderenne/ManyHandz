import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'

/**
 * Moderation — UGC safety endpoints required by App Store Guideline 1.2: any app surfacing
 * user-generated content must let users REPORT abusive content and BLOCK abusive users.
 * Same shape as notifications.ts (the canonical org-scoped resource route): `requireOrg`
 * gates every endpoint, and every query scopes by the session user.
 *
 * Blocks are intentionally USER-level (no organizationId column — a block follows the person
 * across orgs, see schema.ts user_block). The :orgId in the URL keeps the route shape consistent
 * with the rest of the API and lets `requireOrg` enforce membership before any moderation action.
 *
 *   POST   /api/organizations/:orgId/reports                { entityType, entityId, reason, details?, reportedUserId? }
 *   GET    /api/organizations/:orgId/blocks                 → caller's blocks, newest first
 *   POST   /api/organizations/:orgId/blocks                 { blockedUserId } → idempotent
 *   DELETE /api/organizations/:orgId/blocks/:blockedUserId  → unblock
 */
export const moderationRoutes = new Hono<AuthEnv>()

/**
 * Client-facing report vocabulary. The `report.reason` column is TEXT, so the route validates
 * against this list. Mirrored in src/lib/query/hooks/useModeration.ts (REPORT_REASONS) — the
 * client can't import worker code, so keep the two lists in sync.
 */
const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'] as const
type ReportReason = (typeof REPORT_REASONS)[number]

/**
 * Postgres foreign-key violation (23503), wherever the Neon HTTP driver surfaces it: directly on
 * the error for raw driver errors, or on `cause` when Drizzle wraps it (DrizzleQueryError). Mirrors
 * isUniqueViolation in referrals.ts. Closes the TOCTOU race where a reported/blocked user is deleted
 * between the existence SELECT and the INSERT — the FK then rejects the INSERT, which we map back to
 * the same clean 404 the pre-check returns instead of an opaque 500.
 */
function isForeignKeyViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  if ((e as { code?: unknown }).code === '23503') return true
  const cause = (e as { cause?: unknown }).cause
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === '23503'
}

moderationRoutes.post('/:orgId/reports', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  // .catch: malformed JSON is a client error (400), not a Worker error (500).
  const body = await c.req
    .json<{
      entityType?: string
      entityId?: string
      reason?: string
      details?: string
      reportedUserId?: string
    }>()
    .catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'a JSON object body is required' }, 400)
  const { entityType, entityId, reason, details, reportedUserId } = body

  // typeof guards first — the JSON body is untrusted at runtime regardless of the generic above,
  // and .trim() on a non-string field would surface as a 500. Absent/null mean "not provided".
  const fields: Record<string, unknown> = { entityType, entityId, reason, details, reportedUserId }
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return c.json({ error: `${field} must be a string` }, 400)
    }
  }

  if (!reason || !REPORT_REASONS.includes(reason as ReportReason)) {
    return c.json({ error: `reason must be one of: ${REPORT_REASONS.join(', ')}` }, 400)
  }
  // The report table's check constraint requires a target: an entity and/or a user.
  if (!entityId?.trim() && !reportedUserId?.trim()) {
    return c.json({ error: 'entityId or reportedUserId is required' }, 400)
  }
  if (entityId?.trim() && !entityType?.trim()) {
    return c.json({ error: 'entityType is required with entityId' }, 400)
  }
  // Length caps — these are TEXT columns; unbounded client strings are a database-bloat vector.
  if (entityType && entityType.length > 255) return c.json({ error: 'entityType too long' }, 400)
  if (entityId && entityId.length > 255) return c.json({ error: 'entityId too long' }, 400)
  if (reportedUserId && reportedUserId.length > 255) {
    return c.json({ error: 'reportedUserId too long' }, 400)
  }
  if (details && details.length > 2000) return c.json({ error: 'details too long' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  // Reported user must exist — a clean 404 beats polluting the audit trail with phantom ids
  // (same pattern as the blockedUserId check in POST /blocks below).
  const reportedId = reportedUserId?.trim() || null
  if (reportedId) {
    const [target] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, reportedId))
      .limit(1)
    if (!target) return c.json({ error: 'reported user not found' }, 404)
  }

  let row: typeof schema.report.$inferSelect | undefined
  try {
    ;[row] = await db
      .insert(schema.report)
      .values({
        organizationId: orgId,
        // Reporter comes from the SESSION, never the body — golden rule 4.
        reporterUserId: session.user.id,
        entityType: entityType?.trim() || null,
        entityId: entityId?.trim() || null,
        reportedUserId: reportedId,
        reason,
        details: details?.trim().slice(0, 2000) || null,
      })
      .returning()
  } catch (e) {
    // Closes the race against the existence pre-check above: if the reported account was deleted
    // between that SELECT and this INSERT, the reported_user_id FK rejects (23503). Same answer as
    // the pre-check — a clean 404, not the FK's opaque 500. Anything else is a real error: rethrow.
    if (reportedId && isForeignKeyViolation(e)) {
      return c.json({ error: 'reported user not found' }, 404)
    }
    throw e
  }
  if (!row) return c.json({ error: 'failed to create report' }, 500)

  // Moderation trail for the org's activity log (review queues read the report table itself).
  await audit(c, {
    entityType: 'report',
    entityId: row.id,
    action: 'report.created',
    metadata: { reason, targetType: entityType?.trim() || 'user' },
  })
  return c.json(row, 201)
})

moderationRoutes.get('/:orgId/blocks', requireOrg, async (c) => {
  const session = c.get('session')

  // User-scoped: a caller only ever sees their OWN block list (no org column — see header note).
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.userBlock)
    .where(eq(schema.userBlock.blockerUserId, session.user.id))
    .orderBy(desc(schema.userBlock.createdAt))
  return c.json(rows)
})

moderationRoutes.post('/:orgId/blocks', requireOrg, async (c) => {
  const session = c.get('session')

  const blockBody = await c.req.json<{ blockedUserId?: string }>().catch(() => null)
  if (!blockBody || typeof blockBody !== 'object') return c.json({ error: 'a JSON object body is required' }, 400)
  const { blockedUserId } = blockBody
  // Trim BEFORE the self-check — '  <own id>  ' must not slip past it. typeof guard because the
  // body is untrusted at runtime: a non-string is "missing", never a thrown .trim().
  const blockedId = typeof blockedUserId === 'string' ? blockedUserId.trim() : ''
  if (!blockedId) return c.json({ error: 'blockedUserId is required' }, 400)
  if (blockedId === session.user.id) return c.json({ error: 'cannot block yourself' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  // Check the target exists first — a clean 404 beats the FK violation's opaque 500.
  const [target] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, blockedId))
    .limit(1)
  if (!target) return c.json({ error: 'user not found' }, 404)

  // Idempotent: (blocker, blocked) is the primary key, so re-blocking is a no-op.
  try {
    await db
      .insert(schema.userBlock)
      .values({ blockerUserId: session.user.id, blockedUserId: blockedId })
      .onConflictDoNothing()
  } catch (e) {
    // Closes the race against the existence pre-check above: if the target was deleted between that
    // SELECT and this INSERT, the blocked_user_id FK rejects (23503). Same answer as the pre-check —
    // a clean 404, not the FK's opaque 500. Anything else is a real error: rethrow.
    if (isForeignKeyViolation(e)) return c.json({ error: 'user not found' }, 404)
    throw e
  }
  // No audit row: blocks are a personal safety action, kept out of the org activity feed so the
  // blocked party (or org admins browsing activity) can't discover who blocked whom.
  return c.json({ ok: true })
})

moderationRoutes.delete('/:orgId/blocks/:blockedUserId', requireOrg, async (c) => {
  const session = c.get('session')
  const blockedUserId = c.req.param('blockedUserId')

  await getDb(c.env.DATABASE_URL)
    .delete(schema.userBlock)
    .where(
      and(
        // Scoping on the WRITE too — callers can only remove their own blocks.
        eq(schema.userBlock.blockerUserId, session.user.id),
        eq(schema.userBlock.blockedUserId, blockedUserId),
      ),
    )
  return c.json({ ok: true })
})
