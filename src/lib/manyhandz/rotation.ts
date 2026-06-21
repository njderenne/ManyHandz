/**
 * Auto-rotation — recurring chores rotate themselves among an ordered set of members and SKIP whoever
 * is away (the brief's vacation-safe rotation; the old app's brittle rotation that doubled/dropped on
 * missed days is exactly what this avoids). Pure (the cron drives it); the cron handles persistence.
 */

export type RotationFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly'
export const FREQUENCY_DAYS: Record<RotationFrequency, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 }

/** Whole days from a → b (both YYYY-MM-DD). Negative if b is before a. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const da = Date.UTC(ay, (am ?? 1) - 1, ad ?? 1)
  const db = Date.UTC(by, (bm ?? 1) - 1, bd ?? 1)
  return Math.round((db - da) / 86_400_000)
}

/** True when `today` lands exactly on an interval boundary from the group's startDate. Rotation only
 *  advances on boundary days — near-term assignments come from pre-generation, so the cron is sparse. */
export function isRotationDue(startDate: string, frequency: RotationFrequency, today: string): boolean {
  const diff = daysBetween(startDate, today)
  if (diff <= 0) return false
  return diff % FREQUENCY_DAYS[frequency] === 0
}

export type NextAssignee = { memberId: string; nextIndex: number }

/**
 * Resolve the next assignee for a rotation group, skipping away members.
 *  - fixed: always member_order[0]; if they're away, NO ONE is assigned (null).
 *  - round_robin: advance from currentIndex+1, wrapping, skipping away members; if everyone is away,
 *    skip the period (null) WITHOUT advancing the index, so the rotation resumes fairly next time.
 */
export function nextAssignee(opts: {
  memberOrder: string[]
  currentIndex: number
  rotationType: 'round_robin' | 'fixed'
  awayMemberIds: ReadonlySet<string>
}): NextAssignee | null {
  const { memberOrder, currentIndex, rotationType, awayMemberIds } = opts
  if (memberOrder.length === 0) return null

  if (rotationType === 'fixed') {
    const memberId = memberOrder[0]
    return awayMemberIds.has(memberId) ? null : { memberId, nextIndex: currentIndex }
  }

  for (let step = 1; step <= memberOrder.length; step++) {
    const idx = (currentIndex + step) % memberOrder.length
    const memberId = memberOrder[idx]
    if (!awayMemberIds.has(memberId)) return { memberId, nextIndex: idx }
  }
  return null // everyone is away — skip this period, index unchanged
}
