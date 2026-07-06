import { describe, it, expect, vi, afterEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { DB } from '@/lib/db'
import type { Subject } from '@/lib/db/schema'

/**
 * Subject-lib tests — the cap counter, the shared input-hygiene schemas, the archive-hook runner,
 * and the privacy DTO. The cap counter runs against a MOCKED APP_CONFIG whose limits object is
 * mutable per test (the template ships `limits: {}` — every enforcement a no-op — so the capped
 * branches are only reachable with a config an actual minted app would have).
 */
const mockLimits = vi.hoisted(() => ({} as Record<string, unknown>))
vi.mock('@/lib/config/app', () => ({
  APP_CONFIG: { monetization: { limits: mockLimits } },
}))

// Imports AFTER the mock so subjects.ts sees the mocked config.
import {
  subjectCap,
  createSubjectSchema,
  updateSubjectSchema,
  subjectToDto,
  onSubjectArchived,
  runSubjectArchivedHooks,
  MAX_PROFILE_BYTES,
} from './subjects'

/**
 * Count-query stub: `select({ n: count() }).from(subject).where(scope)` is awaited directly, so
 * `where` returns the resolved rows AND records its drizzle condition for SQL introspection.
 */
function fakeCountDb(n: number): { db: DB; wheres: SQL[] } {
  const wheres: SQL[] = []
  const chain = {
    select: () => chain,
    from: () => chain,
    where: (w: SQL) => {
      wheres.push(w)
      return Promise.resolve([{ n }])
    },
  }
  return { db: chain as unknown as DB, wheres }
}

/** Render a captured drizzle condition to parameterized SQL (no DB needed). */
function renderSql(condition: SQL): { sql: string; params: unknown[] } {
  const q = new PgDialect().sqlToQuery(condition)
  return { sql: q.sql, params: q.params }
}

afterEach(() => {
  for (const key of Object.keys(mockLimits)) delete mockLimits[key]
})

describe('subjectCap', () => {
  it('key absent → { limited: false } with ZERO queries (unconfigured mints pay nothing)', async () => {
    const { db, wheres } = fakeCountDb(99)
    expect(await subjectCap(db, 'org1', 'person')).toEqual({ limited: false })
    expect(wheres).toHaveLength(0)
  })

  it('flat cap: under → not exceeded; at cap → exceeded (a restore re-occupies a slot)', async () => {
    mockLimits.subjects = 2
    expect(await subjectCap(fakeCountDb(1).db, 'org1', 'person')).toEqual({
      limited: true,
      limit: 2,
      count: 1,
      exceeded: false,
    })
    // count === limit blocks the NEXT create/restore — active rows are never evicted.
    expect(await subjectCap(fakeCountDb(2).db, 'org1', 'person')).toEqual({
      limited: true,
      limit: 2,
      count: 2,
      exceeded: true,
    })
  })

  it('counts only ACTIVE subjects — the WHERE carries archived_at IS NULL + the org id', async () => {
    mockLimits.subjects = 2
    const { db, wheres } = fakeCountDb(0)
    await subjectCap(db, 'org1', 'person')
    expect(wheres).toHaveLength(1)
    const { sql, params } = renderSql(wheres[0]!)
    expect(sql).toMatch(/"archived_at" is null/)
    expect(sql).toMatch(/"organization_id" = /)
    expect(params).toContain('org1')
  })

  it('flat cap counts ALL kinds (no kind filter in the WHERE)', async () => {
    mockLimits.subjects = 2
    const { db, wheres } = fakeCountDb(0)
    await subjectCap(db, 'org1', 'pet')
    expect(renderSql(wheres[0]!).sql).not.toMatch(/"kind"/)
  })

  it('per-kind record: caps within the kind; a kind absent from the record is uncapped', async () => {
    mockLimits.subjects = { pet: 2 }
    const { db, wheres } = fakeCountDb(2)
    expect(await subjectCap(db, 'org1', 'pet')).toEqual({
      limited: true,
      limit: 2,
      count: 2,
      exceeded: true,
    })
    const { sql, params } = renderSql(wheres[0]!)
    expect(sql).toMatch(/"kind" = /)
    expect(params).toContain('pet')
    // 'person' has no cap in { pet: 2 } — unlimited, zero queries.
    const other = fakeCountDb(50)
    expect(await subjectCap(other.db, 'org1', 'person')).toEqual({ limited: false })
    expect(other.wheres).toHaveLength(0)
  })
})

describe('createSubjectSchema (input hygiene table)', () => {
  const base = { displayName: 'Mom' }

  it.each([
    ['minimal valid body', base, true],
    ['displayName trimmed to non-empty', { displayName: '  Mom  ' }, true],
    ['empty displayName', { displayName: '' }, false],
    ['whitespace-only displayName', { displayName: '   ' }, false],
    ['displayName over 120 chars', { displayName: 'x'.repeat(121) }, false],
    ['notes at the 2000 cap', { ...base, notes: 'n'.repeat(2000) }, true],
    ['notes over 2000', { ...base, notes: 'n'.repeat(2001) }, false],
    ['valid birthDate', { ...base, birthDate: '2019-04-01' }, true],
    ['sloppy birthDate (no zero-pad)', { ...base, birthDate: '2019-4-1' }, false],
    ['birthDate with time suffix', { ...base, birthDate: '2019-04-01T00:00:00Z' }, false],
    ['null birthDate (keepsey "expecting")', { ...base, birthDate: null }, true],
    ['timezone at the 64 cap', { ...base, timezone: 't'.repeat(64) }, true],
    ['timezone over 64', { ...base, timezone: 't'.repeat(65) }, false],
    ['profile as an array', { ...base, profile: ['not', 'an', 'object'] }, false],
    ['profile as a string', { ...base, profile: 'nope' }, false],
    ['nested plain-object profile', { ...base, profile: { journey: { pack: 'newborn' } } }, true],
    ['isSelf boolean', { ...base, isSelf: true }, true],
    ['isSelf non-boolean', { ...base, isSelf: 'yes' }, false],
  ])('%s → success=%s', (_label, body, ok) => {
    expect(createSubjectSchema.safeParse(body).success).toBe(ok as boolean)
  })

  it('trims displayName in the parsed output', () => {
    const parsed = createSubjectSchema.safeParse({ displayName: '  Mom  ' })
    expect(parsed.success && parsed.data.displayName).toBe('Mom')
  })

  it('rejects a profile whose serialization exceeds 8 KB (subjects are not blob storage)', () => {
    const fat = { blob: 'x'.repeat(MAX_PROFILE_BYTES) } // key+quotes push it past the cap
    expect(createSubjectSchema.safeParse({ ...base, profile: fat }).success).toBe(false)
  })

  it('strips unknown keys — a client cannot smuggle selfUserId/organizationId into the insert', () => {
    const parsed = createSubjectSchema.safeParse({
      ...base,
      selfUserId: 'attacker-user',
      organizationId: 'other-org',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect('selfUserId' in parsed.data).toBe(false)
      expect('organizationId' in parsed.data).toBe(false)
    }
  })
})

describe('updateSubjectSchema', () => {
  it('everything optional; kind/isSelf are not patchable (stripped)', () => {
    const parsed = updateSubjectSchema.safeParse({ kind: 'pet', isSelf: true })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect('kind' in parsed.data).toBe(false)
      expect('isSelf' in parsed.data).toBe(false)
    }
  })

  it('displayName, when present, must still be non-empty and non-null', () => {
    expect(updateSubjectSchema.safeParse({ displayName: '' }).success).toBe(false)
    expect(updateSubjectSchema.safeParse({ displayName: null }).success).toBe(false)
    expect(updateSubjectSchema.safeParse({ displayName: 'New Name' }).success).toBe(true)
  })

  it('nullable fields accept explicit null (the PATCH clear convention)', () => {
    expect(updateSubjectSchema.safeParse({ notes: null, timezone: null, profile: null }).success).toBe(true)
  })
})

describe('runSubjectArchivedHooks', () => {
  it('runs every hook; a throwing hook is logged and never fails the archive or blocks the rest', async () => {
    const ran: string[] = []
    const failing = vi.fn(async () => {
      ran.push('failing')
      throw new Error('cleanup exploded')
    })
    const succeeding = vi.fn(async (_db: DB, orgId: string, subjectId: string) => {
      ran.push(`ok:${orgId}:${subjectId}`)
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = onSubjectArchived.length
    onSubjectArchived.push(failing, succeeding)
    try {
      await expect(
        runSubjectArchivedHooks({} as DB, 'org1', 'subj1'),
      ).resolves.toBeUndefined()
      expect(ran).toEqual(['failing', 'ok:org1:subj1']) // the failure didn't short-circuit
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]![0]).toContain('subject.archive_hook_failed')
      expect(warn.mock.calls[0]![0]).toContain('cleanup exploded')
    } finally {
      onSubjectArchived.length = before // never leak registrations into other tests
      warn.mockRestore()
    }
  })
})

describe('subjectToDto (the privacy DTO)', () => {
  const row = {
    id: 's1',
    organizationId: 'org1',
    kind: 'person',
    displayName: 'Mom',
    selfUserId: 'user-mom',
    avatarMediaId: null,
    timezone: null,
    birthDate: null,
    notes: 'private care notes',
    profile: null,
    archivedAt: null,
    createdByMemberId: 'm1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  } as Subject

  it('NEVER serializes the raw selfUserId — linkage is the selfLinked boolean', () => {
    const dto = subjectToDto(row, 'someone-else')
    expect('selfUserId' in dto).toBe(false)
    expect(dto.selfLinked).toBe(true)
    expect(dto.isSelf).toBe(false)
  })

  it('isSelf is true only for the linked caller', () => {
    expect(subjectToDto(row, 'user-mom').isSelf).toBe(true)
  })

  it('account-less subject → selfLinked false, isSelf false', () => {
    const dto = subjectToDto({ ...row, selfUserId: null } as Subject, 'user-mom')
    expect(dto.selfLinked).toBe(false)
    expect(dto.isSelf).toBe(false)
  })
})
