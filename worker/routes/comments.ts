import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { resolveHousehold, type HouseholdEnv } from '../household'
import { isAdmin } from '@/lib/config/modes'

/**
 * Assignment comments — the threaded notes on a single assignment (brief §"Assignment Comments"):
 * a chronological thread, 500-char bodies, capped at 50 per assignment. Reads are open to every
 * household member (requireOrg); posting is open to any member (no matrix permission — it's just
 * "leave a note"); deleting is the AUTHOR or a household admin (isAdmin == editHouseholdSettings).
 * Every query scopes by organizationId, and the parent assignment is verified to belong to the org
 * before any read/write. Pairs with src/lib/query/hooks/useComments.ts.
 *
 *   GET    /api/organizations/:orgId/assignments/:assignmentId/comments              → thread, oldest first
 *   POST   /api/organizations/:orgId/assignments/:assignmentId/comments  { body }    → add (any member)
 *   DELETE /api/organizations/:orgId/assignments/:assignmentId/comments/:commentId   → author or admin
 */
export const commentRoutes = new Hono<HouseholdEnv>()

/** Hard cap on comments per assignment (brief: "50 max"). */
const MAX_COMMENTS = 50

const commentCreate = z.object({
  body: z.string().trim().min(1).max(500),
})

/** Confirm the assignment exists AND belongs to this org. Returns its id, or null on a foreign/missing id. */
async function assignmentInOrg(
  env: HouseholdEnv['Bindings'],
  orgId: string,
  assignmentId: string,
): Promise<string | null> {
  const [a] = await getDb(env.DATABASE_URL)
    .select({ id: schema.assignment.id })
    .from(schema.assignment)
    .where(and(eq(schema.assignment.id, assignmentId), eq(schema.assignment.organizationId, orgId)))
    .limit(1)
  return a?.id ?? null
}

commentRoutes.get('/:orgId/assignments/:assignmentId/comments', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const assignmentId = c.req.param('assignmentId')
  if (!(await assignmentInOrg(c.env, orgId, assignmentId))) return c.json({ error: 'not found' }, 404)

  const db = getDb(c.env.DATABASE_URL)
  const rows = await db
    .select({
      id: schema.assignmentComment.id,
      assignmentId: schema.assignmentComment.assignmentId,
      memberId: schema.assignmentComment.memberId,
      body: schema.assignmentComment.body,
      createdAt: schema.assignmentComment.createdAt,
      memberName: schema.member.displayName,
      avatarUrl: schema.member.avatarUrl,
    })
    .from(schema.assignmentComment)
    .leftJoin(schema.member, eq(schema.member.id, schema.assignmentComment.memberId))
    .where(
      and(
        eq(schema.assignmentComment.organizationId, orgId),
        eq(schema.assignmentComment.assignmentId, assignmentId),
      ),
    )
    .orderBy(asc(schema.assignmentComment.createdAt))
  return c.json(rows)
})

commentRoutes.post('/:orgId/assignments/:assignmentId/comments', requireOrg, async (c) => {
  // Posting is open to any household member — resolveHousehold just gives us the author's member id.
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const assignmentId = c.req.param('assignmentId')
  if (!(await assignmentInOrg(c.env, ctx.orgId, assignmentId))) return c.json({ error: 'not found' }, 404)

  const parsed = commentCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)

  const db = getDb(c.env.DATABASE_URL)

  // Enforce the per-assignment cap (brief: 50 max).
  const existing = await db
    .select({ id: schema.assignmentComment.id })
    .from(schema.assignmentComment)
    .where(
      and(
        eq(schema.assignmentComment.organizationId, ctx.orgId),
        eq(schema.assignmentComment.assignmentId, assignmentId),
      ),
    )
    .limit(MAX_COMMENTS)
  if (existing.length >= MAX_COMMENTS) {
    return c.json({ error: `comment limit reached (${MAX_COMMENTS} per assignment)` }, 409)
  }

  const [row] = await db
    .insert(schema.assignmentComment)
    .values({
      organizationId: ctx.orgId,
      assignmentId,
      memberId: ctx.memberId,
      body: parsed.data.body,
    })
    .returning()
  await audit(c, { entityType: 'assignment_comment', entityId: row.id, action: 'comment.created', metadata: { assignmentId } })
  return c.json(row, 201)
})

commentRoutes.delete('/:orgId/assignments/:assignmentId/comments/:commentId', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const assignmentId = c.req.param('assignmentId')
  const commentId = c.req.param('commentId')
  if (!(await assignmentInOrg(c.env, ctx.orgId, assignmentId))) return c.json({ error: 'not found' }, 404)

  const db = getDb(c.env.DATABASE_URL)
  const [comment] = await db
    .select({ id: schema.assignmentComment.id, memberId: schema.assignmentComment.memberId })
    .from(schema.assignmentComment)
    .where(
      and(
        eq(schema.assignmentComment.id, commentId),
        eq(schema.assignmentComment.organizationId, ctx.orgId),
        eq(schema.assignmentComment.assignmentId, assignmentId),
      ),
    )
    .limit(1)
  if (!comment) return c.json({ error: 'not found' }, 404)

  // Author or a household admin (isAdmin == editHouseholdSettings) may delete.
  const isAuthor = comment.memberId === ctx.memberId
  if (!isAuthor && !isAdmin(ctx.mode, ctx.householdRole)) return c.json({ error: 'forbidden' }, 403)

  await db
    .delete(schema.assignmentComment)
    .where(
      and(
        eq(schema.assignmentComment.id, commentId),
        eq(schema.assignmentComment.organizationId, ctx.orgId),
      ),
    )
  await audit(c, { entityType: 'assignment_comment', entityId: commentId, action: 'comment.deleted', metadata: { assignmentId } })
  return c.json({ ok: true })
})
