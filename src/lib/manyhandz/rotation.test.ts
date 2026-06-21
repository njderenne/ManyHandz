import { describe, it, expect } from 'vitest'
import { daysBetween, isRotationDue, nextAssignee } from './rotation'

describe('rotation timing', () => {
  it('daysBetween', () => {
    expect(daysBetween('2026-06-20', '2026-06-27')).toBe(7)
    expect(daysBetween('2026-06-20', '2026-06-20')).toBe(0)
    expect(daysBetween('2026-06-27', '2026-06-20')).toBe(-7)
  })

  it('is due only on interval boundaries', () => {
    expect(isRotationDue('2026-06-01', 'weekly', '2026-06-08')).toBe(true)
    expect(isRotationDue('2026-06-01', 'weekly', '2026-06-09')).toBe(false)
    expect(isRotationDue('2026-06-01', 'daily', '2026-06-02')).toBe(true)
    expect(isRotationDue('2026-06-01', 'biweekly', '2026-06-15')).toBe(true)
    expect(isRotationDue('2026-06-01', 'weekly', '2026-06-01')).toBe(false) // start day isn't a rotation
  })
})

describe('nextAssignee', () => {
  const order = ['a', 'b', 'c']

  it('round-robin advances and wraps', () => {
    expect(nextAssignee({ memberOrder: order, currentIndex: 0, rotationType: 'round_robin', awayMemberIds: new Set() }))
      .toEqual({ memberId: 'b', nextIndex: 1 })
    expect(nextAssignee({ memberOrder: order, currentIndex: 2, rotationType: 'round_robin', awayMemberIds: new Set() }))
      .toEqual({ memberId: 'a', nextIndex: 0 })
  })

  it('round-robin skips away members', () => {
    expect(nextAssignee({ memberOrder: order, currentIndex: 0, rotationType: 'round_robin', awayMemberIds: new Set(['b']) }))
      .toEqual({ memberId: 'c', nextIndex: 2 })
  })

  it('round-robin returns null when everyone is away (skip the period)', () => {
    expect(nextAssignee({ memberOrder: order, currentIndex: 0, rotationType: 'round_robin', awayMemberIds: new Set(['a', 'b', 'c']) }))
      .toBeNull()
  })

  it('fixed always assigns member 0, or no one if away', () => {
    expect(nextAssignee({ memberOrder: order, currentIndex: 1, rotationType: 'fixed', awayMemberIds: new Set() }))
      .toEqual({ memberId: 'a', nextIndex: 1 })
    expect(nextAssignee({ memberOrder: order, currentIndex: 1, rotationType: 'fixed', awayMemberIds: new Set(['a']) }))
      .toBeNull()
  })
})
