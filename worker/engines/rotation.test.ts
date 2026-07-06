import { describe, it, expect } from 'vitest'
import { nextAssignee, rotationOrder, type RotationMember } from './rotation'

/**
 * Rotation engine — the deterministic tie-break IS the contract, so most of these tests are
 * about order stability: same members, any input order, same answer.
 */

function member(id: string, lastAssignedAt: string | null, load = 0): RotationMember {
  return { id, lastAssignedAt: lastAssignedAt ? new Date(lastAssignedAt) : null, load }
}

describe('round_robin', () => {
  it('picks the least-recently-assigned member', () => {
    const members = [
      member('a', '2026-07-03T00:00:00Z'),
      member('b', '2026-07-01T00:00:00Z'),
      member('c', '2026-07-02T00:00:00Z'),
    ]
    expect(nextAssignee(members, { strategy: 'round_robin' })?.id).toBe('b')
  })

  it('never-assigned members go before everyone', () => {
    const members = [member('a', '2020-01-01T00:00:00Z'), member('b', null)]
    expect(nextAssignee(members, { strategy: 'round_robin' })?.id).toBe('b')
  })

  it('ties break by id — deterministically', () => {
    const sameInstant = '2026-07-01T00:00:00Z'
    const members = [member('charlie', sameInstant), member('alpha', sameInstant), member('bravo', sameInstant)]
    expect(rotationOrder(members, { strategy: 'round_robin' }).map((m) => m.id)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ])
  })

  it('two never-assigned members tie-break by id', () => {
    expect(
      nextAssignee([member('zed', null), member('amy', null)], { strategy: 'round_robin' })?.id,
    ).toBe('amy')
  })

  it('turns circulate: assigning the pick and re-ranking yields everyone in sequence', () => {
    // Simulate three rounds — the pure-engine version of ManyHandz's index-walking rotation.
    let members = [member('a', null), member('b', null), member('c', null)]
    const picks: string[] = []
    for (let round = 0; round < 6; round++) {
      const pick = nextAssignee(members, { strategy: 'round_robin' })!
      picks.push(pick.id)
      members = members.map((m) =>
        m.id === pick.id ? { ...m, lastAssignedAt: new Date(2026, 0, round + 1) } : m,
      )
    }
    expect(picks).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  })
})

describe('least_loaded', () => {
  it('picks the lightest load regardless of recency', () => {
    const members = [
      member('a', null, 5),
      member('b', '2026-07-04T00:00:00Z', 1),
      member('c', null, 3),
    ]
    expect(nextAssignee(members, { strategy: 'least_loaded' })?.id).toBe('b')
  })

  it('load ties break by least-recently-assigned, then id', () => {
    const members = [
      member('a', '2026-07-03T00:00:00Z', 2),
      member('b', '2026-07-01T00:00:00Z', 2),
      member('c', '2026-07-01T00:00:00Z', 2),
    ]
    expect(rotationOrder(members, { strategy: 'least_loaded' }).map((m) => m.id)).toEqual([
      'b',
      'c',
      'a',
    ])
  })
})

describe('shared contract', () => {
  it('empty pool → null (skip the period, never a stale default — ManyHandz vacation rule)', () => {
    expect(nextAssignee([], { strategy: 'round_robin' })).toBeNull()
    expect(nextAssignee([], { strategy: 'least_loaded' })).toBeNull()
  })

  it('is input-order independent (two workers compute the same answer)', () => {
    const a = [member('x', '2026-07-01T00:00:00Z', 1), member('y', null, 2), member('z', '2026-07-02T00:00:00Z', 0)]
    const b = [a[2], a[0], a[1]]
    for (const strategy of ['round_robin', 'least_loaded'] as const) {
      expect(rotationOrder(a, { strategy }).map((m) => m.id)).toEqual(
        rotationOrder(b, { strategy }).map((m) => m.id),
      )
    }
  })

  it('does not mutate the input array', () => {
    const members = [member('b', null), member('a', null)]
    rotationOrder(members, { strategy: 'round_robin' })
    expect(members.map((m) => m.id)).toEqual(['b', 'a'])
  })
})
