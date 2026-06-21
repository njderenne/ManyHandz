import { Hono } from 'hono'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { resolveHousehold, type HouseholdEnv } from '../household'
import { can } from '@/lib/config/modes'
import { computePoints, type CompletionPhotos } from '@/lib/manyhandz/points'
import { todayInTz, compareDate } from '@/lib/manyhandz/dates'
import { awardCompletion } from '../manyhandz/completion-engine'

/**
 * Completions + approval — the centerpiece. Completing an assignment runs the CANONICAL points
 * engine; APPROVAL GATES POINTS (the brief's §11 fix): a family kid's completion is `pending_approval`
 * and writes NO ledger entry until a parent approves; everyone else auto-approves and the engine
 * awards instantly. Credit always goes to the ASSIGNEE.
 *
 *   POST /api/organizations/:orgId/assignments/:assignmentId/complete  → complete
 *   GET  /api/organizations/:orgId/completions?status=pending_approval → approval queue
 *   POST /api/organizations/:orgId/completions/:id/approve             → approve   (approveCompletions)
 *   POST /api/organizations/:orgId/completions/:id/reject  { reason }  → reject    (approveCompletions)
 */
export const completionRoutes = new Hono<HouseholdEnv>()

const completeInput = z.object({
  beforePhotoMediaId: z.string().max(64).nullish(),
  afterPhotoMediaId: z.string().max(64).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  actualMinutes: z.number().int().min(0).max(100000).nullish(),
})

function photosOf(before?: string | null, after?: string | null): CompletionPhotos {
  if (before && after) return 'both'
  if (before || after) return 'one'
  return 'none'
}

/** Active double-points multiplier for the household right now (×1 if none). */
async function activeMultiplier(env: HouseholdEnv['Bindings'], orgId: string): Promise<number> {
  const now = new Date()
  const [ch] = await getDb(env.DATABASE_URL)
    .select({ mult: schema.bonusChallenge.pointsMultiplier })
    .from(schema.bonusChallenge)
    .where(
      and(
        eq(schema.bonusChallenge.organizationId, orgId),
        eq(schema.bonusChallenge.status, 'active'),
        eq(schema.bonusChallenge.challengeType, 'double_points'),
        lte(schema.bonusChallenge.startsAt, now),
        gte(schema.bonusChallenge.endsAt, now),
      ),
    )
    .limit(1)
  return ch ? Math.max(1, ch.mult / 10) : 1
}

completionRoutes.post('/:orgId/assignments/:assignmentId/complete', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const assignmentId = c.req.param('assignmentId')

  const [a] = await db
    .select({
      id: schema.assignment.id,
      choreId: schema.assignment.choreId,
      assignedToMemberId: schema.assignment.assignedToMemberId,
      dueDate: schema.assignment.dueDate,
      status: schema.assignment.status,
      difficulty: schema.chore.difficulty,
      estimatedMinutes: schema.chore.estimatedMinutes,
      requiresApproval: schema.chore.requiresApproval,
    })
    .from(schema.assignment)
    .innerJoin(schema.chore, eq(schema.chore.id, schema.assignment.choreId))
    .where(and(eq(schema.assignment.id, assignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
    .limit(1)
  if (!a) return c.json({ error: 'not found' }, 404)
  if (a.status === 'completed' || a.status === 'pending_review') {
    return c.json({ error: 'already completed' }, 409)
  }

  // The assignee completes their own; an admin (assignChores) may complete on their behalf. Credit
  // always goes to the assignee.
  const isAssignee = a.assignedToMemberId === ctx.memberId
  if (!isAssignee && !can(ctx.mode, ctx.householdRole, 'assignChores')) return c.json({ error: 'forbidden' }, 403)

  const [assignee] = await db
    .select({ id: schema.member.id, userId: schema.member.userId, householdRole: schema.member.householdRole })
    .from(schema.member)
    .where(and(eq(schema.member.id, a.assignedToMemberId), eq(schema.member.organizationId, ctx.orgId)))
    .limit(1)
  if (!assignee?.userId) return c.json({ error: 'assignee not found' }, 404)

  const parsed = completeInput.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // Household config (timezone, requireApproval) for the points/approval calc.
  const [org] = await db
    .select({ timezone: schema.organization.timezone, requireApproval: schema.organization.requireApproval })
    .from(schema.organization)
    .where(eq(schema.organization.id, ctx.orgId))
    .limit(1)
  const tz = org?.timezone ?? 'America/New_York'

  // Pre-completion streak (the bonus reflects the streak AT completion time).
  const [streakRow] = await db
    .select({ current: schema.streak.currentCount })
    .from(schema.streak)
    .where(and(eq(schema.streak.organizationId, ctx.orgId), eq(schema.streak.userId, assignee.userId), eq(schema.streak.kind, 'chore')))
    .limit(1)

  const photos = photosOf(d.beforePhotoMediaId, d.afterPhotoMediaId)
  const breakdown = computePoints({
    difficulty: a.difficulty,
    estimatedMinutes: a.estimatedMinutes,
    actualMinutes: d.actualMinutes,
    currentStreak: streakRow?.current ?? 0,
    photos,
    early: compareDate(todayInTz(tz), a.dueDate) <= 0,
    challengeMultiplier: await activeMultiplier(c.env, ctx.orgId),
  })

  // Approval gates points: only a family KID's completion (with the household + chore both requiring
  // approval) waits — everyone else auto-approves.
  const needsApproval =
    ctx.mode === 'family' && assignee.householdRole === 'kid' && org?.requireApproval === true && a.requiresApproval === true

  const [completion] = await db
    .insert(schema.completion)
    .values({
      organizationId: ctx.orgId,
      assignmentId: a.id,
      completedByMemberId: assignee.id,
      beforePhotoMediaId: d.beforePhotoMediaId ?? null,
      afterPhotoMediaId: d.afterPhotoMediaId ?? null,
      notes: d.notes ?? null,
      actualMinutes: d.actualMinutes ?? null,
      pointsEarned: breakdown.total,
      speedBonus: breakdown.speedBonus,
      needsApproval,
      status: needsApproval ? 'pending_approval' : 'approved',
    })
    .returning()

  await db
    .update(schema.assignment)
    .set({ status: needsApproval ? 'pending_review' : 'completed' })
    .where(eq(schema.assignment.id, a.id))

  if (!needsApproval) {
    await awardCompletion(db, {
      orgId: ctx.orgId,
      timezone: tz,
      completionId: completion.id,
      completerUserId: assignee.userId,
      completerMemberId: assignee.id,
      choreId: a.choreId,
      points: breakdown.total,
    })
  }
  await audit(c, {
    entityType: 'completion',
    entityId: completion.id,
    action: needsApproval ? 'completion.pending_approval' : 'completion.approved',
    metadata: { points: breakdown.total },
  })
  return c.json({ completion, breakdown, needsApproval }, 201)
})

completionRoutes.get('/:orgId/completions', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const status = c.req.query('status') ?? 'pending_approval'
  const rows = await getDb(c.env.DATABASE_URL)
    .select({
      id: schema.completion.id,
      assignmentId: schema.completion.assignmentId,
      completedByMemberId: schema.completion.completedByMemberId,
      completedAt: schema.completion.completedAt,
      beforePhotoMediaId: schema.completion.beforePhotoMediaId,
      afterPhotoMediaId: schema.completion.afterPhotoMediaId,
      notes: schema.completion.notes,
      pointsEarned: schema.completion.pointsEarned,
      status: schema.completion.status,
      choreName: schema.chore.name,
      choreIcon: schema.chore.icon,
      referencePhotoMediaId: schema.chore.referencePhotoMediaId,
      memberName: schema.member.displayName,
    })
    .from(schema.completion)
    .innerJoin(schema.assignment, eq(schema.assignment.id, schema.completion.assignmentId))
    .innerJoin(schema.chore, eq(schema.chore.id, schema.assignment.choreId))
    .leftJoin(schema.member, eq(schema.member.id, schema.completion.completedByMemberId))
    .where(and(eq(schema.completion.organizationId, orgId), eq(schema.completion.status, status)))
    .orderBy(asc(schema.completion.createdAt))
    .limit(200)
  return c.json(rows)
})

async function loadPendingCompletion(env: HouseholdEnv['Bindings'], orgId: string, completionId: string) {
  const [row] = await getDb(env.DATABASE_URL)
    .select({
      id: schema.completion.id,
      assignmentId: schema.completion.assignmentId,
      completedByMemberId: schema.completion.completedByMemberId,
      pointsEarned: schema.completion.pointsEarned,
      status: schema.completion.status,
      choreId: schema.assignment.choreId,
    })
    .from(schema.completion)
    .innerJoin(schema.assignment, eq(schema.assignment.id, schema.completion.assignmentId))
    .where(and(eq(schema.completion.id, completionId), eq(schema.completion.organizationId, orgId)))
    .limit(1)
  return row
}

completionRoutes.post('/:orgId/completions/:id/approve', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'approveCompletions')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const comp = await loadPendingCompletion(c.env, ctx.orgId, c.req.param('id'))
  if (!comp) return c.json({ error: 'not found' }, 404)
  if (comp.status !== 'pending_approval') return c.json({ error: 'not pending approval' }, 409)

  const [assignee] = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.id, comp.completedByMemberId))
    .limit(1)
  if (!assignee?.userId) return c.json({ error: 'assignee not found' }, 404)

  const [org] = await db.select({ timezone: schema.organization.timezone }).from(schema.organization).where(eq(schema.organization.id, ctx.orgId)).limit(1)

  await db
    .update(schema.completion)
    .set({ status: 'approved', approvedByMemberId: ctx.memberId, approvedAt: new Date() })
    .where(eq(schema.completion.id, comp.id))
  await db.update(schema.assignment).set({ status: 'completed' }).where(eq(schema.assignment.id, comp.assignmentId))

  await awardCompletion(db, {
    orgId: ctx.orgId,
    timezone: org?.timezone ?? 'America/New_York',
    completionId: comp.id,
    completerUserId: assignee.userId,
    completerMemberId: comp.completedByMemberId,
    choreId: comp.choreId,
    points: comp.pointsEarned,
  })
  await audit(c, { entityType: 'completion', entityId: comp.id, action: 'completion.approved_by_parent' })
  return c.json({ ok: true })
})

completionRoutes.post('/:orgId/completions/:id/reject', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'approveCompletions')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const parsed = z.object({ reason: z.string().trim().min(1).max(300) }).safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'a rejection reason is required' }, 400)

  const comp = await loadPendingCompletion(c.env, ctx.orgId, c.req.param('id'))
  if (!comp) return c.json({ error: 'not found' }, 404)
  if (comp.status !== 'pending_approval') return c.json({ error: 'not pending approval' }, 409)

  await db
    .update(schema.completion)
    .set({ status: 'rejected', rejectionReason: parsed.data.reason, approvedByMemberId: ctx.memberId, approvedAt: new Date() })
    .where(eq(schema.completion.id, comp.id))
  // Back to in_progress so the kid can redo it (the "Try Again" loop). No points awarded.
  await db.update(schema.assignment).set({ status: 'in_progress' }).where(eq(schema.assignment.id, comp.assignmentId))
  await audit(c, { entityType: 'completion', entityId: comp.id, action: 'completion.rejected' })
  return c.json({ ok: true })
})
