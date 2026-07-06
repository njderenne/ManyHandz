import { Hono } from 'hono'
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'
import { householdContext } from '../lib/household-context'

/**
 * Activity feed + reactions — the household's running log of what happened (the same org-scoped
 * activity_log that `audit()` appends to), surfaced newest-first with per-entry reaction tallies.
 *
 * Reads are available to every household member (the feed is a universal, lightweight surface — even
 * a family kid sees it). Reacting is likewise a universal, low-stakes social action: there is no
 * `reactToActivity` permission key in the mode matrix, so writes only require an authenticated
 * household member (resolveHousehold gives us the caller's memberId, which the reaction row needs).
 * Every query still scopes by organizationId.
 *
 *   GET  /api/organizations/:orgId/activity-feed                          → feed + reactions, newest first
 *   POST /api/organizations/:orgId/activity-feed/:activityId/reactions    → toggle a reaction {emoji}
 *
 * Pairs with src/lib/query/hooks/useActivity.ts.
 */
export const activityRoutes = new Hono<AuthEnv>()

/** The reaction set (named keys, stored verbatim in activity_reaction.emoji). */
export const REACTION_EMOJIS = ['thumbsup', 'heart', 'fire', 'star', 'clap'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

/** Page size for the feed (mirrors notifications.ts). */
const FEED_LIMIT = 50

const reactionInput = z.object({ emoji: z.enum(REACTION_EMOJIS) })

type ReactionTally = Record<string, number>

/** A feed row with its reaction counts (per emoji) + which emoji the caller has reacted with. */
type ActivityFeedRow = typeof schema.activityLog.$inferSelect & {
  reactions: ReactionTally
  myReactions: string[]
}

activityRoutes.get('/:orgId/activity-feed', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const orgId = ctx.orgId
  const db = getDb(c.env.DATABASE_URL)

  // Cursor pagination: ?cursor=<ISO createdAt of the last row seen> → rows strictly older. Same
  // boundary caveat as notifications.ts — id desc is the tiebreaker for createdAt collisions.
  const cursor = c.req.query('cursor')
  const cursorDate = cursor ? new Date(cursor) : null
  const scope = eq(schema.activityLog.organizationId, orgId)
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(
      cursorDate && !Number.isNaN(cursorDate.getTime())
        ? and(scope, lt(schema.activityLog.createdAt, cursorDate))
        : scope,
    )
    .orderBy(desc(schema.activityLog.createdAt), desc(schema.activityLog.id))
    .limit(FEED_LIMIT)

  const ids = rows.map((r) => r.id)
  if (ids.length === 0) return c.json([] as ActivityFeedRow[])

  // Reaction tallies for exactly this page (count per activity+emoji), org-scoped on the write table too.
  const tallies = await db
    .select({
      activityId: schema.activityReaction.activityId,
      emoji: schema.activityReaction.emoji,
      count: sql<string>`count(*)`,
    })
    .from(schema.activityReaction)
    .where(
      and(
        eq(schema.activityReaction.organizationId, orgId),
        inArray(schema.activityReaction.activityId, ids),
      ),
    )
    .groupBy(schema.activityReaction.activityId, schema.activityReaction.emoji)

  // Which emoji the caller themselves reacted with, for this page.
  const mine = await db
    .select({
      activityId: schema.activityReaction.activityId,
      emoji: schema.activityReaction.emoji,
    })
    .from(schema.activityReaction)
    .where(
      and(
        eq(schema.activityReaction.organizationId, orgId),
        eq(schema.activityReaction.memberId, ctx.memberId),
        inArray(schema.activityReaction.activityId, ids),
      ),
    )

  const tallyByActivity = new Map<string, ReactionTally>()
  for (const t of tallies) {
    const bucket = tallyByActivity.get(t.activityId) ?? {}
    bucket[t.emoji] = Number(t.count)
    tallyByActivity.set(t.activityId, bucket)
  }
  const mineByActivity = new Map<string, string[]>()
  for (const m of mine) {
    const bucket = mineByActivity.get(m.activityId) ?? []
    bucket.push(m.emoji)
    mineByActivity.set(m.activityId, bucket)
  }

  const feed: ActivityFeedRow[] = rows.map((r) => ({
    ...r,
    reactions: tallyByActivity.get(r.id) ?? {},
    myReactions: mineByActivity.get(r.id) ?? [],
  }))
  return c.json(feed)
})

activityRoutes.post('/:orgId/activity-feed/:activityId/reactions', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const orgId = ctx.orgId
  const activityId = c.req.param('activityId')
  const db = getDb(c.env.DATABASE_URL)

  const parsed = reactionInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const { emoji } = parsed.data

  // The target activity row must belong to this household (never trust the path id on its own).
  const [target] = await db
    .select({ id: schema.activityLog.id })
    .from(schema.activityLog)
    .where(and(eq(schema.activityLog.id, activityId), eq(schema.activityLog.organizationId, orgId)))
    .limit(1)
  if (!target) return c.json({ error: 'not found' }, 404)

  // Toggle: delete the caller's existing (activity, member, emoji) reaction, else insert one. The
  // unique index (activity_id, member_id, emoji) guarantees at most one such row.
  const reactionScope = and(
    eq(schema.activityReaction.organizationId, orgId),
    eq(schema.activityReaction.activityId, activityId),
    eq(schema.activityReaction.memberId, ctx.memberId),
    eq(schema.activityReaction.emoji, emoji),
  )
  const [existing] = await db
    .select({ id: schema.activityReaction.id })
    .from(schema.activityReaction)
    .where(reactionScope)
    .limit(1)

  let reacted: boolean
  if (existing) {
    await db.delete(schema.activityReaction).where(reactionScope)
    reacted = false
  } else {
    await db.insert(schema.activityReaction).values({
      organizationId: orgId,
      activityId,
      memberId: ctx.memberId,
      emoji,
    })
    reacted = true
  }

  await audit(c, {
    entityType: 'activity_reaction',
    entityId: activityId,
    action: reacted ? 'activity.reacted' : 'activity.unreacted',
    metadata: { emoji },
  })
  return c.json({ ok: true, reacted, emoji })
})
