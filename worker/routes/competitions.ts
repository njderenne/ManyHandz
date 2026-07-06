import { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'
import { householdContext } from '../lib/household-context'
import { canWithHousehold } from '@/lib/config/modes'
import { notify } from '../notify'

/**
 * Head-to-Head competitions — a member challenges another to a points/completions race (brief §
 * "Head-to-Head Competitions"). Create lands `pending`; only the OPPONENT can accept (→ `active`)
 * or decline (→ `declined`). Live progress is advanced by the completion engine
 * (worker/manyhandz/completion-engine.ts §5); the competitions cron resolves the winner + transfers
 * stakes at `ends_at` — neither is built here.
 *
 * Writes need `createCompetitions`, resolved through `canWithHousehold` so a family kid's challenge
 * also requires the household `allowKidCompetitions` toggle, AND a kid's points wager is capped by
 * `organization.maxKidCompetitionStakes`. Every query scopes by organizationId. Pairs with
 * src/lib/query/hooks/useCompetitions.ts.
 *
 *   GET  /api/organizations/:orgId/competitions?status=active|pending|past → list
 *   GET  /api/organizations/:orgId/competitions/:id        → one
 *   POST /api/organizations/:orgId/competitions            → create (pending)  (createCompetitions)
 *   POST /api/organizations/:orgId/competitions/:id/accept → opponent accepts (→ active)
 *   POST /api/organizations/:orgId/competitions/:id/decline→ opponent declines (→ declined)
 */
export const competitionRoutes = new Hono<AuthEnv>()

const COMPETITION_TYPES = ['most_points', 'most_completions', 'first_to_target', 'specific_chore_race'] as const

const competitionCreate = z
  .object({
    opponentMemberId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(120),
    competitionType: z.enum(COMPETITION_TYPES),
    targetValue: z.number().int().min(1).max(1000000).nullish(),
    choreId: z.string().max(64).nullish(),
    stakesPoints: z.number().int().min(0).max(1000000).optional(),
    stakesDescription: z.string().trim().max(300).nullish(),
    // ISO date-time; defaults to a 7-day window from now when omitted.
    endsAt: z.string().datetime().optional(),
  })
  .refine((d) => d.competitionType !== 'first_to_target' || (d.targetValue ?? 0) > 0, {
    message: 'first_to_target requires a positive targetValue',
    path: ['targetValue'],
  })
  .refine((d) => d.competitionType !== 'specific_chore_race' || Boolean(d.choreId), {
    message: 'specific_chore_race requires a choreId',
    path: ['choreId'],
  })

/** Confirm a chore belongs to this household (or is cleared). Returns false on a foreign id. */
async function choreOk(env: AuthEnv['Bindings'], orgId: string, choreId: string | null | undefined) {
  if (!choreId) return true
  const [row] = await getDb(env.DATABASE_URL)
    .select({ id: schema.chore.id })
    .from(schema.chore)
    .where(and(eq(schema.chore.id, choreId), eq(schema.chore.organizationId, orgId)))
    .limit(1)
  return Boolean(row)
}

competitionRoutes.get('/:orgId/competitions', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  // active = live races; pending = sent/received invites awaiting accept; past = resolved/dead.
  const filter = c.req.query('status') ?? 'active'
  const statuses =
    filter === 'pending'
      ? ['pending']
      : filter === 'past'
        ? ['completed', 'declined', 'expired']
        : ['active']
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.competition)
    .where(and(eq(schema.competition.organizationId, orgId), inArray(schema.competition.status, statuses)))
    .orderBy(desc(schema.competition.createdAt))
    .limit(200)
  return c.json(rows)
})

competitionRoutes.get('/:orgId/competitions/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.competition)
    .where(and(eq(schema.competition.id, c.req.param('id')), eq(schema.competition.organizationId, orgId)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})

competitionRoutes.post('/:orgId/competitions', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  if (!canWithHousehold(ctx.mode, ctx.householdRole, 'competition:create', ctx.policy)) {
    return c.json({ error: 'forbidden — insufficient household permission' }, 403)
  }
  const db = getDb(c.env.DATABASE_URL)

  const parsed = competitionCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  if (d.opponentMemberId === ctx.memberId) return c.json({ error: 'cannot challenge yourself' }, 400)

  // The opponent must be a live member of THIS household.
  const [opponent] = await db
    .select({ id: schema.member.id, userId: schema.member.userId, isActive: schema.member.isActive })
    .from(schema.member)
    .where(and(eq(schema.member.id, d.opponentMemberId), eq(schema.member.organizationId, ctx.orgId)))
    .limit(1)
  if (!opponent || !opponent.isActive) return c.json({ error: 'opponent not found' }, 404)

  if (!(await choreOk(c.env, ctx.orgId, d.choreId))) return c.json({ error: 'invalid chore' }, 400)

  const stakesPoints = d.stakesPoints ?? 0
  // A family kid's wager is capped by the household's max-stakes setting (authoritative server-side).
  if (ctx.mode === 'family' && ctx.householdRole === 'kid' && stakesPoints > 0) {
    const [org] = await db
      .select({ maxKidCompetitionStakes: schema.organization.maxKidCompetitionStakes })
      .from(schema.organization)
      .where(eq(schema.organization.id, ctx.orgId))
      .limit(1)
    const cap = org?.maxKidCompetitionStakes ?? 0
    if (stakesPoints > cap) {
      return c.json({ error: `stakes exceed the kid limit of ${cap} points`, maxKidCompetitionStakes: cap }, 400)
    }
  }

  const endsAt = d.endsAt ? new Date(d.endsAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) {
    return c.json({ error: 'endsAt must be a future date' }, 400)
  }

  const [row] = await db
    .insert(schema.competition)
    .values({
      organizationId: ctx.orgId,
      challengerMemberId: ctx.memberId,
      opponentMemberId: opponent.id,
      title: d.title,
      competitionType: d.competitionType,
      targetValue: d.targetValue ?? null,
      choreId: d.choreId ?? null,
      stakesPoints,
      stakesDescription: d.stakesDescription ?? null,
      status: 'pending',
      endsAt,
    })
    .returning()

  await audit(c, {
    entityType: 'competition',
    entityId: row.id,
    action: 'competition.created',
    metadata: { competitionType: row.competitionType, stakesPoints, opponentMemberId: opponent.id },
  })
  // The opponent is notified to accept/decline (brief flow). Best-effort — never fails the create.
  if (opponent.userId) {
    await notify(db, c.env, {
      organizationId: ctx.orgId,
      userId: opponent.userId,
      kind: 'competition.challenged',
      title: 'You have been challenged!',
      body: row.title,
      entityType: 'competition',
      entityId: row.id,
    })
  }
  return c.json(row, 201)
})

type CompetitionRow = typeof schema.competition.$inferSelect
type OpponentPendingError = 'not_found' | 'forbidden' | 'conflict'
type OpponentPendingResult = { row: CompetitionRow; error: null } | { row: null; error: OpponentPendingError }

/** Load a pending competition this caller is the OPPONENT of (the only one who may accept/decline). */
async function loadOpponentPending(
  env: AuthEnv['Bindings'],
  orgId: string,
  id: string,
  opponentMemberId: string,
): Promise<OpponentPendingResult> {
  const [row] = await getDb(env.DATABASE_URL)
    .select()
    .from(schema.competition)
    .where(and(eq(schema.competition.id, id), eq(schema.competition.organizationId, orgId)))
    .limit(1)
  if (!row) return { row: null, error: 'not_found' }
  if (row.opponentMemberId !== opponentMemberId) return { row: null, error: 'forbidden' }
  if (row.status !== 'pending') return { row: null, error: 'conflict' }
  return { row, error: null }
}

competitionRoutes.post('/:orgId/competitions/:id/accept', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)

  const loaded = await loadOpponentPending(c.env, ctx.orgId, c.req.param('id'), ctx.memberId)
  if (loaded.error === 'not_found') return c.json({ error: 'not found' }, 404)
  if (loaded.error === 'forbidden') return c.json({ error: 'forbidden — only the opponent may accept' }, 403)
  if (loaded.error === 'conflict') return c.json({ error: 'not pending' }, 409)
  const { row } = loaded
  if (!row) return c.json({ error: 'not found' }, 404)

  // The race starts now; ends_at carries over from the challenge.
  const [updated] = await db
    .update(schema.competition)
    .set({ status: 'active', startsAt: new Date() })
    .where(
      and(
        eq(schema.competition.id, row.id),
        eq(schema.competition.organizationId, ctx.orgId),
        eq(schema.competition.status, 'pending'),
      ),
    )
    .returning()
  if (!updated) return c.json({ error: 'not pending' }, 409)

  await audit(c, { entityType: 'competition', entityId: row.id, action: 'competition.accepted' })
  // Tell the challenger it is on.
  const [challenger] = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.id, row.challengerMemberId))
    .limit(1)
  if (challenger?.userId) {
    await notify(db, c.env, {
      organizationId: ctx.orgId,
      userId: challenger.userId,
      kind: 'competition.accepted',
      title: 'Challenge accepted — game on!',
      body: row.title,
      entityType: 'competition',
      entityId: row.id,
    })
  }
  return c.json(updated)
})

competitionRoutes.post('/:orgId/competitions/:id/decline', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)

  const loaded = await loadOpponentPending(c.env, ctx.orgId, c.req.param('id'), ctx.memberId)
  if (loaded.error === 'not_found') return c.json({ error: 'not found' }, 404)
  if (loaded.error === 'forbidden') return c.json({ error: 'forbidden — only the opponent may decline' }, 403)
  if (loaded.error === 'conflict') return c.json({ error: 'not pending' }, 409)
  const { row } = loaded
  if (!row) return c.json({ error: 'not found' }, 404)

  const [updated] = await db
    .update(schema.competition)
    .set({ status: 'declined' })
    .where(
      and(
        eq(schema.competition.id, row.id),
        eq(schema.competition.organizationId, ctx.orgId),
        eq(schema.competition.status, 'pending'),
      ),
    )
    .returning()
  if (!updated) return c.json({ error: 'not pending' }, 409)

  await audit(c, { entityType: 'competition', entityId: row.id, action: 'competition.declined' })
  const [challenger] = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.id, row.challengerMemberId))
    .limit(1)
  if (challenger?.userId) {
    await notify(db, c.env, {
      organizationId: ctx.orgId,
      userId: challenger.userId,
      kind: 'competition.declined',
      title: 'Your challenge was declined',
      body: row.title,
      entityType: 'competition',
      entityId: row.id,
    })
  }
  return c.json(updated)
})
