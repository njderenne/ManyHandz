import { and, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { todayInTz, shiftDate } from '@/lib/manyhandz/dates'
import { isRotationDue, nextAssignee, FREQUENCY_DAYS, type RotationFrequency } from '@/lib/manyhandz/rotation'
import { POINTS_KIND, CHORE_STREAK_KIND } from '../routes/household'

type Db = ReturnType<typeof getDb>

/**
 * ManyHandz scheduled jobs — driven by the 6h cron in worker/cron.ts. Each is org-timezone aware
 * (day boundaries differ per household) and idempotent where it moves points. Kept sparse: near-term
 * assignments come from creation, so rotation only acts on interval boundaries.
 */

/** Advance every active rotation group that lands on an interval boundary today, minting the next
 *  assignment and skipping away members (the vacation-safe rotation). */
export async function runRotation(db: Db): Promise<number> {
  const groups = await db
    .select({
      id: schema.rotationGroup.id,
      organizationId: schema.rotationGroup.organizationId,
      choreId: schema.rotationGroup.choreId,
      memberOrder: schema.rotationGroup.memberOrder,
      currentIndex: schema.rotationGroup.currentIndex,
      rotationType: schema.rotationGroup.rotationType,
      frequency: schema.rotationGroup.frequency,
      startDate: schema.rotationGroup.startDate,
      timezone: schema.organization.timezone,
    })
    .from(schema.rotationGroup)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.rotationGroup.organizationId))
    .where(eq(schema.rotationGroup.isActive, true))

  let created = 0
  for (const g of groups) {
    const today = todayInTz(g.timezone)
    if (!isRotationDue(g.startDate, g.frequency as RotationFrequency, today)) continue

    const awayRows = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, g.organizationId),
          or(eq(schema.member.isActive, false), and(isNotNull(schema.member.awayUntil), gte(schema.member.awayUntil, today))),
        ),
      )
    const away = new Set(awayRows.map((r) => r.id))

    const next = nextAssignee({
      memberOrder: g.memberOrder,
      currentIndex: g.currentIndex,
      rotationType: g.rotationType === 'fixed' ? 'fixed' : 'round_robin',
      awayMemberIds: away,
    })
    if (!next) continue // everyone away — skip this period, index unchanged

    const dueDate = shiftDate(today, FREQUENCY_DAYS[g.frequency as RotationFrequency])
    await db.insert(schema.assignment).values({
      organizationId: g.organizationId,
      choreId: g.choreId,
      assignedToMemberId: next.memberId,
      rotationGroupId: g.id,
      dueDate,
      originalDueDate: dueDate,
      status: 'pending',
    })
    await db.update(schema.rotationGroup).set({ currentIndex: next.nextIndex }).where(eq(schema.rotationGroup.id, g.id))
    created++
  }
  return created
}

/** Flip past-due assignments to overdue (per household tz) and reset those members' chore streaks. */
export async function runOverdue(db: Db): Promise<number> {
  const orgs = await db.select({ id: schema.organization.id, timezone: schema.organization.timezone }).from(schema.organization)
  let flipped = 0
  for (const o of orgs) {
    const today = todayInTz(o.timezone)
    const due = await db
      .update(schema.assignment)
      .set({ status: 'overdue' })
      .where(
        and(
          eq(schema.assignment.organizationId, o.id),
          inArray(schema.assignment.status, ['pending', 'in_progress']),
          lt(schema.assignment.dueDate, today),
        ),
      )
      .returning({ assignedToMemberId: schema.assignment.assignedToMemberId })
    if (due.length === 0) continue
    flipped += due.length

    const memberIds = [...new Set(due.map((d) => d.assignedToMemberId))]
    const members = await db
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(inArray(schema.member.id, memberIds))
    const userIds = members.map((m) => m.userId).filter((u): u is string => Boolean(u))
    if (userIds.length > 0) {
      await db
        .update(schema.streak)
        .set({ currentCount: 0 })
        .where(
          and(
            eq(schema.streak.organizationId, o.id),
            eq(schema.streak.kind, CHORE_STREAK_KIND),
            inArray(schema.streak.userId, userIds),
          ),
        )
    }
  }
  return flipped
}

/** Resolve finished competitions: pick the winner by progress (ties = no transfer) and move stakes
 *  via the ledger (winner +stakes, loser −stakes floored at 0). Idempotent on the competition id. */
export async function runCompetitions(db: Db): Promise<number> {
  const now = new Date()
  const comps = await db
    .select()
    .from(schema.competition)
    .where(and(eq(schema.competition.status, 'active'), lt(schema.competition.endsAt, now)))

  for (const comp of comps) {
    let winnerId: string | null = null
    if (comp.challengerProgress > comp.opponentProgress) winnerId = comp.challengerMemberId
    else if (comp.opponentProgress > comp.challengerProgress) winnerId = comp.opponentMemberId

    await db.update(schema.competition).set({ status: 'completed', winnerMemberId: winnerId }).where(eq(schema.competition.id, comp.id))

    if (winnerId && comp.stakesPoints > 0) {
      const loserId = winnerId === comp.challengerMemberId ? comp.opponentMemberId : comp.challengerMemberId
      const ms = await db
        .select({ id: schema.member.id, userId: schema.member.userId })
        .from(schema.member)
        .where(inArray(schema.member.id, [winnerId, loserId]))
      const winnerUser = ms.find((m) => m.id === winnerId)?.userId
      const loserUser = ms.find((m) => m.id === loserId)?.userId

      if (winnerUser) {
        await db
          .insert(schema.creditLedger)
          .values({
            organizationId: comp.organizationId,
            userId: winnerUser,
            kind: POINTS_KIND,
            delta: comp.stakesPoints,
            reason: 'competition_stakes',
            entityType: 'competition',
            entityId: comp.id,
            idempotencyKey: `comp_win:${comp.id}`,
          })
          .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })
      }
      if (loserUser) {
        const [bal] = await db
          .select({ b: sql<string>`coalesce(sum(${schema.creditLedger.delta}), 0)` })
          .from(schema.creditLedger)
          .where(and(eq(schema.creditLedger.organizationId, comp.organizationId), eq(schema.creditLedger.userId, loserUser), eq(schema.creditLedger.kind, POINTS_KIND)))
        const deduct = Math.min(comp.stakesPoints, Number(bal?.b ?? 0))
        if (deduct > 0) {
          await db
            .insert(schema.creditLedger)
            .values({
              organizationId: comp.organizationId,
              userId: loserUser,
              kind: POINTS_KIND,
              delta: -deduct,
              reason: 'competition_stakes',
              entityType: 'competition',
              entityId: comp.id,
              idempotencyKey: `comp_lose:${comp.id}`,
            })
            .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })
        }
      }
    }
  }
  return comps.length
}

/** Close out finished challenges. (Full success-criteria evaluation + bonus payout is a follow-up;
 *  for now expired challenges stop multiplying points.) */
export async function runChallenges(db: Db): Promise<number> {
  const now = new Date()
  const done = await db
    .update(schema.bonusChallenge)
    .set({ status: 'expired' })
    .where(and(eq(schema.bonusChallenge.status, 'active'), lt(schema.bonusChallenge.endsAt, now)))
    .returning({ id: schema.bonusChallenge.id })
  return done.length
}
