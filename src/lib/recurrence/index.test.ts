import { describe, it, expect } from 'vitest'
import { getOccurrences, dueOccurrences } from './index'

/**
 * Golden recurrence vectors — the DST / leap-year / month-overflow cases the engine guarantees.
 * Date math is UTC-only on 'YYYY-MM-DD', so these are deterministic regardless of the machine
 * timezone.
 */

describe('WEEKLY / BIWEEKLY', () => {
  it('weekly anchors on the requested weekday and steps 7 days', () => {
    // 2025-03-03 is a Monday (dayOfWeek 1). Through two weeks.
    expect(
      getOccurrences({ pattern: 'WEEKLY', dayOfWeek: 1, startDate: '2025-03-03' }, '2025-03-17'),
    ).toEqual(['2025-03-03', '2025-03-10', '2025-03-17'])
  })

  it('crosses the US spring-forward (2025-03-09) without dropping or shifting a day', () => {
    // Sundays around DST: 03-02, 03-09 (spring forward), 03-16 — must stay exactly 7 apart.
    expect(
      getOccurrences({ pattern: 'WEEKLY', dayOfWeek: 0, startDate: '2025-03-02' }, '2025-03-16'),
    ).toEqual(['2025-03-02', '2025-03-09', '2025-03-16'])
  })

  it('biweekly steps 14 days from the anchor', () => {
    expect(
      getOccurrences({ pattern: 'BIWEEKLY', dayOfWeek: 5, startDate: '2025-01-03' }, '2025-02-14'),
    ).toEqual(['2025-01-03', '2025-01-17', '2025-01-31', '2025-02-14'])
  })
})

describe('MONTHLY / QUARTERLY — day clamping', () => {
  it('clamps the 31st to each month’s last day (incl. leap February)', () => {
    expect(
      getOccurrences({ pattern: 'MONTHLY', dayOfMonth: 31, startDate: '2024-01-31' }, '2024-04-30'),
    ).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']) // 2024 is a leap year
  })

  it('clamps the 31st to Feb 28 in a non-leap year', () => {
    expect(
      getOccurrences({ pattern: 'MONTHLY', dayOfMonth: 31, startDate: '2025-01-31' }, '2025-03-31'),
    ).toEqual(['2025-01-31', '2025-02-28', '2025-03-31'])
  })

  it('quarterly steps 3 months', () => {
    expect(
      getOccurrences({ pattern: 'QUARTERLY', dayOfMonth: 15, startDate: '2025-01-15' }, '2025-12-31'),
    ).toEqual(['2025-01-15', '2025-04-15', '2025-07-15', '2025-10-15'])
  })

  it('skips a start-month occurrence that falls before the start date', () => {
    // Monthly on the 1st, but the anchor starts on the 15th → first real occurrence is next month.
    expect(
      getOccurrences({ pattern: 'MONTHLY', dayOfMonth: 1, startDate: '2025-01-15' }, '2025-03-31'),
    ).toEqual(['2025-02-01', '2025-03-01'])
  })
})

describe('YEARLY — Feb 29 clamps (no calendar overflow)', () => {
  it('clamps Feb 29 to Feb 28 in non-leap years instead of rolling to Mar 1', () => {
    expect(
      getOccurrences({ pattern: 'YEARLY', dayOfMonth: 29, startDate: '2024-02-29' }, '2026-12-31'),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28'])
  })
})

describe('endDate + due-set filtering', () => {
  it('stops at endDate (inclusive)', () => {
    expect(
      getOccurrences(
        { pattern: 'MONTHLY', dayOfMonth: 10, startDate: '2025-01-10', endDate: '2025-03-10' },
        '2025-12-31',
      ),
    ).toEqual(['2025-01-10', '2025-02-10', '2025-03-10'])
  })

  it('dueOccurrences returns only dates strictly after lastSpawnedDate', () => {
    const spec = { pattern: 'MONTHLY' as const, dayOfMonth: 1, startDate: '2025-01-01' }
    expect(dueOccurrences(spec, '2025-02-01', '2025-04-01')).toEqual(['2025-03-01', '2025-04-01'])
    expect(dueOccurrences(spec, null, '2025-02-01')).toEqual(['2025-01-01', '2025-02-01'])
  })
})
