import { describe, it, expect } from 'vitest'
import { computeRangeMetrics, type MetricRow, type RangeMetricsInput } from './range-metrics'

/**
 * Range-metrics engine — determinism is the acceptance criterion, so it's asserted literally
 * (same input → deep-equal output, order-independent), alongside the aggregate math and the
 * adherence rules.
 */

const START = new Date('2026-06-01T00:00:00Z')
const END = new Date('2026-06-30T23:59:59Z')

const row = (at: string, value: number | null = null, kind = 'event'): MetricRow => ({
  at: new Date(at),
  value,
  kind,
})

const input = (over: Partial<RangeMetricsInput> = {}): RangeMetricsInput => ({
  rangeStart: START,
  rangeEnd: END,
  series: [],
  ...over,
})

describe('computeRangeMetrics', () => {
  it('reduces count-only rows: count + byKind, numeric aggregates null', () => {
    const data = computeRangeMetrics(
      input({
        series: [
          {
            key: 'activity',
            rows: [
              row('2026-06-02T10:00:00Z', null, 'created'),
              row('2026-06-03T10:00:00Z', null, 'created'),
              row('2026-06-04T10:00:00Z', null, 'archived'),
            ],
          },
        ],
      }),
    )
    const s = data.series.activity
    expect(s.count).toBe(3)
    expect(s.byKind).toEqual({ archived: 1, created: 2 })
    expect(s.sum).toBeNull()
    expect(s.avg).toBeNull()
    expect(s.min).toBeNull()
    expect(s.max).toBeNull()
    expect(s.adherencePct).toBeNull()
  })

  it('reduces valued rows: sum/avg/min/max over non-null values only', () => {
    const data = computeRangeMetrics(
      input({
        series: [
          {
            key: 'weight',
            label: 'Weight',
            rows: [
              row('2026-06-02T10:00:00Z', 80.5, 'weigh-in'),
              row('2026-06-10T10:00:00Z', 79.9, 'weigh-in'),
              row('2026-06-20T10:00:00Z', null, 'note'), // count-only row mixed in
            ],
          },
        ],
      }),
    )
    const s = data.series.weight
    expect(s.label).toBe('Weight')
    expect(s.count).toBe(3)
    expect(s.sum).toBe(160.4)
    expect(s.avg).toBe(80.2)
    expect(s.min).toBe(79.9)
    expect(s.max).toBe(80.5)
    expect(s.firstAt).toBe('2026-06-02T10:00:00.000Z')
    expect(s.lastAt).toBe('2026-06-20T10:00:00.000Z')
  })

  it('adherencePct = count / expected (0.1 precision), capped at 100', () => {
    const doses = Array.from({ length: 28 }, (_, i) =>
      row(`2026-06-${String(i + 1).padStart(2, '0')}T08:00:00Z`, null, 'taken'),
    )
    const data = computeRangeMetrics(
      input({ series: [{ key: 'doses', rows: doses, expected: 30 }] }),
    )
    expect(data.series.doses.adherencePct).toBe(93.3)
    expect(data.series.doses.expected).toBe(30)

    const over = computeRangeMetrics(
      input({ series: [{ key: 'doses', rows: doses, expected: 20 }] }),
    )
    expect(over.series.doses.adherencePct).toBe(100) // over-delivery is not >100%
  })

  it('re-fences rows to the range — a sloppy loader cannot leak out-of-range facts', () => {
    const data = computeRangeMetrics(
      input({
        series: [
          {
            key: 'events',
            rows: [
              row('2026-05-31T23:59:59Z'), // before — out
              row('2026-06-01T00:00:00Z'), // exactly start — in (inclusive)
              row('2026-06-30T23:59:59Z'), // exactly end — in (inclusive)
              row('2026-07-01T00:00:00Z'), // after — out
            ],
          },
        ],
      }),
    )
    expect(data.series.events.count).toBe(2)
  })

  it('DETERMINISTIC: same input → deep-equal output; row and series order do not matter', () => {
    const rowsA = [row('2026-06-02T10:00:00Z', 1, 'b'), row('2026-06-01T10:00:00Z', 2, 'a')]
    const rowsB = [rowsA[1], rowsA[0]]
    const one = computeRangeMetrics(
      input({ series: [{ key: 'y', rows: rowsA }, { key: 'x', rows: [] }] }),
    )
    const two = computeRangeMetrics(
      input({ series: [{ key: 'x', rows: [] }, { key: 'y', rows: rowsB }] }),
    )
    expect(one).toEqual(two)
    expect(JSON.stringify(one)).toBe(JSON.stringify(two)) // byte-identical serialization
    // No wall-clock leakage: the DTO carries no generatedAt (createdAt is the row's job).
    expect(JSON.stringify(one)).not.toContain('generatedAt')
  })

  it('empty series and empty input still produce a complete DTO', () => {
    const data = computeRangeMetrics(input({ series: [{ key: 'nothing', rows: [] }] }))
    expect(data.series.nothing).toMatchObject({
      count: 0,
      byKind: {},
      sum: null,
      avg: null,
      firstAt: null,
      lastAt: null,
      adherencePct: null,
    })
    expect(data.aggregates).toEqual({ totalCount: 0, seriesCount: 1 })
    expect(computeRangeMetrics(input()).aggregates).toEqual({ totalCount: 0, seriesCount: 0 })
  })

  it('period covers the range: ISO bounds + whole-day span (min 1)', () => {
    const data = computeRangeMetrics(input())
    expect(data.period.start).toBe('2026-06-01T00:00:00.000Z')
    expect(data.period.end).toBe('2026-06-30T23:59:59.000Z')
    expect(data.period.days).toBe(30)

    const sameInstant = computeRangeMetrics(input({ rangeStart: START, rangeEnd: START }))
    expect(sameInstant.period.days).toBe(1)
  })

  it('throws on duplicate series keys and inverted ranges (programmer errors)', () => {
    expect(() =>
      computeRangeMetrics(
        input({ series: [{ key: 'dup', rows: [] }, { key: 'dup', rows: [] }] }),
      ),
    ).toThrow(/duplicate series key/)
    expect(() =>
      computeRangeMetrics(input({ rangeStart: END, rangeEnd: START })),
    ).toThrow(/invalid range/)
  })
})
