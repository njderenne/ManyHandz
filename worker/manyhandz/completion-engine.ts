import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { nextStreak } from '@/lib/manyhandz/points'
import { todayInTz, yesterdayOf } from '@/lib/manyhandz/dates'
import { POINTS_KIND, CHORE_STREAK_KIND } from '../routes/household'

type Db = ReturnType<typeof getDb>

export type AwardContext = {
  orgId: string
  timezone: string
  completionId: string
  completerUserId: string
  completerMemberId: string
  choreId: string
  /** Total points to award (already computed by the canonical engine). */
  points: number
}

/**
 * Award an APPROVED completion — the economic fan-out the old DB trigger did, re-homed into the
 * Worker so it's ONE coherent, server-authoritative path (called both on instant auto-approval and
 * on a parent's later approval). Idempotent: a credit-ledger idempotency key on the completion id
 * blocks a double-award if this ever runs twice, and short-circuits the streak/goal/competition
 * side effects too. Approval gates points — this is NEVER called for a pending_approval completion.
 */
export async function awardCompletion(db: Db, ctx: AwardContext): Promise<void> {
  // 1. Points → credit ledger (balance + XP). Idempotent on the completion id.
  const inserted = await db
    .insert(schema.creditLedger)
    .values({
      organizationId: ctx.orgId,
      userId: ctx.completerUserId,
      kind: POINTS_KIND,
      delta: ctx.points,
      reason: 'chore_completion',
      entityType: 'completion',
      entityId: ctx.completionId,
      idempotencyKey: `completion:${ctx.completionId}`,
    })
    .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })
    .returning({ id: schema.creditLedger.id })
  if (inserted.length === 0) return // already awarded — don't re-run side effects

  // 2. Daily streak (in the household timezone).
  const today = todayInTz(ctx.timezone)
  const yest = yesterdayOf(today)
  const [s] = await db
    .select()
    .from(schema.streak)
    .where(
      and(
        eq(schema.streak.organizationId, ctx.orgId),
        eq(schema.streak.userId, ctx.completerUserId),
        eq(schema.streak.kind, CHORE_STREAK_KIND),
      ),
    )
    .limit(1)
  if (s) {
    const nc = nextStreak(s.currentCount, s.lastActivityDate, today, yest)
    await db
      .update(schema.streak)
      .set({ currentCount: nc, longestCount: Math.max(s.longestCount, nc), lastActivityDate: today })
      .where(eq(schema.streak.id, s.id))
  } else {
    await db.insert(schema.streak).values({
      organizationId: ctx.orgId,
      userId: ctx.completerUserId,
      kind: CHORE_STREAK_KIND,
      currentCount: 1,
      longestCount: 1,
      lastActivityDate: today,
    })
  }

  // 3. Activity feed.
  await db.insert(schema.activityLog).values({
    organizationId: ctx.orgId,
    userId: ctx.completerUserId,
    entityType: 'completion',
    entityId: ctx.completionId,
    action: 'chore_completed',
    metadata: { points: ctx.points },
  })

  // 4. Goal auto-contribute — a % of the earned points into each of the member's active auto-save
  //    goals (the contribution spends points from the balance and moves them into the goal).
  const goals = await db
    .select()
    .from(schema.goal)
    .where(
      and(
        eq(schema.goal.organizationId, ctx.orgId),
        eq(schema.goal.memberId, ctx.completerMemberId),
        eq(schema.goal.status, 'active'),
        eq(schema.goal.autoContributeEnabled, true),
      ),
    )
  for (const g of goals) {
    const contribution = Math.floor((ctx.points * g.autoContributePercentage) / 100)
    if (contribution <= 0) continue
    await db.insert(schema.goalContribution).values({
      organizationId: ctx.orgId,
      goalId: g.id,
      memberId: ctx.completerMemberId,
      points: contribution,
      source: 'chore_completion',
      sourceId: ctx.completionId,
    })
    const newCurrent = g.currentPoints + contribution
    const completed = newCurrent >= g.targetPoints
    await db
      .update(schema.goal)
      .set({ currentPoints: newCurrent, status: completed ? 'completed' : 'active', completedAt: completed ? new Date() : null })
      .where(eq(schema.goal.id, g.id))
    await db.insert(schema.creditLedger).values({
      organizationId: ctx.orgId,
      userId: ctx.completerUserId,
      kind: POINTS_KIND,
      delta: -contribution,
      reason: 'goal_auto_contribute',
      entityType: 'goal',
      entityId: g.id,
    })
  }

  // 5. Competition progress — advance any ACTIVE competition this member is in. The competitions
  //    cron resolves winners + transfers stakes at ends_at; here we just keep the live tally.
  const comps = await db
    .select()
    .from(schema.competition)
    .where(and(eq(schema.competition.organizationId, ctx.orgId), eq(schema.competition.status, 'active')))
  for (const comp of comps) {
    const isChallenger = comp.challengerMemberId === ctx.completerMemberId
    const isOpponent = comp.opponentMemberId === ctx.completerMemberId
    if (!isChallenger && !isOpponent) continue
    if (comp.competitionType === 'specific_chore_race' && comp.choreId !== ctx.choreId) continue
    const inc =
      comp.competitionType === 'most_points' || comp.competitionType === 'first_to_target' ? ctx.points : 1
    await db
      .update(schema.competition)
      .set(
        isChallenger
          ? { challengerProgress: comp.challengerProgress + inc }
          : { opponentProgress: comp.opponentProgress + inc },
      )
      .where(eq(schema.competition.id, comp.id))
  }
}
