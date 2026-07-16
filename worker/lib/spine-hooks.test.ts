import { describe, it, expect } from 'vitest'
import { APIError } from 'better-auth/api'
import { assertKindCreatable, applyCreatorRole, mapInvitationRole } from './spine-hooks'
import { DEFAULT_KIND, KINDS, KIND_CONFIGS, PERSONAL_KIND, roleForJoin } from '@/lib/config/roles'
import type { DB } from '@/lib/db'

/**
 * Spine auth-hook guards (SPINE_SPEC §3.4). Pure-ish — the db is a hand-rolled stub, so these
 * pin the VALIDATION rules (kind vocabulary, reserved 'personal', maxPerUser counting shape,
 * creator-role rewrite decision) without a database. The membership-count SQL itself is
 * integration-verified (grindline runs the same query in production).
 */

/** A select-chain stub: resolves `rows`, and records that a query ran. */
function stubDb(rows: Array<{ id: string }> = []) {
  const calls = { selects: 0, updates: 0, updatedWith: undefined as unknown }
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => selectChain,
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
  }
  const db = {
    select: () => {
      calls.selects++
      return selectChain
    },
    update: () => ({
      set: (values: unknown) => {
        calls.updates++
        calls.updatedWith = values
        return { where: () => Promise.resolve() }
      },
    }),
  } as unknown as DB
  return { db, calls }
}

const user = { id: 'user-1' }

describe('assertKindCreatable', () => {
  it('absent kind is fine — the DB default (DEFAULT_KIND) applies', async () => {
    const { db } = stubDb()
    await expect(assertKindCreatable(db, { name: 'Acme' }, user)).resolves.toBeUndefined()
    await expect(assertKindCreatable(db, { name: 'Acme', kind: null }, user)).resolves.toBeUndefined()
  })

  it('every declared kind is creatable', async () => {
    const { db } = stubDb()
    for (const kind of KINDS) {
      await expect(assertKindCreatable(db, { name: 'Acme', kind }, user)).resolves.toBeUndefined()
    }
  })

  it("rejects the reserved 'personal' kind arriving through the plugin API (D5)", async () => {
    const { db } = stubDb()
    await expect(assertKindCreatable(db, { name: 'Solo', kind: PERSONAL_KIND }, user)).rejects.toBeInstanceOf(
      APIError,
    )
  })

  it('rejects unknown kinds — including non-strings and prototype-chain names', async () => {
    const { db } = stubDb()
    for (const kind of ['nope', 'toString', 'constructor', 'hasOwnProperty', 42, {}, true]) {
      await expect(
        assertKindCreatable(db, { name: 'Acme', kind }, user),
        `kind ${String(kind)} should be rejected`,
      ).rejects.toBeInstanceOf(APIError)
    }
  })

  it('runs zero queries when the kind has no maxPerUser (the default mint path)', async () => {
    const { db, calls } = stubDb()
    for (const kind of KINDS) {
      if (KIND_CONFIGS[kind].maxPerUser !== undefined) continue
      await assertKindCreatable(db, { name: 'Acme', kind }, user)
    }
    expect(calls.selects).toBe(0)
  })

  it('maxPerUser: at/over cap rejects, under cap passes (armed — vacuous until an app declares a cap)', async () => {
    for (const kind of KINDS) {
      const cap = KIND_CONFIGS[kind].maxPerUser
      if (cap === undefined) continue
      const atCap = stubDb(Array.from({ length: cap }, (_, i) => ({ id: `m${i}` })))
      await expect(assertKindCreatable(atCap.db, { name: 'Acme', kind }, user)).rejects.toBeInstanceOf(APIError)
      const underCap = stubDb(Array.from({ length: cap - 1 }, (_, i) => ({ id: `m${i}` })))
      await expect(assertKindCreatable(underCap.db, { name: 'Acme', kind }, user)).resolves.toBeUndefined()
    }
  })
})

describe('applyCreatorRole', () => {
  it("no-op (zero queries) when the kind's creatorRole is 'owner' — for ManyHandz only the personal kind (household kinds carry custom creator roles; wired in worker/auth.ts since the SPINE §10.3 cutover)", async () => {
    const { db, calls } = stubDb()
    await applyCreatorRole(db, { id: 'org-1', kind: PERSONAL_KIND }, { id: 'member-1' })
    expect(calls.updates).toBe(0)
  })

  it('rewrites member.role for kinds with a custom creatorRole (armed — vacuous until an app declares one)', async () => {
    for (const kind of KINDS) {
      const creatorRole = roleForJoin(kind, true)
      if (creatorRole === 'owner') continue
      const { db, calls } = stubDb()
      await applyCreatorRole(db, { id: 'org-1', kind }, { id: 'member-1' })
      expect(calls.updates).toBe(1)
      expect(calls.updatedWith).toEqual({ role: creatorRole })
    }
  })

  it('unknown/stale kind resolves through DEFAULT_KIND (total, never throws)', async () => {
    const { db, calls } = stubDb()
    await applyCreatorRole(db, { id: 'org-1', kind: 'legacy-nope' }, { id: 'member-1' })
    // DEFAULT_KIND's creatorRole is 'owner' in the template ⇒ no-op.
    expect(calls.updates).toBe(roleForJoin(DEFAULT_KIND, true) === 'owner' ? 0 : 1)
  })
})

describe('mapInvitationRole (SPINE §4.2 join rule — §10.3 email-invite mapping)', () => {
  it("maps the plugin's static vocabulary into each kind's: admin/owner → creatorRole, member → defaultJoinerRole", () => {
    for (const kind of KINDS) {
      const cfg = KIND_CONFIGS[kind]
      expect(mapInvitationRole(kind, 'admin')).toBe(cfg.creatorRole)
      expect(mapInvitationRole(kind, 'owner')).toBe(cfg.creatorRole)
      expect(mapInvitationRole(kind, 'member')).toBe(cfg.defaultJoinerRole)
    }
    // The concrete ManyHandz contract: a family email invite lands as parent/kid, never 'member'.
    expect(mapInvitationRole('family', 'admin')).toBe('parent')
    expect(mapInvitationRole('family', 'member')).toBe('kid')
    expect(mapInvitationRole('roommate', 'member')).toBe('roommate')
  })

  it('a role already valid for the kind passes through untouched (capability-route invites)', () => {
    expect(mapInvitationRole('family', 'kid')).toBe('kid')
    expect(mapInvitationRole('family', 'parent')).toBe('parent')
    expect(mapInvitationRole('office', 'colleague')).toBe('colleague')
  })

  it("cross-kind household roles do NOT pass through — no 'kid' in a roommate org", () => {
    expect(mapInvitationRole('roommate', 'kid')).toBe('roommate')
    expect(mapInvitationRole('family', 'roommate')).toBe('kid')
  })

  it('reserved personal kind keeps Better-Auth vocabulary verbatim', () => {
    expect(mapInvitationRole(PERSONAL_KIND, 'member')).toBe('member')
    expect(mapInvitationRole(PERSONAL_KIND, 'owner')).toBe('owner')
  })

  it('unknown kind / hostile strings resolve through DEFAULT_KIND, total and prototype-safe', () => {
    expect(mapInvitationRole('legacy-nope', 'member')).toBe(KIND_CONFIGS[DEFAULT_KIND].defaultJoinerRole)
    expect(mapInvitationRole('toString', 'member')).toBe(KIND_CONFIGS[DEFAULT_KIND].defaultJoinerRole)
    expect(mapInvitationRole(undefined, 'admin')).toBe(KIND_CONFIGS[DEFAULT_KIND].creatorRole)
    expect(mapInvitationRole('family', 'constructor')).toBe('kid')
  })
})
