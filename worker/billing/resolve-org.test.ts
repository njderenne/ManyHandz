import { describe, it, expect } from 'vitest'
import type { DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { pickMembershipOrg, resolveBillingOrgId, type BillingMembership } from './resolve-org'

/**
 * Store-purchase → org resolution (the fresh-eyes MAJOR from the 2026-07 backport review): the
 * template webhook resolved the buyer's `kind='personal'` org, which CANNOT exist in ManyHandz
 * (team-first, tenant.autoPersonalOrg=false) — every IAP event would have been acked-and-ignored
 * and no household would ever receive a purchased tier. These tests pin the replacement ladder.
 *
 * Runs against the REAL APP_CONFIG / roles.ts — the family-kind vocabulary ('parent'/'kid', no
 * 'owner') is precisely what broke role-literal assumptions before, so no mocks.
 */

/**
 * Minimal thenable-chain Drizzle mock (same pattern as limits.test.ts): every method returns the
 * chain; each AWAIT pops the next queued result set, in query order.
 */
function fakeDb(results: unknown[][] = []): DB {
  const queue = [...results]
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          const rows = queue.shift() ?? []
          return (resolve: (v: unknown) => void) => resolve(rows)
        }
        return () => chain
      },
    },
  )
  return chain as DB
}

// §10.3 cutover complete: member.role IS the household vocabulary (personal orgs keep 'owner').
const m = (orgId: string, kind: string, role: string): BillingMembership => ({
  orgId,
  kind,
  role,
})

describe('ManyHandz posture canary', () => {
  it('is team-first — the personal-org path the template shipped can never fire here', () => {
    expect(APP_CONFIG.tenant.autoPersonalOrg).toBe(false)
  })
})

describe('pickMembershipOrg (pure core: active session org → earliest billing-capable)', () => {
  it('prefers the active-session org when the buyer holds a live membership there — any role', () => {
    // Even a kid's purchase grants the household they bought FROM: the store took the money.
    const memberships = [m('org-a', 'family', 'parent'), m('org-b', 'family', 'kid')]
    expect(pickMembershipOrg('org-b', memberships)).toBe('org-b')
  })

  it('ignores an active org id with no live membership (stale/archived) and falls through', () => {
    const memberships = [m('org-a', 'family', 'parent')]
    expect(pickMembershipOrg('org-gone', memberships)).toBe('org-a')
  })

  it('falls back to the earliest membership whose (kind, role) grants org:billing', () => {
    // Family 'kid' has no org:billing; 'parent' does (capability-aware — family has no 'owner').
    const memberships = [m('org-kid', 'family', 'kid'), m('org-parent', 'family', 'parent')]
    expect(pickMembershipOrg(null, memberships)).toBe('org-parent')
  })

  it('roommates are billing-capable peers', () => {
    expect(pickMembershipOrg(null, [m('org-rm', 'roommate', 'roommate')])).toBe('org-rm')
  })

  it("personal kind keeps Better-Auth vocabulary — 'owner' grants everything", () => {
    expect(pickMembershipOrg(null, [m('org-p', 'personal', 'owner')])).toBe('org-p')
  })

  it('returns null when the buyer administers nothing and has no active org', () => {
    expect(pickMembershipOrg(null, [m('org-kid', 'family', 'kid')])).toBeNull()
    expect(pickMembershipOrg(null, [])).toBeNull()
  })

  it('unknown/legacy kind normalizes to the default kind vocabulary instead of throwing', () => {
    expect(pickMembershipOrg(null, [m('org-x', 'toString', 'parent')])).toBe('org-x')
  })
})

describe('resolveBillingOrgId (full ladder, team-first posture)', () => {
  const args = ['user-1', 'apple', 'txn-1'] as const

  it('① an existing (provider, externalId) subscription row wins — renewals stay sticky', async () => {
    const db = fakeDb([[{ orgId: 'org-original' }]])
    expect(await resolveBillingOrgId(db, ...args)).toBe('org-original')
  })

  it('③ resolves the active-session household on a first purchase', async () => {
    const db = fakeDb([
      [], // no existing subscription row
      [{ orgId: 'org-active' }], // latest session's activeOrganizationId
      [m('org-other', 'family', 'parent'), m('org-active', 'family', 'kid')], // live memberships
    ])
    expect(await resolveBillingOrgId(db, ...args)).toBe('org-active')
  })

  it('④ falls back to the earliest org:billing-capable membership when no session survives', async () => {
    const db = fakeDb([
      [], // no existing row
      [], // no session with an active org
      [m('org-kid', 'family', 'kid'), m('org-home', 'family', 'parent')],
    ])
    expect(await resolveBillingOrgId(db, ...args)).toBe('org-home')
  })

  it('acks-with-null when the buyer maps to no org at all (webhook warns, never 500s)', async () => {
    const db = fakeDb([[], [], []])
    expect(await resolveBillingOrgId(db, ...args)).toBeNull()
  })
})
