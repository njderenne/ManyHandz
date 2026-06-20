import { describe, expect, it } from 'vitest'
import { finitePoints, leastSquares, withTrend } from './trend'

describe('finitePoints', () => {
  it('passes clean data through untouched', () => {
    const data = [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
    ]
    expect(finitePoints(data)).toEqual(data)
  })

  it('drops NaN and Infinity coordinates (they poison the whole Skia path)', () => {
    expect(
      finitePoints([
        { x: 0, y: NaN },
        { x: 1, y: 2 },
        { x: Infinity, y: 3 },
        { x: 2, y: -Infinity },
      ]),
    ).toEqual([{ x: 1, y: 2 }])
  })

  it('returns [] for [] — the signal chart components use to render ChartEmpty', () => {
    expect(finitePoints([])).toEqual([])
  })
})

describe('leastSquares degenerate inputs', () => {
  it('empty data → flat zero line, no NaN', () => {
    expect(leastSquares([])).toEqual({ slope: 0, intercept: 0 })
  })

  it('single point → flat line through that point', () => {
    expect(leastSquares([{ x: 5, y: 42 }])).toEqual({ slope: 0, intercept: 42 })
  })

  it('all points at the same x (vertical) → finite result, never NaN', () => {
    const { slope, intercept } = leastSquares([
      { x: 3, y: 1 },
      { x: 3, y: 5 },
    ])
    expect(Number.isFinite(slope)).toBe(true)
    expect(Number.isFinite(intercept)).toBe(true)
  })

  it('fits the obvious line', () => {
    const { slope, intercept } = leastSquares([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ])
    expect(slope).toBeCloseTo(2)
    expect(intercept).toBeCloseTo(1)
  })
})

describe('withTrend', () => {
  it('adds a finite trend value at every point', () => {
    const out = withTrend([
      { x: 0, y: 10 },
      { x: 1, y: 20 },
    ])
    expect(out).toHaveLength(2)
    for (const p of out) expect(Number.isFinite(p.trend)).toBe(true)
  })
})
