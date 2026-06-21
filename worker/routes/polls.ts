import { Hono } from 'hono'
import { and, asc, desc, eq, lte } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { resolveHousehold, type HouseholdContext, type HouseholdEnv } from '../household'
import { can } from '@/lib/config/modes'

/**
 * Household polls / quick votes — voteable cards on the dashboard + feed. Reads are open to every
 * household member; creating and closing a poll is admin-gated (`editHouseholdSettings`), which the
 * mode matrix resolves to exactly "Family → parents only; Roommate → any member" (kids/colleagues
 * never hold it). Voting is open to every member.
 *
 * Votes are NORMALIZED into poll_vote (the brief fix — not a JSON blob); results are DERIVED by
 * counting rows per option. `allowMultiple=false` keeps a single vote per member (a new pick
 * replaces the old); `allowMultiple=true` toggles each option independently. Anonymous polls omit
 * voter member ids from the results.
 *
 *   GET    /api/organizations/:orgId/polls               → polls + derived tallies + my votes
 *   GET    /api/organizations/:orgId/polls/:pollId       → one poll + tallies + my votes
 *   POST   /api/organizations/:orgId/polls               → create   (admin)
 *   POST   /api/organizations/:orgId/polls/:pollId/vote  → toggle a vote (any member)
 *   POST   /api/organizations/:orgId/polls/:pollId/close  → close    (admin)
 */
export const pollRoutes = new Hono<HouseholdEnv>()

/** Write gate for polls. There is no dedicated `createPolls` permission key, so we reuse the admin
 *  permission (`editHouseholdSettings`) — the matrix already encodes parents-only / roommates-all. */
function canManagePolls(ctx: HouseholdContext): boolean {
  return can(ctx.mode, ctx.householdRole, 'editHouseholdSettings')
}

const pollCreate = z.object({
  question: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(6),
  allowMultiple: z.boolean().optional(),
  isAnonymous: z.boolean().optional(),
  closesAt: z.string().datetime().nullish(),
})

type PollRow = typeof schema.householdPoll.$inferSelect

/** Has this poll's deadline passed (and it isn't already flagged closed)? */
function isExpired(poll: Pick<PollRow, 'closesAt' | 'isClosed'>, now: Date): boolean {
  return !poll.isClosed && poll.closesAt !== null && poll.closesAt.getTime() <= now.getTime()
}

/**
 * Shape a poll for the client: derived per-option tallies (counted from poll_vote), the caller's own
 * selected option ids, and an effective `isClosed` that reflects a passed `closesAt` even if the
 * stored flag hasn't been flipped yet by the close action / cron. Anonymous polls only ever expose
 * counts — never which member voted.
 */
function shapePoll(
  poll: PollRow,
  votes: { optionId: string; memberId: string }[],
  myMemberId: string,
  now: Date,
) {
  const tally = new Map<string, number>()
  for (const opt of poll.options) tally.set(opt.id, 0)
  for (const v of votes) tally.set(v.optionId, (tally.get(v.optionId) ?? 0) + 1)

  const closed = poll.isClosed || isExpired(poll, now)
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options.map((o) => ({ id: o.id, text: o.text, votes: tally.get(o.id) ?? 0 })),
    allowMultiple: poll.allowMultiple,
    isAnonymous: poll.isAnonymous,
    closesAt: poll.closesAt,
    isClosed: closed,
    totalVotes: votes.length,
    myVotes: votes.filter((v) => v.memberId === myMemberId).map((v) => v.optionId),
    createdByMemberId: poll.createdByMemberId,
    createdAt: poll.createdAt,
  }
}

pollRoutes.get('/:orgId/polls', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const now = new Date()

  const polls = await db
    .select()
    .from(schema.householdPoll)
    .where(eq(schema.householdPoll.organizationId, ctx.orgId))
    .orderBy(desc(schema.householdPoll.createdAt))
    .limit(200)

  const votes = await db
    .select({
      pollId: schema.pollVote.pollId,
      optionId: schema.pollVote.optionId,
      memberId: schema.pollVote.memberId,
    })
    .from(schema.pollVote)
    .where(eq(schema.pollVote.organizationId, ctx.orgId))

  const byPoll = new Map<string, { optionId: string; memberId: string }[]>()
  for (const v of votes) {
    const list = byPoll.get(v.pollId) ?? []
    list.push({ optionId: v.optionId, memberId: v.memberId })
    byPoll.set(v.pollId, list)
  }

  return c.json(polls.map((p) => shapePoll(p, byPoll.get(p.id) ?? [], ctx.memberId, now)))
})

pollRoutes.get('/:orgId/polls/:pollId', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const pollId = c.req.param('pollId')

  const [poll] = await db
    .select()
    .from(schema.householdPoll)
    .where(and(eq(schema.householdPoll.id, pollId), eq(schema.householdPoll.organizationId, ctx.orgId)))
    .limit(1)
  if (!poll) return c.json({ error: 'not found' }, 404)

  const votes = await db
    .select({ optionId: schema.pollVote.optionId, memberId: schema.pollVote.memberId })
    .from(schema.pollVote)
    .where(and(eq(schema.pollVote.pollId, pollId), eq(schema.pollVote.organizationId, ctx.orgId)))
    .orderBy(asc(schema.pollVote.createdAt))

  return c.json(shapePoll(poll, votes, ctx.memberId, new Date()))
})

pollRoutes.post('/:orgId/polls', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !canManagePolls(ctx)) return c.json({ error: 'forbidden' }, 403)
  const parsed = pollCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // Generate stable option ids server-side ([{ id, text }] per the schema).
  const options = d.options.map((text) => ({ id: crypto.randomUUID(), text }))
  const closesAt = d.closesAt ? new Date(d.closesAt) : null
  if (closesAt && closesAt.getTime() <= Date.now()) {
    return c.json({ error: 'closesAt must be in the future' }, 400)
  }

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.householdPoll)
    .values({
      organizationId: ctx.orgId,
      question: d.question,
      options,
      allowMultiple: d.allowMultiple ?? false,
      isAnonymous: d.isAnonymous ?? false,
      closesAt,
      createdByMemberId: ctx.memberId,
    })
    .returning()
  await audit(c, { entityType: 'poll', entityId: row.id, action: 'poll.created', metadata: { question: row.question } })
  return c.json(shapePoll(row, [], ctx.memberId, new Date()), 201)
})

const voteInput = z.object({ optionId: z.string().min(1).max(64) })

pollRoutes.post('/:orgId/polls/:pollId/vote', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const pollId = c.req.param('pollId')
  const parsed = voteInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const { optionId } = parsed.data

  const [poll] = await db
    .select()
    .from(schema.householdPoll)
    .where(and(eq(schema.householdPoll.id, pollId), eq(schema.householdPoll.organizationId, ctx.orgId)))
    .limit(1)
  if (!poll) return c.json({ error: 'not found' }, 404)

  const now = new Date()
  if (poll.isClosed || isExpired(poll, now)) return c.json({ error: 'poll is closed' }, 409)
  if (!poll.options.some((o) => o.id === optionId)) return c.json({ error: 'invalid option' }, 400)

  // Toggle this member's vote for the chosen option.
  const [existing] = await db
    .select({ id: schema.pollVote.id })
    .from(schema.pollVote)
    .where(
      and(
        eq(schema.pollVote.pollId, pollId),
        eq(schema.pollVote.memberId, ctx.memberId),
        eq(schema.pollVote.optionId, optionId),
        eq(schema.pollVote.organizationId, ctx.orgId),
      ),
    )
    .limit(1)

  if (existing) {
    // Un-vote (toggle off).
    await db.delete(schema.pollVote).where(eq(schema.pollVote.id, existing.id))
  } else {
    // Single-choice polls: clear any prior pick before recording the new one.
    if (!poll.allowMultiple) {
      await db
        .delete(schema.pollVote)
        .where(
          and(
            eq(schema.pollVote.pollId, pollId),
            eq(schema.pollVote.memberId, ctx.memberId),
            eq(schema.pollVote.organizationId, ctx.orgId),
          ),
        )
    }
    await db.insert(schema.pollVote).values({
      organizationId: ctx.orgId,
      pollId,
      optionId,
      memberId: ctx.memberId,
    })
  }

  await audit(c, { entityType: 'poll', entityId: pollId, action: 'poll.voted' })

  // Return the fresh derived state so the client can update the bar chart without a refetch.
  const votes = await db
    .select({ optionId: schema.pollVote.optionId, memberId: schema.pollVote.memberId })
    .from(schema.pollVote)
    .where(and(eq(schema.pollVote.pollId, pollId), eq(schema.pollVote.organizationId, ctx.orgId)))
  return c.json(shapePoll(poll, votes, ctx.memberId, now))
})

pollRoutes.post('/:orgId/polls/:pollId/close', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !canManagePolls(ctx)) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const pollId = c.req.param('pollId')

  const [row] = await db
    .update(schema.householdPoll)
    .set({ isClosed: true })
    .where(
      and(
        eq(schema.householdPoll.id, pollId),
        eq(schema.householdPoll.organizationId, ctx.orgId),
        eq(schema.householdPoll.isClosed, false),
      ),
    )
    .returning({ id: schema.householdPoll.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'poll', entityId: pollId, action: 'poll.closed' })
  return c.json({ ok: true })
})

/**
 * Auto-close every poll whose `closesAt` has passed — the durable counterpart to the per-request
 * `isExpired` view. Exported for the weekly report cron ("auto-close expired polls"); call with the
 * org id (org-scoped) so it never sweeps another household's rows.
 */
export async function autoCloseExpiredPolls(env: HouseholdEnv['Bindings'], orgId: string): Promise<number> {
  const result = await getDb(env.DATABASE_URL)
    .update(schema.householdPoll)
    .set({ isClosed: true })
    .where(
      and(
        eq(schema.householdPoll.organizationId, orgId),
        eq(schema.householdPoll.isClosed, false),
        lte(schema.householdPoll.closesAt, new Date()),
      ),
    )
    .returning({ id: schema.householdPoll.id })
  return result.length
}
