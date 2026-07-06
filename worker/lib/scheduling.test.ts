import { describe, it, expect } from 'vitest'
import {
  zonedWallTimeToUtc,
  computeDueSlots,
  adherenceStats,
  computeStreak,
  ON_TIME_GRACE_MS,
  type SchedulableItem,
} from './scheduling'

/**
 * Scheduling kit — ported from RxMndr's production suite to the generic SchedulableItem shape.
 * Pure functions, so the tests ARE the spec: tz conversion (incl. the DST seams), window/weekday
 * gating, adherence math, and the once-only streak grace.
 */

function item(over: Partial<SchedulableItem> = {}): SchedulableItem {
  return {
    id: 'item_1',
    startDate: null,
    endDate: null,
    timesOfDay: ['08:00'],
    daysOfWeek: null,
    timezone: 'America/Chicago',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// zonedWallTimeToUtc
// ---------------------------------------------------------------------------

describe('zonedWallTimeToUtc', () => {
  it('converts Chicago CDT summer wall-clock to UTC (UTC-5)', () => {
    const d = zonedWallTimeToUtc('2026-06-15', '08:00', 'America/Chicago')
    expect(d.toISOString()).toBe('2026-06-15T13:00:00.000Z')
  })

  it('converts Chicago CST winter wall-clock to UTC (UTC-6)', () => {
    const d = zonedWallTimeToUtc('2026-01-15', '08:00', 'America/Chicago')
    expect(d.toISOString()).toBe('2026-01-15T14:00:00.000Z')
  })

  it('handles a non-US zone (Asia/Kolkata, UTC+5:30)', () => {
    const d = zonedWallTimeToUtc('2026-06-15', '08:00', 'Asia/Kolkata')
    expect(d.toISOString()).toBe('2026-06-15T02:30:00.000Z')
  })

  it('defaults to UTC when tz is null/empty (chassis-neutral fallback)', () => {
    expect(zonedWallTimeToUtc('2026-06-15', '08:00', null).toISOString()).toBe('2026-06-15T08:00:00.000Z')
    expect(zonedWallTimeToUtc('2026-06-15', '08:00', '').toISOString()).toBe('2026-06-15T08:00:00.000Z')
  })

  it('handles a bedtime time that crosses into the next UTC day', () => {
    // 22:00 CDT (UTC-5) → 03:00 UTC the NEXT day.
    const d = zonedWallTimeToUtc('2026-06-15', '22:00', 'America/Chicago')
    expect(d.toISOString()).toBe('2026-06-16T03:00:00.000Z')
  })

  it('DST spring-forward: a nonexistent wall time lands on the post-jump instant, deterministically', () => {
    // 2026-03-08 02:30 does not exist in Chicago (02:00→03:00 jump). The offset trick resolves it
    // to the equivalent post-jump instant 03:30 CDT = 08:30 UTC — never a throw, never a drift day.
    const d = zonedWallTimeToUtc('2026-03-08', '02:30', 'America/Chicago')
    expect(d.toISOString()).toBe('2026-03-08T08:30:00.000Z')
  })

  it('DST boundaries: the same wall time is a different instant before vs after the transition', () => {
    // 08:00 the day before spring-forward is CST (UTC-6); the day of is CDT (UTC-5).
    expect(zonedWallTimeToUtc('2026-03-07', '08:00', 'America/Chicago').toISOString()).toBe('2026-03-07T14:00:00.000Z')
    expect(zonedWallTimeToUtc('2026-03-08', '08:00', 'America/Chicago').toISOString()).toBe('2026-03-08T13:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// computeDueSlots
// ---------------------------------------------------------------------------

describe('computeDueSlots — firing rules', () => {
  it('no weekday rule = daily; one slot per time, sorted by instant', () => {
    const slots = computeDueSlots({
      items: [item({ timesOfDay: ['20:00', '08:00'] })],
      dateStr: '2026-06-15',
    })
    expect(slots).toHaveLength(2)
    expect(slots.map((s) => s.localTime)).toEqual(['08:00', '20:00']) // sorted
    expect(slots[0].itemId).toBe('item_1')
    expect(slots[0].scheduledFor.toISOString()).toBe('2026-06-15T13:00:00.000Z')
  })

  it('daysOfWeek fires only on listed weekdays (0=Sun..6=Sat)', () => {
    // 2026-06-15 is a Monday (1); 2026-06-16 a Tuesday (2).
    const rule = item({ daysOfWeek: [1, 3, 5] })
    expect(computeDueSlots({ items: [rule], dateStr: '2026-06-15' })).toHaveLength(1)
    expect(computeDueSlots({ items: [rule], dateStr: '2026-06-16' })).toHaveLength(0)
  })

  it('an explicitly EMPTY daysOfWeek never fires (distinct from absent = daily)', () => {
    expect(computeDueSlots({ items: [item({ daysOfWeek: [] })], dateStr: '2026-06-15' })).toHaveLength(0)
  })
})

describe('computeDueSlots — window edges', () => {
  it('respects the start/end window; endDate is INCLUSIVE', () => {
    const windowed = item({ startDate: '2026-06-10', endDate: '2026-06-20' })
    expect(computeDueSlots({ items: [windowed], dateStr: '2026-06-09' })).toHaveLength(0) // before
    expect(computeDueSlots({ items: [windowed], dateStr: '2026-06-10' })).toHaveLength(1) // first day
    expect(computeDueSlots({ items: [windowed], dateStr: '2026-06-20' })).toHaveLength(1) // last day
    expect(computeDueSlots({ items: [windowed], dateStr: '2026-06-21' })).toHaveLength(0) // after
  })

  it('open bounds: null start/end means unbounded on that side', () => {
    expect(computeDueSlots({ items: [item({ endDate: '2026-06-20' })], dateStr: '2020-01-01' })).toHaveLength(1)
    expect(computeDueSlots({ items: [item({ startDate: '2026-06-10' })], dateStr: '2030-01-01' })).toHaveLength(1)
  })

  it('skips malformed times instead of throwing (pre-validation user data)', () => {
    const slots = computeDueSlots({
      items: [item({ timesOfDay: ['8:05', 'nope', '25:00', ''] })],
      dateStr: '2026-06-15',
    })
    expect(slots).toHaveLength(1)
    expect(slots[0].localTime).toBe('08:05') // zero-padded canonical form
  })
})

describe('computeDueSlots — timezone fallbacks', () => {
  it('item tz → args.timeZone → UTC, in that order', () => {
    // Item's own zone wins.
    const own = computeDueSlots({
      items: [item({ timezone: 'Asia/Kolkata' })],
      dateStr: '2026-06-15',
      timeZone: 'America/Chicago',
    })
    expect(own[0].scheduledFor.toISOString()).toBe('2026-06-15T02:30:00.000Z')

    // No item zone → the args fallback.
    const fallback = computeDueSlots({
      items: [item({ timezone: null })],
      dateStr: '2026-06-15',
      timeZone: 'America/Chicago',
    })
    expect(fallback[0].scheduledFor.toISOString()).toBe('2026-06-15T13:00:00.000Z')

    // Neither → UTC.
    const utc = computeDueSlots({ items: [item({ timezone: null })], dateStr: '2026-06-15' })
    expect(utc[0].scheduledFor.toISOString()).toBe('2026-06-15T08:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// adherenceStats
// ---------------------------------------------------------------------------

describe('adherenceStats', () => {
  const at = (s: string) => new Date(s)

  it('adherence = completed ÷ scheduled (the denominator comes from the SCHEDULE)', () => {
    const stats = adherenceStats(
      [
        { completed: true, scheduledFor: at('2026-06-15T13:00:00Z'), completedAt: at('2026-06-15T13:05:00Z') },
        { completed: true, scheduledFor: at('2026-06-15T01:00:00Z'), completedAt: at('2026-06-15T01:00:00Z') },
        { completed: false, scheduledFor: at('2026-06-15T20:00:00Z'), completedAt: null },
      ],
      4, // one slot was never even logged — it still counts against adherence
    )
    expect(stats.completed).toBe(2)
    expect(stats.adherencePct).toBe(50)
    expect(stats.scheduled).toBe(4)
  })

  it('on-time excludes completions past the grace window (+30 min inclusive)', () => {
    const stats = adherenceStats(
      [
        // exactly +30 min → still on time
        { completed: true, scheduledFor: at('2026-06-15T13:00:00Z'), completedAt: at('2026-06-15T13:30:00Z') },
        // +31 min → late
        { completed: true, scheduledFor: at('2026-06-15T13:00:00Z'), completedAt: at('2026-06-15T13:31:00Z') },
      ],
      2,
    )
    expect(stats.adherencePct).toBe(100)
    expect(stats.onTime).toBe(1)
    expect(stats.onTimePct).toBe(50)
    expect(ON_TIME_GRACE_MS).toBe(30 * 60 * 1000)
  })

  it('accepts ISO strings, and counts a completion with no scheduled time as completed but not on-time', () => {
    const stats = adherenceStats(
      [{ completed: true, scheduledFor: null, completedAt: '2026-06-15T13:10:00Z' }],
      1,
    )
    expect(stats.completed).toBe(1)
    expect(stats.onTime).toBe(0)
  })

  it('returns zeros (no divide-by-zero) when nothing scheduled', () => {
    const stats = adherenceStats([], 0)
    expect(stats.adherencePct).toBe(0)
    expect(stats.onTimePct).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeStreak
// ---------------------------------------------------------------------------

describe('computeStreak', () => {
  it('counts consecutive perfect days walking backwards', () => {
    expect(
      computeStreak([
        { date: '2026-06-13', scheduled: 2, completed: 2 },
        { date: '2026-06-14', scheduled: 2, completed: 2 },
        { date: '2026-06-15', scheduled: 2, completed: 2 },
      ]),
    ).toBe(3)
  })

  it('breaks on the first imperfect day from the most recent', () => {
    expect(
      computeStreak([
        { date: '2026-06-13', scheduled: 2, completed: 2 },
        { date: '2026-06-14', scheduled: 2, completed: 1 }, // miss
        { date: '2026-06-15', scheduled: 2, completed: 2 },
      ]),
    ).toBe(1)
  })

  it('treats a day with no scheduled slots as neutral (does not break or extend)', () => {
    expect(
      computeStreak([
        { date: '2026-06-13', scheduled: 2, completed: 2 },
        { date: '2026-06-14', scheduled: 0, completed: 0 }, // neutral
        { date: '2026-06-15', scheduled: 2, completed: 2 },
      ]),
    ).toBe(2)
  })

  it('grace: a single one-miss day still counts — only with grace enabled', () => {
    const days = [
      { date: '2026-06-13', scheduled: 3, completed: 3 },
      { date: '2026-06-14', scheduled: 3, completed: 2 }, // one miss
      { date: '2026-06-15', scheduled: 3, completed: 3 },
    ]
    expect(computeStreak(days, true)).toBe(3)
    expect(computeStreak(days, false)).toBe(1)
  })

  it('grace is consumed only ONCE across the whole walk', () => {
    expect(
      computeStreak(
        [
          { date: '2026-06-13', scheduled: 3, completed: 2 }, // second miss — grace already spent
          { date: '2026-06-14', scheduled: 3, completed: 2 }, // first miss — grace covers
          { date: '2026-06-15', scheduled: 3, completed: 3 },
        ],
        true,
      ),
    ).toBe(2)
  })

  it('grace does not cover a two-miss day', () => {
    expect(
      computeStreak(
        [
          { date: '2026-06-14', scheduled: 3, completed: 1 }, // two misses — not eligible
          { date: '2026-06-15', scheduled: 3, completed: 3 },
        ],
        true,
      ),
    ).toBe(1)
  })

  it('sorts unordered input internally', () => {
    expect(
      computeStreak([
        { date: '2026-06-15', scheduled: 1, completed: 1 },
        { date: '2026-06-13', scheduled: 1, completed: 1 },
        { date: '2026-06-14', scheduled: 1, completed: 1 },
      ]),
    ).toBe(3)
  })
})
