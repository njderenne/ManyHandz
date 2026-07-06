import { describe, it, expect, vi, afterEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { DB } from '@/lib/db'

/**
 * Access-grant lib tests (SUBJECT_SPEC §6.2) — the code mint (charset/bias/retry), the resolve
 * predicate matrix, the amortized activity prune, the scope check, the mint duration bounds, and
 * the two revoke levers. Plus the DEFAULT COMPOSER privacy tests (grant-config.ts): the public
 * payload is an explicit allowlist — no avatarUrl/media URLs (M-3), never notes/profile/
 * selfUserId/member ids (SUBJECT_SPEC §7 rule 3).
 */
const mockConfig = vi.hoisted(() => ({
  features: {
    subjects: true,
    shareGrants: true,
    export: true,
  } as Record<string, boolean>,
  grants: { maxDurationDays: 30, revokeOnLapse: false },
  monetization: { limits: {} as Record<string, unknown> },
  subjects: {
    kinds: [{ kind: 'person', singular: 'Person', plural: 'People', allowSelfLink: true }],
  },
  name: 'Template',
}))
vi.mock('@/lib/config/app', () => ({ APP_CONFIG: mockConfig }))

// Imports AFTER the mock so the modules see the mocked config.
import {
  GRANT_CODE_CHARSET,
  GRANT_CODE_LENGTH,
  mintGrantCode,
  resolveGrant,
  grantHasScope,
  logGrantActivity,
  mintGrant,
  revokeGrantsForSubject,
  revokeGrantsForLapsedOrg,
  GRANT_ACTIVITY_MAX_ROWS,
  type Grant,
} from './access-grant'
import { onSubjectArchived } from './subjects'
import { grantViewComposer } from '../grant-config'

/** Render a captured drizzle condition to parameterized SQL (no DB needed). */
function renderSql(condition: SQL): { sql: string; params: unknown[] } {
  const q = new PgDialect().sqlToQuery(condition)
  return { sql: q.sql, params: q.params }
}

function makeGrant(over: Partial<Grant> = {}): Grant {
  const now = Date.now()
  return {
    id: 'g1',
    organizationId: 'org1',
    subjectId: null,
    granteeName: 'Robin',
    granteeEmail: null,
    code: 'ABCDEFGHJK',
    scopes: ['view:subjects'],
    startsAt: new Date(now - 3_600_000),
    expiresAt: new Date(now + 3_600_000),
    revokedAt: null,
    lastUsedAt: null,
    useCount: 1,
    createdByUserId: 'u1',
    createdAt: new Date(now - 3_600_000),
    updatedAt: new Date(now - 3_600_000),
    ...over,
  }
}

afterEach(() => {
  mockConfig.features.subjects = true
  mockConfig.grants.maxDurationDays = 30
  vi.restoreAllMocks()
})

// ─── Code mint ─────────────────────────────────────────────────────────────────────────────────

describe('mintGrantCode', () => {
  it('charset is 32 unambiguous chars — 32 divides 256, so byte % 32 has ZERO modulo bias', () => {
    expect(GRANT_CODE_CHARSET).toHaveLength(32)
    expect(256 % GRANT_CODE_CHARSET.length).toBe(0)
    // The ambiguity cull: no I/O/0/1 (the human-typeable-code contract).
    for (const ch of ['I', 'O', '0', '1']) expect(GRANT_CODE_CHARSET).not.toContain(ch)
    // No duplicates (a duplicate would silently skew the distribution).
    expect(new Set(GRANT_CODE_CHARSET).size).toBe(32)
  })

  it('mints codes of the requested length from the charset only', () => {
    const code = mintGrantCode()
    expect(code).toHaveLength(GRANT_CODE_LENGTH)
    for (const ch of code) expect(GRANT_CODE_CHARSET).toContain(ch)
    expect(mintGrantCode(6)).toHaveLength(6)
  })
})

// ─── Resolve predicate matrix ──────────────────────────────────────────────────────────────────

/** select().from().where().limit() → rows; update().set().where() records the bump. */
function resolveDb(row: Grant | undefined, opts: { bumpThrows?: boolean } = {}) {
  const bumps: Record<string, unknown>[] = []
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        bumps.push(v)
        return {
          where: () =>
            opts.bumpThrows ? Promise.reject(new Error('bump failed')) : Promise.resolve(),
        }
      },
    }),
  }
  return { db: db as unknown as DB, bumps }
}

describe('resolveGrant (predicate re-run per request)', () => {
  it("missing code → 'invalid'", async () => {
    expect(await resolveGrant(resolveDb(undefined).db, 'NOPE44NOPE')).toEqual({ status: 'invalid' })
  })

  it("revoked → 'invalid' — indistinguishable from missing (no oracle)", async () => {
    const revoked = makeGrant({ revokedAt: new Date() })
    expect(await resolveGrant(resolveDb(revoked).db, revoked.code)).toEqual({ status: 'invalid' })
  })

  it("pre-start → 'not_started' with the grant (window metadata for the NAMED grantee)", async () => {
    const future = makeGrant({
      startsAt: new Date(Date.now() + 3_600_000),
      expiresAt: new Date(Date.now() + 7_200_000),
    })
    const res = await resolveGrant(resolveDb(future).db, future.code)
    expect(res).toEqual({ status: 'not_started', grant: future })
  })

  it("expired → 'expired' (boundary: expiresAt == now is already expired)", async () => {
    const past = makeGrant({
      startsAt: new Date(Date.now() - 7_200_000),
      expiresAt: new Date(Date.now() - 1),
    })
    const res = await resolveGrant(resolveDb(past).db, past.code)
    expect(res).toEqual({ status: 'expired', grant: past })
  })

  it("active → 'active' + fire-and-forget useCount/lastUsedAt bump", async () => {
    const live = makeGrant()
    const { db, bumps } = resolveDb(live)
    const res = await resolveGrant(db, live.code)
    expect(res).toEqual({ status: 'active', grant: live })
    expect(bumps).toHaveLength(1)
    expect(bumps[0]).toHaveProperty('useCount')
    expect(bumps[0]).toHaveProperty('lastUsedAt')
  })

  it('a bump failure NEVER fails the read (usage telemetry is best-effort)', async () => {
    const live = makeGrant()
    const res = await resolveGrant(resolveDb(live, { bumpThrows: true }).db, live.code)
    expect(res.status).toBe('active')
  })
})

// ─── Scope check ───────────────────────────────────────────────────────────────────────────────

describe('grantHasScope', () => {
  it('case-normalizes both sides', () => {
    const g = makeGrant({ scopes: ['View:Subjects', ' LOG:FEEDING '] })
    expect(grantHasScope(g, 'view:subjects')).toBe(true)
    expect(grantHasScope(g, 'VIEW:SUBJECTS')).toBe(true)
    expect(grantHasScope(g, 'log:feeding')).toBe(true)
    expect(grantHasScope(g, 'log:walk')).toBe(false)
  })
})

// ─── Activity log + amortized prune ────────────────────────────────────────────────────────────

/** insert/select/delete chain fake for logGrantActivity. */
function activityDb(staleRows: { id: string }[]) {
  const inserted: Record<string, unknown>[] = []
  let offsetArg: number | undefined
  let deleted = 0
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v)
        return Promise.resolve()
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            offset: (n: number) => {
              offsetArg = n
              return Promise.resolve(staleRows)
            },
          }),
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        deleted++
        return Promise.resolve()
      },
    }),
  }
  return {
    db: db as unknown as DB,
    inserted,
    get offsetArg() {
      return offsetArg
    },
    get deleted() {
      return deleted
    },
  }
}

describe('logGrantActivity', () => {
  it('appends the row org-stamped from the GRANT (never caller input)', async () => {
    const fake = activityDb([])
    await logGrantActivity(fake.db, makeGrant({ useCount: 3 }), { action: 'view' })
    expect(fake.inserted).toHaveLength(1)
    expect(fake.inserted[0]).toMatchObject({ organizationId: 'org1', grantId: 'g1', action: 'view' })
    // useCount 3 % 25 !== 0 → no prune round-trip this call.
    expect(fake.offsetArg).toBeUndefined()
  })

  it('prunes past GRANT_ACTIVITY_MAX_ROWS on the amortized (useCount % 25 === 0) tick', async () => {
    const fake = activityDb([{ id: 'old1' }, { id: 'old2' }])
    await logGrantActivity(fake.db, makeGrant({ useCount: 50 }), { action: 'view' })
    expect(fake.offsetArg).toBe(GRANT_ACTIVITY_MAX_ROWS) // keep the newest 500, fetch the tail
    expect(fake.deleted).toBe(1)
  })

  it('skips the delete when nothing is beyond the cap', async () => {
    const fake = activityDb([])
    await logGrantActivity(fake.db, makeGrant({ useCount: 25 }), { action: 'view' })
    expect(fake.offsetArg).toBe(GRANT_ACTIVITY_MAX_ROWS)
    expect(fake.deleted).toBe(0)
  })

  it('NEVER throws — an audit failure must not fail the care action', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = {
      insert: () => ({ values: () => Promise.reject(new Error('db down')) }),
    } as unknown as DB
    await expect(logGrantActivity(db, makeGrant(), { action: 'view' })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

// ─── Mint: duration bounds + unique-retry ──────────────────────────────────────────────────────

/** insert().values().returning() that throws per the queued errors, then succeeds. */
function mintDb(failures: unknown[]) {
  const attempts: Record<string, unknown>[] = []
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        attempts.push(v)
        return {
          returning: () => {
            const err = failures.shift()
            if (err) return Promise.reject(err)
            return Promise.resolve([makeGrant({ code: String(v.code) })])
          },
        }
      },
    }),
  }
  return { db: db as unknown as DB, attempts }
}

const mintInput = (over: Partial<Parameters<typeof mintGrant>[1]> = {}) => ({
  organizationId: 'org1',
  granteeName: 'Robin',
  scopes: ['view:subjects'],
  startsAt: new Date('2026-07-01T00:00:00Z'),
  expiresAt: new Date('2026-07-08T00:00:00Z'),
  createdByUserId: 'u1',
  ...over,
})

describe('mintGrant', () => {
  it('rejects a non-positive window (expiry must be after start)', async () => {
    await expect(
      mintGrant(mintDb([]).db, mintInput({ expiresAt: new Date('2026-07-01T00:00:00Z') })),
    ).rejects.toThrow(/after its start/)
  })

  it('caps the window at APP_CONFIG.grants.maxDurationDays (bounded BY CONSTRUCTION)', async () => {
    await expect(
      mintGrant(
        mintDb([]).db,
        mintInput({ expiresAt: new Date('2026-08-01T00:00:00.001Z') }), // 31 days + 1ms
      ),
    ).rejects.toThrow(/capped at 30 days/)
    // Exactly the cap is allowed.
    const ok = await mintGrant(
      mintDb([]).db,
      mintInput({ expiresAt: new Date('2026-07-31T00:00:00Z') }),
    )
    expect(ok.id).toBe('g1')
  })

  it('re-mints on unique-violation (23505) — a collision retries with a FRESH code', async () => {
    const unique = { code: '23505' }
    const fake = mintDb([unique, unique])
    const created = await mintGrant(fake.db, mintInput())
    expect(fake.attempts).toHaveLength(3)
    expect(created.organizationId).toBe('org1')
    // Every attempt carried a code of the right shape (fresh mint per loop).
    for (const a of fake.attempts) expect(String(a.code)).toHaveLength(GRANT_CODE_LENGTH)
  })

  it('gives up after 6 attempts (persistent collision = something else is broken)', async () => {
    const unique = { code: '23505' }
    const fake = mintDb([unique, unique, unique, unique, unique, unique, unique])
    await expect(mintGrant(fake.db, mintInput())).rejects.toEqual(unique)
    expect(fake.attempts).toHaveLength(6)
  })

  it('a non-unique-violation error surfaces immediately (no blind retry)', async () => {
    const boom = new Error('connection reset')
    const fake = mintDb([boom])
    await expect(mintGrant(fake.db, mintInput())).rejects.toThrow('connection reset')
    expect(fake.attempts).toHaveLength(1)
  })
})

// ─── Revoke levers ─────────────────────────────────────────────────────────────────────────────

/** update().set().where() capturing the condition, returning().length for the lapse counter. */
function revokeDb() {
  const wheres: SQL[] = []
  const db = {
    update: () => ({
      set: () => ({
        where: (w: SQL) => {
          wheres.push(w)
          const thenable = Promise.resolve()
          return Object.assign(thenable, {
            returning: () => Promise.resolve([{ id: 'g1' }, { id: 'g2' }]),
          })
        },
      }),
    }),
  }
  return { db: db as unknown as DB, wheres }
}

describe('subject-archive + lapse revoke levers', () => {
  it('revokeGrantsForSubject is registered on the onSubjectArchived registry at module load', () => {
    expect(onSubjectArchived).toContain(revokeGrantsForSubject)
  })

  it('soft-revokes only LIVE grants pinned to the archived subject (org-fenced)', async () => {
    const { db, wheres } = revokeDb()
    await revokeGrantsForSubject(db, 'org1', 'subj1')
    const { sql, params } = renderSql(wheres[0]!)
    expect(sql).toMatch(/"organization_id" = /)
    expect(sql).toMatch(/"subject_id" = /)
    expect(sql).toMatch(/"revoked_at" is null/)
    expect(params).toEqual(expect.arrayContaining(['org1', 'subj1']))
  })

  it('revokeGrantsForLapsedOrg (INERT lever — nothing calls it by default) revokes all live org grants', async () => {
    const { db, wheres } = revokeDb()
    const n = await revokeGrantsForLapsedOrg(db, 'org1')
    expect(n).toBe(2)
    const { sql, params } = renderSql(wheres[0]!)
    expect(sql).toMatch(/"organization_id" = /)
    expect(sql).toMatch(/"revoked_at" is null/)
    expect(sql).not.toMatch(/"subject_id"/)
    expect(params).toContain('org1')
  })
})

// ─── Lifecycle walk (mint → resolve active → scope → activity → revoke → invalid) ──────────────
// The route-level e2e path over a stateful fake: what worker/routes/grants.ts +
// grant-public.ts compose out of these lib pieces, in order.

describe('grant lifecycle', () => {
  it('mint → resolve active → act scope enforced → activity logged → revoke → resolve invalid', async () => {
    const state: { grant?: Grant; activity: Record<string, unknown>[] } = { activity: [] }
    const db = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          if ('grantId' in v) {
            // logGrantActivity's insert — the per-grant audit trail.
            state.activity.push(v)
            return Promise.resolve()
          }
          // mintGrant's insert. useCount 3 keeps the amortized prune branch quiet here.
          const row = makeGrant({ ...(v as Partial<Grant>), useCount: 3 })
          state.grant = row
          return { returning: () => Promise.resolve([row]) }
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(state.grant ? [state.grant] : []),
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as unknown as DB

    // 1 · Mint (bounded window, scoped).
    const grant = await mintGrant(db, mintInput({ scopes: ['view:subjects'] }))
    expect(grant.code).toHaveLength(GRANT_CODE_LENGTH)

    // 2 · Resolve while inside the window → active. (mintInput's window is fixed dates; pin now.)
    state.grant = { ...grant, startsAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 3_600_000) }
    const live = await resolveGrant(db, grant.code)
    expect(live.status).toBe('active')

    // 3 · Act: the scope re-check the /act route runs per call.
    expect(grantHasScope(state.grant, 'view:subjects')).toBe(true)
    expect(grantHasScope(state.grant, 'log:feeding')).toBe(false)

    // 4 · Activity rows land (incl. the 'view' row the public GET writes).
    await logGrantActivity(db, state.grant, { action: 'view' })
    await logGrantActivity(db, state.grant, { action: 'log', entityType: 'demo_log', entityId: 'd1' })
    expect(state.activity.map((a) => a.action)).toEqual(['view', 'log'])
    expect(state.activity[1]).toMatchObject({ entityType: 'demo_log', entityId: 'd1' })

    // 5 · Revoke (the owner route's soft-revoke) → the SAME code now resolves 'invalid' —
    //     indistinguishable from a code that never existed.
    state.grant = { ...state.grant, revokedAt: new Date() }
    expect(await resolveGrant(db, grant.code)).toEqual({ status: 'invalid' })
  })
})

// ─── Default composer privacy (grant-config.ts) ────────────────────────────────────────────────

/** select(cols).from().where(w).orderBy() capturing the column allowlist + the fence. */
function composerDb(rows: Record<string, unknown>[]) {
  let selected: Record<string, unknown> | undefined
  const wheres: SQL[] = []
  const db = {
    select: (cols: Record<string, unknown>) => {
      selected = cols
      return {
        from: () => ({
          where: (w: SQL) => {
            wheres.push(w)
            return { orderBy: () => Promise.resolve(rows) }
          },
        }),
      }
    },
  }
  return {
    db: db as unknown as DB,
    wheres,
    get selected() {
      return selected
    },
  }
}

describe('grantViewComposer (default — the privacy allowlist)', () => {
  it('selects ONLY { id, kind, displayName, birthDate } — no avatar/media (M-3), no notes/profile/selfUserId/ids', async () => {
    const fake = composerDb([{ id: 's1', kind: 'person', displayName: 'Mom', birthDate: null }])
    const view = await grantViewComposer(fake.db, makeGrant())
    expect(Object.keys(fake.selected ?? {}).sort()).toEqual([
      'birthDate',
      'displayName',
      'id',
      'kind',
    ])
    const payload = JSON.stringify(view)
    for (const banned of ['avatar', 'notes', 'profile', 'selfUserId', 'member', 'userId', 'http']) {
      expect(payload).not.toContain(banned)
    }
    expect(view).toEqual({ subjects: [{ id: 's1', kind: 'person', displayName: 'Mom', birthDate: null }] })
  })

  it('filters to ACTIVE subjects of the GRANT’s org; a pinned grant composes just its subject', async () => {
    const fake = composerDb([])
    await grantViewComposer(fake.db, makeGrant({ subjectId: 'subj9' }))
    const { sql, params } = renderSql(fake.wheres[0]!)
    expect(sql).toMatch(/"organization_id" = /)
    expect(sql).toMatch(/"archived_at" is null/)
    expect(sql).toMatch(/"id" = /)
    expect(params).toEqual(expect.arrayContaining(['org1', 'subj9']))
  })

  it("without the 'view:subjects' scope (or with features.subjects off) composes an EMPTY view", async () => {
    const fake = composerDb([{ id: 's1' }])
    expect(await grantViewComposer(fake.db, makeGrant({ scopes: ['log:feeding'] }))).toEqual({})
    mockConfig.features.subjects = false
    expect(await grantViewComposer(fake.db, makeGrant())).toEqual({})
  })
})
