import { Hono } from 'hono'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { resolveHousehold, type HouseholdEnv } from '../household'
import { canWithHousehold } from '@/lib/config/modes'
import { POINTS_KIND } from './household'

/**
 * Goals — point-savings goals (family gamification). A member saves toward a target; chore
 * completions auto-contribute a % (handled in completion-engine.ts — NOT here), and a member can
 * manually contribute from their balance via POST /:id/contribute (a NEGATIVE creditLedger spend
 * moves points off the balance and into the goal's currentPoints, completing it at target).
 *
 * Authorization (mode matrix, server-authoritative):
 *   - Reads: any household member (org-scoped).
 *   - Create for self: `contributeToOwnGoals` (parent + kid). A KID-created goal starts
 *     status=pending_approval; a parent approves it -> active.
 *   - Create for ANYONE (targeting another member): `createGoalsForAnyone` (parent only), starts active.
 *   - Edit / cancel / approve: `createGoalsForAnyone` (parent admin).
 *   - Contribute to own goal: `contributeToOwnGoals`.
 *
 * Points always flow through the credit ledger (balance = SUM(delta)); a contribution is a negative
 * `goal_contribution` delta. Pairs with src/lib/query/hooks/useGoals.ts.
 *
 *   GET    /api/organizations/:orgId/goals                  → goals, newest first
 *   GET    /api/organizations/:orgId/goals/:goalId          → one goal + contribution history
 *   POST   /api/organizations/:orgId/goals                  → create (self, or anyone for a parent)
 *   PATCH  /api/organizations/:orgId/goals/:goalId          → edit          (createGoalsForAnyone)
 *   POST   /api/organizations/:orgId/goals/:goalId/approve  → approve a kid goal (createGoalsForAnyone)
 *   POST   /api/organizations/:orgId/goals/:goalId/cancel   → cancel        (createGoalsForAnyone)
 *   POST   /api/organizations/:orgId/goals/:goalId/contribute { points } → contribute from balance
 */
export const goalRoutes = new Hono<HouseholdEnv>()

const goalCreate = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
  icon: z.string().max(40).optional(),
  targetPoints: z.number().int().min(1).max(1_000_000),
  monetaryValueCents: z.number().int().min(0).max(100_000_000).nullish(),
  autoContributeEnabled: z.boolean().optional(),
  autoContributePercentage: z.number().int().min(0).max(100).optional(),
  /** Parents only (createGoalsForAnyone) — target another member. Omit/self → the caller's own goal. */
  memberId: z.string().max(64).optional(),
})

const goalUpdate = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable(),
    icon: z.string().max(40),
    targetPoints: z.number().int().min(1).max(1_000_000),
    monetaryValueCents: z.number().int().min(0).max(100_000_000).nullable(),
    autoContributeEnabled: z.boolean(),
    autoContributePercentage: z.number().int().min(0).max(100),
  })
  .partial()

const contributeInput = z.object({ points: z.number().int().min(1).max(1_000_000) })

/** Confirm a member belongs to this household (used when a parent targets another member). */
async function memberInHousehold(env: HouseholdEnv['Bindings'], orgId: string, memberId: string) {
  const [m] = await getDb(env.DATABASE_URL)
    .select({ id: schema.member.id, userId: schema.member.userId })
    .from(schema.member)
    .where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, orgId)))
    .limit(1)
  return m ?? null
}

/** Current points balance for a user in this org (balance = SUM(creditLedger.delta) over POINTS_KIND). */
async function pointsBalance(env: HouseholdEnv['Bindings'], orgId: string, userId: string): Promise<number> {
  const [row] = await getDb(env.DATABASE_URL)
    .select({ balance: sql`coalesce(sum(${schema.creditLedger.delta}), 0)`.mapWith(Number) })
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.organizationId, orgId),
        eq(schema.creditLedger.userId, userId),
        eq(schema.creditLedger.kind, POINTS_KIND),
      ),
    )
  return row?.balance ?? 0
}

goalRoutes.get('/:orgId/goals', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.goal)
    .where(eq(schema.goal.organizationId, orgId))
    .orderBy(desc(schema.goal.createdAt))
  return c.json(rows)
})

goalRoutes.get('/:orgId/goals/:goalId', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const goalId = c.req.param('goalId')
  const db = getDb(c.env.DATABASE_URL)
  const [row] = await db
    .select()
    .from(schema.goal)
    .where(and(eq(schema.goal.id, goalId), eq(schema.goal.organizationId, orgId)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  const contributions = await db
    .select()
    .from(schema.goalContribution)
    .where(and(eq(schema.goalContribution.goalId, goalId), eq(schema.goalContribution.organizationId, orgId)))
    .orderBy(asc(schema.goalContribution.createdAt))
  return c.json({ ...row, contributions })
})

goalRoutes.post('/:orgId/goals', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const parsed = goalCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // Who is this goal FOR? Default = self. Targeting another member requires createGoalsForAnyone.
  const targetMemberId = d.memberId ?? ctx.memberId
  const forAnyone = targetMemberId !== ctx.memberId
  if (forAnyone) {
    if (!canWithHousehold(ctx.mode, ctx.householdRole, 'createGoalsForAnyone', ctx.policy)) {
      return c.json({ error: 'forbidden — only a parent can create goals for others' }, 403)
    }
    if (!(await memberInHousehold(c.env, ctx.orgId, targetMemberId))) {
      return c.json({ error: 'invalid member' }, 400)
    }
  } else {
    // Self goal: needs the base self-permission (parent or kid).
    if (!canWithHousehold(ctx.mode, ctx.householdRole, 'contributeToOwnGoals', ctx.policy)) {
      return c.json({ error: 'forbidden' }, 403)
    }
  }

  // A kid creating a goal for THEMSELVES starts pending_approval (a parent approves → active);
  // a parent's goal (own or for-anyone) is active immediately.
  const canApprove = canWithHousehold(ctx.mode, ctx.householdRole, 'createGoalsForAnyone', ctx.policy)
  const needsApproval = !canApprove

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.goal)
    .values({
      organizationId: ctx.orgId,
      memberId: targetMemberId,
      title: d.title,
      description: d.description ?? null,
      icon: d.icon ?? 'target',
      targetPoints: d.targetPoints,
      monetaryValueCents: d.monetaryValueCents ?? null,
      autoContributeEnabled: d.autoContributeEnabled ?? false,
      autoContributePercentage: d.autoContributePercentage ?? 25,
      status: needsApproval ? 'pending_approval' : 'active',
      createdByMemberId: ctx.memberId,
    })
    .returning()
  await audit(c, {
    entityType: 'goal',
    entityId: row.id,
    action: needsApproval ? 'goal.pending_approval' : 'goal.created',
    metadata: { title: row.title, memberId: targetMemberId },
  })
  return c.json(row, 201)
})

goalRoutes.patch('/:orgId/goals/:goalId', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !canWithHousehold(ctx.mode, ctx.householdRole, 'createGoalsForAnyone', ctx.policy)) {
    return c.json({ error: 'forbidden' }, 403)
  }
  const goalId = c.req.param('goalId')
  const parsed = goalUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  const updates: Partial<typeof schema.goal.$inferInsert> = {}
  if (d.title !== undefined) updates.title = d.title
  if (d.description !== undefined) updates.description = d.description ?? null
  if (d.icon !== undefined) updates.icon = d.icon
  if (d.targetPoints !== undefined) updates.targetPoints = d.targetPoints
  if (d.monetaryValueCents !== undefined) updates.monetaryValueCents = d.monetaryValueCents ?? null
  if (d.autoContributeEnabled !== undefined) updates.autoContributeEnabled = d.autoContributeEnabled
  if (d.autoContributePercentage !== undefined) updates.autoContributePercentage = d.autoContributePercentage
  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.goal)
    .set(updates)
    .where(and(eq(schema.goal.id, goalId), eq(schema.goal.organizationId, ctx.orgId)))
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'goal', entityId: row.id, action: 'goal.updated' })
  return c.json(row)
})

goalRoutes.post('/:orgId/goals/:goalId/approve', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !canWithHousehold(ctx.mode, ctx.householdRole, 'createGoalsForAnyone', ctx.policy)) {
    return c.json({ error: 'forbidden' }, 403)
  }
  const goalId = c.req.param('goalId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.goal)
    .set({ status: 'active' })
    .where(
      and(
        eq(schema.goal.id, goalId),
        eq(schema.goal.organizationId, ctx.orgId),
        eq(schema.goal.status, 'pending_approval'),
      ),
    )
    .returning()
  if (!row) return c.json({ error: 'not pending approval' }, 404)
  await audit(c, { entityType: 'goal', entityId: row.id, action: 'goal.approved' })
  return c.json(row)
})

goalRoutes.post('/:orgId/goals/:goalId/cancel', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !canWithHousehold(ctx.mode, ctx.householdRole, 'createGoalsForAnyone', ctx.policy)) {
    return c.json({ error: 'forbidden' }, 403)
  }
  const goalId = c.req.param('goalId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.goal)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(schema.goal.id, goalId),
        eq(schema.goal.organizationId, ctx.orgId),
        sql`${schema.goal.status} in ('active', 'pending_approval')`,
      ),
    )
    .returning({ id: schema.goal.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'goal', entityId: goalId, action: 'goal.canceled' })
  return c.json({ ok: true })
})

/**
 * Contribute points from the contributor's OWN balance into a goal. The contributor is the caller;
 * the points are deducted via a NEGATIVE creditLedger row (reason=goal_contribution), a
 * goalContribution row is inserted, and goal.currentPoints is bumped — completing the goal at target.
 *
 * Balance check + insert are two statements over the HTTP driver (no transaction): worst case is a
 * briefly-negative balance under concurrent spends — acceptable for engagement points (see
 * worker/credits.ts spendCredits RACE CAVEAT).
 */
goalRoutes.post('/:orgId/goals/:goalId/contribute', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !canWithHousehold(ctx.mode, ctx.householdRole, 'contributeToOwnGoals', ctx.policy)) {
    return c.json({ error: 'forbidden' }, 403)
  }
  const db = getDb(c.env.DATABASE_URL)
  const goalId = c.req.param('goalId')
  const parsed = contributeInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const { points } = parsed.data

  const [goal] = await db
    .select()
    .from(schema.goal)
    .where(and(eq(schema.goal.id, goalId), eq(schema.goal.organizationId, ctx.orgId)))
    .limit(1)
  if (!goal) return c.json({ error: 'not found' }, 404)
  if (goal.status !== 'active') return c.json({ error: 'goal is not active' }, 409)

  // Resolve the contributor's userId (creditLedger is user-scoped; the goal is member-scoped).
  const [me] = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(and(eq(schema.member.id, ctx.memberId), eq(schema.member.organizationId, ctx.orgId)))
    .limit(1)
  if (!me?.userId) return c.json({ error: 'member not found' }, 404)

  const balance = await pointsBalance(c.env, ctx.orgId, me.userId)
  if (balance < points) return c.json({ error: 'insufficient_balance' }, 400)

  // 1. Deduct from the balance (NEGATIVE delta).
  await db.insert(schema.creditLedger).values({
    organizationId: ctx.orgId,
    userId: me.userId,
    kind: POINTS_KIND,
    delta: -points,
    reason: 'goal_contribution',
    entityType: 'goal',
    entityId: goal.id,
  })
  // 2. Record the contribution.
  await db.insert(schema.goalContribution).values({
    organizationId: ctx.orgId,
    goalId: goal.id,
    memberId: ctx.memberId,
    points,
    source: 'manual',
  })
  // 3. Bump the goal; complete it at/over target.
  const newCurrent = goal.currentPoints + points
  const completed = newCurrent >= goal.targetPoints
  const [updated] = await db
    .update(schema.goal)
    .set({
      currentPoints: newCurrent,
      status: completed ? 'completed' : 'active',
      completedAt: completed ? new Date() : null,
    })
    .where(and(eq(schema.goal.id, goal.id), eq(schema.goal.organizationId, ctx.orgId)))
    .returning()
  await audit(c, {
    entityType: 'goal',
    entityId: goal.id,
    action: completed ? 'goal.completed' : 'goal.contributed',
    metadata: { points, currentPoints: newCurrent },
  })
  return c.json({ goal: updated, contributed: points, completed }, 201)
})
