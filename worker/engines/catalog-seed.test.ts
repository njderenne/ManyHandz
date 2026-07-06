import { describe, it, expect, vi } from 'vitest'
import { planSeed, type ExistingSeedRow, type SeedItem } from './catalog-seed'

/**
 * Catalog seeder — the PURE planning core (planSeed) carries every contract: idempotence,
 * version watermarking, the org-row fence, and seed-file validation. seedCatalog() is a thin
 * executor over this plan (reads watermarks, writes the plan) with its residual concurrency
 * safety in SQL (ON CONFLICT DO NOTHING + the version fence re-checked in the UPDATE WHERE).
 */

const item = (id: string, over: Partial<SeedItem> = {}): SeedItem => ({
  id,
  kind: 'drill',
  name: `Name of ${id}`,
  ...over,
})

const existing = (id: string, version: number, organizationId: string | null = null): ExistingSeedRow => ({
  id,
  version,
  organizationId,
})

describe('planSeed — classification', () => {
  it('fresh DB: everything inserts', () => {
    const plan = planSeed([], [item('a.one'), item('a.two')], 1)
    expect(plan.toInsert.map((i) => i.id)).toEqual(['a.one', 'a.two'])
    expect(plan.toUpdate).toEqual([])
    expect(plan.skipped).toBe(0)
  })

  it('IDEMPOTENT: a re-run of the same version plans nothing (inserted 0 / updated 0)', () => {
    const items = [item('a.one'), item('a.two')]
    const rows = [existing('a.one', 3), existing('a.two', 3)]
    const plan = planSeed(rows, items, 3)
    expect(plan.toInsert).toEqual([])
    expect(plan.toUpdate).toEqual([])
    expect(plan.skipped).toBe(2)
  })

  it('VERSIONED: bumping the version updates only rows behind the watermark', () => {
    const rows = [existing('a.one', 3), existing('a.two', 4)]
    const plan = planSeed(rows, [item('a.one'), item('a.two')], 4)
    expect(plan.toUpdate.map((i) => i.id)).toEqual(['a.one'])
    expect(plan.skipped).toBe(1)
  })

  it('a STALE seed (older version than the rows) touches nothing', () => {
    const rows = [existing('a.one', 5)]
    const plan = planSeed(rows, [item('a.one')], 2)
    expect(plan.toInsert).toEqual([])
    expect(plan.toUpdate).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('ORG-ROW FENCE: an org custom row wearing a seed id is skipped loudly, never updated', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const rows = [existing('a.one', 1, 'org_123')]
      const plan = planSeed(rows, [item('a.one')], 99)
      expect(plan.toUpdate).toEqual([])
      expect(plan.toInsert).toEqual([])
      expect(plan.skipped).toBe(1)
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0][0]).toContain('catalog_seed.org_row_collision')
    } finally {
      spy.mockRestore()
    }
  })

  it('mixed run: insert + update + skip in one plan', () => {
    const rows = [existing('a.old', 1), existing('a.current', 2)]
    const plan = planSeed(rows, [item('a.old'), item('a.current'), item('a.new')], 2)
    expect(plan.toInsert.map((i) => i.id)).toEqual(['a.new'])
    expect(plan.toUpdate.map((i) => i.id)).toEqual(['a.old'])
    expect(plan.skipped).toBe(1)
  })
})

describe('planSeed — seed-file validation (programmer errors throw loudly)', () => {
  it('rejects duplicate ids (the copy-paste bug)', () => {
    expect(() => planSeed([], [item('a.one'), item('a.one')], 1)).toThrow(/duplicate seed id/)
  })

  it('rejects malformed ids, empty kinds, and invalid names', () => {
    expect(() => planSeed([], [item('has spaces')], 1)).toThrow(/invalid seed id/)
    expect(() => planSeed([], [item('')], 1)).toThrow(/invalid seed id/)
    expect(() => planSeed([], [item('a.one', { kind: ' ' })], 1)).toThrow(/empty kind/)
    expect(() => planSeed([], [item('a.one', { name: '' })], 1)).toThrow(/invalid name/)
    expect(() => planSeed([], [item('a.one', { name: 'x'.repeat(201) })], 1)).toThrow(/invalid name/)
  })

  it('rejects a non-positive or fractional version', () => {
    expect(() => planSeed([], [item('a.one')], 0)).toThrow(/version/)
    expect(() => planSeed([], [item('a.one')], 1.5)).toThrow(/version/)
  })

  it('parents must PRECEDE children in the seed array (fresh-DB insert order)', () => {
    const okay = [
      item('sport.shooting', { kind: 'category' }),
      item('sport.shooting.form', { parentId: 'sport.shooting' }),
    ]
    expect(() => planSeed([], okay, 1)).not.toThrow()

    const dangling = [item('sport.shooting.form', { parentId: 'sport.shooting' })]
    expect(() => planSeed([], dangling, 1)).toThrow(/does not precede/)
  })
})
