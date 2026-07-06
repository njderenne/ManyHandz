import { describe, it, expect, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { DB } from '@/lib/db'
import { KINDS, KIND_CONFIGS, can } from '@/lib/config/roles'
import {
  roleCanOversee,
  assertCanOverseeMember,
  assertSubjectInOrg,
  type OversightContext,
} from './oversight'

/**
 * Oversight authz — the SECURITY-CRITICAL gate for cross-user reads (grindline's suite,
 * generalized to the capability matrix). Three layers:
 *   1. roleCanOversee — the PURE role gate, no DB: must mirror the KIND_CONFIGS `member:oversee`
 *      grants EXACTLY (the matrix is the one authority; this test pins the delegation).
 *   2. assertCanOverseeMember — the full gate (self short-circuit + role gate + target-membership
 *      read). The DB is stubbed so we assert the BRANCHING — when do we deny, when do we query,
 *      when do we allow — and crucially that an attacker with the wrong role costs ZERO queries.
 *   3. assertSubjectInOrg — the Person ≠ Member seam fence (same-org + not-archived).
 */

describe('roleCanOversee (pure matrix delegation)', () => {
  it('mirrors can(kind, role, "member:oversee") for every declared (kind, role)', () => {
    for (const kind of KINDS) {
      for (const role of KIND_CONFIGS[kind].roles) {
        expect(roleCanOversee(kind, role)).toBe(can(kind, role, 'member:oversee'))
      }
    }
  })

  it('ManyHandz matrix: parents/roommates/managers oversee, kids/colleagues do not', () => {
    expect(roleCanOversee('family', 'parent')).toBe(true)
    expect(roleCanOversee('family', 'kid')).toBe(false)
    expect(roleCanOversee('roommate', 'roommate')).toBe(true)
    expect(roleCanOversee('office', 'manager')).toBe(true)
    expect(roleCanOversee('office', 'colleague')).toBe(false)
  })

  it('denies unknown kinds and malformed/empty roles (deny by default)', () => {
    expect(roleCanOversee('nope', 'admin')).toBe(false)
    expect(roleCanOversee('', 'admin')).toBe(false)
    expect(roleCanOversee('family', '')).toBe(false)
    expect(roleCanOversee('family', 'head_coach')).toBe(false) // another app's vocabulary
  })
})

/**
 * A stub `DB` whose membership/subject lookup resolves to `rows`. Models only the chain the
 * helpers use — select().from().where().limit() — with `where` captured for SQL introspection
 * and `limit` spied so tests can assert whether the query was issued at all.
 */
function stubDb(rows: { id: string }[]): {
  db: DB
  limit: ReturnType<typeof vi.fn>
  wheres: SQL[]
} {
  const wheres: SQL[] = []
  const limit = vi.fn().mockResolvedValue(rows)
  const chain = {
    select: () => chain,
    from: () => chain,
    where: (w: SQL) => {
      wheres.push(w)
      return { limit }
    },
  }
  return { db: chain as unknown as DB, limit, wheres }
}

function ctx(
  overrides: Partial<OversightContext>,
  rows: { id: string }[] = [],
): { context: OversightContext; limit: ReturnType<typeof vi.fn>; wheres: SQL[] } {
  const { db, limit, wheres } = stubDb(rows)
  return {
    context: {
      db,
      orgId: 'org_1',
      orgKind: 'family',
      requesterRole: 'parent',
      requesterUserId: 'admin_1',
      targetUserId: 'member_1',
      ...overrides,
    },
    limit,
    wheres,
  }
}

describe('assertCanOverseeMember (full gate)', () => {
  it('ALLOWS self-access without touching the DB (any role, any kind)', async () => {
    const { context, limit } = ctx({
      requesterRole: 'kid', // a plain kid…
      requesterUserId: 'u_self',
      targetUserId: 'u_self', // …reading themselves
    })
    expect(await assertCanOverseeMember(context)).toBe(true)
    expect(limit).not.toHaveBeenCalled() // self short-circuits before the membership query
  })

  it('DENIES an attacker with the wrong role with ZERO db queries (fail-fast pure gate)', async () => {
    const { context, limit } = ctx({
      requesterRole: 'kid',
      requesterUserId: 'member_x',
      targetUserId: 'member_y',
    })
    expect(await assertCanOverseeMember(context)).toBe(false)
    expect(limit).not.toHaveBeenCalled() // denied without a round-trip
  })

  it('DENIES an unknown kind before querying (stale/forged kind can never escalate)', async () => {
    const { context, limit } = ctx({ orgKind: 'nope', requesterRole: 'parent' }, [{ id: 'm' }])
    expect(await assertCanOverseeMember(context)).toBe(false)
    expect(limit).not.toHaveBeenCalled()
  })

  it('DENIES an overseeing role when the target is NOT an active member of the org — the same empty-rows path covers ARCHIVED targets (the query filters archived_at IS NULL)', async () => {
    const { context, limit, wheres } = ctx({ requesterRole: 'parent' }, [])
    expect(await assertCanOverseeMember(context)).toBe(false)
    expect(limit).toHaveBeenCalledTimes(1) // the membership read DID run, and found nothing
    // Prove the archived fence is in the SQL itself, not left to the caller.
    const q = new PgDialect().sqlToQuery(wheres[0]!)
    expect(q.sql).toMatch(/"archived_at" is null/)
    expect(q.params).toContain('org_1')
    expect(q.params).toContain('member_1')
  })

  it('ALLOWS an overseeing role when the target IS an active member (all conditions hold)', async () => {
    const { context } = ctx({ requesterRole: 'parent' }, [{ id: 'member_row_1' }])
    expect(await assertCanOverseeMember(context)).toBe(true)
  })
})

describe('assertSubjectInOrg (the Person ≠ Member seam fence)', () => {
  it('true when the subject is an active row of THIS org', async () => {
    const { db } = stubDb([{ id: 'subj_1' }])
    expect(await assertSubjectInOrg(db, 'org_1', 'subj_1')).toBe(true)
  })

  it("false when absent — another org's subject id never resolves (leaked ids are inert)", async () => {
    const { db } = stubDb([])
    expect(await assertSubjectInOrg(db, 'org_1', 'subj_other_org')).toBe(false)
  })

  it('the WHERE pins org id, subject id, AND archived_at IS NULL (archived targets denied)', async () => {
    const { db, wheres } = stubDb([])
    await assertSubjectInOrg(db, 'org_1', 'subj_1')
    const q = new PgDialect().sqlToQuery(wheres[0]!)
    expect(q.sql).toMatch(/"organization_id" = /)
    expect(q.sql).toMatch(/"archived_at" is null/)
    expect(q.params).toEqual(expect.arrayContaining(['org_1', 'subj_1']))
  })
})
