import { Hono } from 'hono'
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg } from '../middleware/org'
import { requireTier } from '../entitlements'
import { type HouseholdEnv } from '../household'
import { computeFairness, type MemberContribution } from '@/lib/manyhandz/fairness'
import { todayInTz, shiftDate, compareDate } from '@/lib/manyhandz/dates'

/**
 * Fairness — the effort-weighted balance report, and the universal ManyHandz feature (the roommate
 * hero, present in every mode). Org-scoped READ only: every member sees the household's fairness.
 *
 * Each ACTIVE member's effort = SUM(completion.pointsEarned + completion.speedBonus) over completions
 * counted as done (status in approved / ai_approved), joined to their assignment via
 * assignment.assignedToMemberId, within the requested period (by completion.completedAt in the
 * household timezone). Members who are AWAY (member.awayUntil >= today) are EXCLUDED before the math
 * runs — fairness only weighs people who could actually contribute (brief §5.11, §away). The pure
 * engine in src/lib/manyhandz/fairness.ts owns the math; this route only gathers the inputs.
 *
 *   GET /api/organizations/:orgId/fairness?period=this_week|last_week|this_month|last_month|all_time
 *
 * Pairs with src/lib/query/hooks/useFairness.ts.
 */
export const fairnessRoutes = new Hono<HouseholdEnv>()

/** Completion statuses that COUNT toward effort (a rejected / pending_approval completion does not). */
const COUNTED_STATUSES = ['approved', 'ai_approved'] as const

const PERIODS = ['this_week', 'last_week', 'this_month', 'last_month', 'all_time'] as const
type Period = (typeof PERIODS)[number]

const querySchema = z.object({
  period: z.enum(PERIODS).default('this_week'),
})

/** Monday-anchored start of the ISO week containing `ymd` (YYYY-MM-DD). */
function startOfWeek(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12))
  const dow = dt.getUTCDay() // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7
  return shiftDate(ymd, -backToMonday)
}

/** First day of the month containing `ymd` (YYYY-MM-DD). */
function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`
}

/**
 * Resolve a period name into an inclusive [from, to] YYYY-MM-DD range in the household timezone.
 * `all_time` returns null bounds (no date filter). `to` is the last day INCLUDED.
 */
function rangeFor(period: Period, today: string): { from: string | null; to: string | null } {
  switch (period) {
    case 'this_week': {
      const from = startOfWeek(today)
      return { from, to: shiftDate(from, 6) }
    }
    case 'last_week': {
      const from = shiftDate(startOfWeek(today), -7)
      return { from, to: shiftDate(from, 6) }
    }
    case 'this_month': {
      const from = startOfMonth(today)
      return { from, to: shiftDate(startOfMonth(shiftDate(from, 31)), -1) }
    }
    case 'last_month': {
      const thisMonthStart = startOfMonth(today)
      const from = startOfMonth(shiftDate(thisMonthStart, -1))
      return { from, to: shiftDate(thisMonthStart, -1) }
    }
    case 'all_time':
      return { from: null, to: null }
  }
}

fairnessRoutes.get('/:orgId/fairness', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const parsed = querySchema.safeParse({ period: c.req.query('period') })
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const period = parsed.data.period

  const db = getDb(c.env.DATABASE_URL)

  // Paid: the fairness / effort-balance report is a Premium feature (history & insights).
  const gate = await requireTier(db, orgId, 'STANDARD')
  if (!gate.ok) return c.json({ error: gate.reason }, 402)

  // Household timezone — day boundaries (period range, "away") are in the household's tz, not UTC.
  const [org] = await db
    .select({ timezone: schema.organization.timezone })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  const tz = org?.timezone ?? 'America/New_York'
  const today = todayInTz(tz)
  const { from, to } = rangeFor(period, today)

  // Active, NOT-away members. away = awayUntil set and still in the future (>= today); those are
  // excluded from fairness entirely so the balance only weighs people who could contribute.
  const members = await db
    .select({
      memberId: schema.member.id,
      displayName: schema.member.displayName,
      awayUntil: schema.member.awayUntil,
    })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.isActive, true)))

  const activeMembers = members.filter((m) => !(m.awayUntil && compareDate(m.awayUntil, today) >= 0))
  const activeMemberIds = activeMembers.map((m) => m.memberId)

  // Per-member effort = SUM(pointsEarned + speedBonus) over counted completions in the period,
  // credited to the ASSIGNEE (assignment.assignedToMemberId). The date filter is on completedAt,
  // converted to a YYYY-MM-DD in the household tz so it matches the period's day boundaries.
  const completedDay = sql<string>`to_char(${schema.completion.completedAt} at time zone ${tz}, 'YYYY-MM-DD')`
  const conditions = [
    eq(schema.completion.organizationId, orgId),
    inArray(schema.completion.status, [...COUNTED_STATUSES]),
  ]
  if (activeMemberIds.length > 0) conditions.push(inArray(schema.assignment.assignedToMemberId, activeMemberIds))
  if (from) conditions.push(gte(completedDay, from))
  if (to) conditions.push(lte(completedDay, to))

  const effortRows =
    activeMemberIds.length === 0
      ? []
      : await db
          .select({
            memberId: schema.assignment.assignedToMemberId,
            effort: sql<string>`coalesce(sum(${schema.completion.pointsEarned} + ${schema.completion.speedBonus}), 0)`,
          })
          .from(schema.completion)
          .innerJoin(schema.assignment, eq(schema.assignment.id, schema.completion.assignmentId))
          .where(and(...conditions))
          .groupBy(schema.assignment.assignedToMemberId)

  const effortByMember = new Map(effortRows.map((r) => [r.memberId, Number(r.effort)]))

  // Every active member appears (zero effort if they did nothing in the period) so the household
  // count — and therefore the ideal share — is correct.
  const contributions: MemberContribution[] = activeMembers.map((m) => ({
    memberId: m.memberId,
    points: effortByMember.get(m.memberId) ?? 0,
  }))

  const fairness = computeFairness(contributions)

  // Display names for the client (the engine is pure ids/points). Falls back to a friendly default.
  const memberNames: Record<string, string> = {}
  for (const m of activeMembers) memberNames[m.memberId] = m.displayName ?? 'Member'

  // Zero-overdue household streak (cheap): consecutive recent days with no overdue assignment. If
  // anything is overdue right now the streak is 0; otherwise it runs from the day after the most
  // recent overdue assignment's due date (capped to "since the household's first assignment").
  const [latestOverdue] = await db
    .select({ dueDate: schema.assignment.dueDate })
    .from(schema.assignment)
    .where(and(eq(schema.assignment.organizationId, orgId), eq(schema.assignment.status, 'overdue')))
    .orderBy(desc(schema.assignment.dueDate))
    .limit(1)

  let zeroOverdueStreakDays: number
  if (latestOverdue) {
    zeroOverdueStreakDays = 0
  } else {
    const [earliest] = await db
      .select({ dueDate: schema.assignment.dueDate })
      .from(schema.assignment)
      .where(eq(schema.assignment.organizationId, orgId))
      .orderBy(schema.assignment.dueDate)
      .limit(1)
    zeroOverdueStreakDays = earliest ? daysBetween(earliest.dueDate, today) : 0
  }

  return c.json({
    period,
    range: { from, to },
    fairness,
    memberNames,
    activeMemberCount: activeMembers.length,
    zeroOverdueStreakDays,
  })
})

/** Whole days from a → b (both YYYY-MM-DD), clamped at 0. */
function daysBetween(a: string, b: string): number {
  if (compareDate(a, b) > 0) return 0
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const start = Date.UTC(ay, (am ?? 1) - 1, ad ?? 1, 12)
  const end = Date.UTC(by, (bm ?? 1) - 1, bd ?? 1, 12)
  return Math.max(0, Math.round((end - start) / 86400000))
}
