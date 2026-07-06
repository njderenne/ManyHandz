import { describe, it, expect } from 'vitest'
import { computeStreakFromEvents, pointsSummary, type StreakEvent } from './streak-points'

/**
 * Streak/points derivation engine — pure functions, so the tests ARE the spec: distinct-day
 * folding, grace gaps, broken-on-read, timezone day boundaries, and the windowed ledger math.
 */

/** Events at UTC noon on each YYYY-MM-DD — noon keeps them on the same day in most zones. */
function days(...isoDates: string[]): StreakEvent[] {
  return isoDates.map((d) => ({ at: new Date(`${d}T12:00:00Z`) }))
}

const NOW = new Date('2026-07-05T12:00:00Z')

describe('computeStreakFromEvents', () => {
  it('returns the zero state for no events', () => {
    expect(computeStreakFromEvents([], { now: NOW })).toEqual({
      currentCount: 0,
      longestCount: 0,
      lastActivityDate: null,
      activeDays: 0,
    })
  })

  it('counts consecutive days ending today as the current streak', () => {
    const streak = computeStreakFromEvents(days('2026-07-03', '2026-07-04', '2026-07-05'), {
      now: NOW,
    })
    expect(streak.currentCount).toBe(3)
    expect(streak.longestCount).toBe(3)
    expect(streak.lastActivityDate).toBe('2026-07-05')
    expect(streak.activeDays).toBe(3)
  })

  it('folds multiple events on one day into one active day', () => {
    const events = [
      { at: new Date('2026-07-05T01:00:00Z') },
      { at: new Date('2026-07-05T12:00:00Z') },
      { at: new Date('2026-07-05T23:00:00Z') },
    ]
    const streak = computeStreakFromEvents(events, { now: NOW })
    expect(streak.currentCount).toBe(1)
    expect(streak.activeDays).toBe(1)
  })

  it('a streak ending yesterday is still alive (streaks.ts semantics)', () => {
    const streak = computeStreakFromEvents(days('2026-07-03', '2026-07-04'), { now: NOW })
    expect(streak.currentCount).toBe(2)
  })

  it('a streak ending before yesterday reads as 0 — broken on READ, longest survives', () => {
    const streak = computeStreakFromEvents(days('2026-07-01', '2026-07-02', '2026-07-03'), {
      now: NOW,
    })
    expect(streak.currentCount).toBe(0)
    expect(streak.longestCount).toBe(3)
    expect(streak.lastActivityDate).toBe('2026-07-03')
  })

  it('a gap resets the run; longest tracks the best run anywhere', () => {
    const streak = computeStreakFromEvents(
      days('2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23', '2026-07-04', '2026-07-05'),
      { now: NOW },
    )
    expect(streak.currentCount).toBe(2)
    expect(streak.longestCount).toBe(4)
    expect(streak.activeDays).toBe(6)
  })

  it('graceDays 1 bridges a single missed day (run AND aliveness)', () => {
    // Active 07-01, 07-02, skip 07-03, active 07-04 — grace bridges the hole; count is active
    // DAYS (3), not the calendar span (4). Last active 07-04 vs today 07-05 is within grace.
    const streak = computeStreakFromEvents(days('2026-07-01', '2026-07-02', '2026-07-04'), {
      now: NOW,
      graceDays: 1,
    })
    expect(streak.currentCount).toBe(3)
    expect(streak.longestCount).toBe(3)
  })

  it('graceDays 0 breaks over the same hole', () => {
    const streak = computeStreakFromEvents(days('2026-07-01', '2026-07-02', '2026-07-04'), {
      now: NOW,
      graceDays: 0,
    })
    expect(streak.currentCount).toBe(1) // the run ending 07-04 alone; alive (yesterday)
    expect(streak.longestCount).toBe(2)
  })

  it('day boundaries follow the given timezone', () => {
    // 2026-07-05T03:00Z is 07-04 in Chicago (UTC-5) but 07-05 in UTC.
    const events = [{ at: new Date('2026-07-05T03:00:00Z') }]
    expect(
      computeStreakFromEvents(events, { now: NOW, timezone: 'America/Chicago' }).lastActivityDate,
    ).toBe('2026-07-04')
    expect(computeStreakFromEvents(events, { now: NOW, timezone: 'UTC' }).lastActivityDate).toBe(
      '2026-07-05',
    )
  })

  it('an invalid timezone falls back to UTC instead of throwing', () => {
    const streak = computeStreakFromEvents(days('2026-07-05'), {
      now: NOW,
      timezone: 'Not/AZone',
    })
    expect(streak.lastActivityDate).toBe('2026-07-05')
  })

  it('a future-dated event (westward tz change / clock skew) still reads alive', () => {
    const streak = computeStreakFromEvents(days('2026-07-06'), { now: NOW })
    expect(streak.currentCount).toBe(1)
  })

  it('is deterministic regardless of input order', () => {
    const shuffled = days('2026-07-05', '2026-07-03', '2026-07-04')
    const ordered = days('2026-07-03', '2026-07-04', '2026-07-05')
    expect(computeStreakFromEvents(shuffled, { now: NOW })).toEqual(
      computeStreakFromEvents(ordered, { now: NOW }),
    )
  })
})

describe('pointsSummary', () => {
  const window = {
    start: new Date('2026-07-01T00:00:00Z'),
    end: new Date('2026-07-08T00:00:00Z'),
  }
  const entry = (amount: number, kind: string, at: string) => ({
    amount,
    kind,
    at: new Date(at),
  })

  it('sums earned/spent/net and counts per kind inside the window', () => {
    const summary = pointsSummary(
      [
        entry(10, 'signup', '2026-07-02T10:00:00Z'),
        entry(5, 'referral', '2026-07-03T10:00:00Z'),
        entry(-3, 'purchase', '2026-07-04T10:00:00Z'),
        entry(5, 'referral', '2026-07-05T10:00:00Z'),
      ],
      window,
    )
    expect(summary).toEqual({
      total: 17,
      earned: 20,
      spent: -3,
      byKind: { purchase: -3, referral: 10, signup: 10 },
      count: 4,
    })
  })

  it('the window is half-open: start inclusive, end exclusive', () => {
    const summary = pointsSummary(
      [
        entry(1, 'a', '2026-07-01T00:00:00Z'), // exactly start — in
        entry(1, 'a', '2026-07-08T00:00:00Z'), // exactly end — out
        entry(1, 'a', '2026-06-30T23:59:59Z'), // before — out
      ],
      window,
    )
    expect(summary.count).toBe(1)
    expect(summary.total).toBe(1)
  })

  it('empty window reads as the zero summary', () => {
    expect(pointsSummary([], window)).toEqual({
      total: 0,
      earned: 0,
      spent: 0,
      byKind: {},
      count: 0,
    })
  })

  it('byKind keys serialize in sorted order (deterministic output)', () => {
    const summary = pointsSummary(
      [entry(1, 'zebra', '2026-07-02T00:00:00Z'), entry(1, 'apple', '2026-07-02T00:00:00Z')],
      window,
    )
    expect(Object.keys(summary.byKind)).toEqual(['apple', 'zebra'])
  })
})
