import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Middleware guards for the stage-0-applied worker/middleware/org.ts (SPINE_SPEC §4 — B1 owns
 * this coverage). The context is a hand-rolled stand-in (get/set/req/env/json) and the db is a
 * counting stub, so these tests pin the CONTRACT without Postgres:
 *
 *  - requireOrg resolves membership + org kind + role + member id in exactly ONE query;
 *  - an ARCHIVED member (or a non-member) gets 403 — the join, not the route, is the fence;
 *  - requireCapability adds ZERO queries while policyGates is empty (the default mint);
 *  - the error contract is byte-compatible with the pre-spine chassis (strings + statuses).
 */

// ─── module mocks (hoisted state so the factories can reach it) ───────────

const h = vi.hoisted(() => ({
  state: {
    /** Rows returned per query, FIFO — push one entry per expected SELECT. */
    results: [] as unknown[][],
    /** Number of SELECTs issued — the "one joined read" / "zero added queries" spy. */
    selects: 0,
    /** What getAuth().api.getSession resolves — null = signed out. */
    session: null as unknown,
  },
}))

vi.mock('@/lib/db', async () => {
  const schema = await vi.importActual<typeof import('@/lib/db/schema')>('@/lib/db/schema')
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(h.state.results.shift() ?? []),
  }
  return {
    getDb: () => ({
      select: () => {
        h.state.selects++
        return chain
      },
    }),
    schema,
  }
})

// getAuth is called at runtime by resolveSession — mock the whole auth module so the test never
// constructs Better-Auth (drizzle adapter, mailer, plugins) in the unit tier.
vi.mock('../auth', () => ({
  getAuth: () => ({ api: { getSession: async () => h.state.session } }),
}))

import {
  requireSession,
  requireOrg,
  requireRole,
  requireCapability,
  requireKind,
  requireKindFeature,
} from './org'

// ─── the fake Hono context ────────────────────────────────────────────────

type FakeResponse = { body: { error?: string }; status: number }

function makeCtx(opts: {
  vars?: Record<string, unknown>
  param?: Record<string, string>
} = {}) {
  const vars = new Map<string, unknown>(Object.entries(opts.vars ?? {}))
  return {
    get: (k: string) => vars.get(k),
    set: (k: string, v: unknown) => void vars.set(k, v),
    req: { raw: { headers: new Headers() }, param: (name: string) => opts.param?.[name] },
    env: { DATABASE_URL: 'postgres://unit-test' },
    json: (body: unknown, status = 200): FakeResponse => ({ body: body as { error?: string }, status }),
    vars,
  }
}

/** Run a middleware against the fake context; returns { res, nextCalled }. */
async function run(mw: unknown, ctx: ReturnType<typeof makeCtx>) {
  const next = vi.fn(async () => {})
  const res = (await (mw as (c: unknown, n: () => Promise<void>) => Promise<FakeResponse | undefined>)(
    ctx,
    next,
  )) as FakeResponse | undefined
  return { res, nextCalled: next.mock.calls.length > 0 }
}

const SESSION = { user: { id: 'user-1', name: 'Test' }, session: { activeOrganizationId: 'org-1' } }
// SPINE §10.3 cutover COMPLETE: member.role carries the household vocabulary — requireOrg reads
// it directly (the template shape; the transitional household_role column is gone).
const MEMBERSHIP = { id: 'member-1', role: 'parent', kind: 'family' }

beforeEach(() => {
  h.state.results = []
  h.state.selects = 0
  h.state.session = null
})

// ─── requireSession ───────────────────────────────────────────────────────

describe('requireSession', () => {
  it('401 unauthorized without a session (byte-compatible error string)', async () => {
    const { res, nextCalled } = await run(requireSession, makeCtx())
    expect(res?.status).toBe(401)
    expect(res?.body.error).toBe('unauthorized')
    expect(nextCalled).toBe(false)
  })

  it('passes and caches the session when signed in', async () => {
    h.state.session = SESSION
    const ctx = makeCtx()
    const { nextCalled } = await run(requireSession, ctx)
    expect(nextCalled).toBe(true)
    expect(ctx.vars.get('session')).toBe(SESSION)
  })
})

// ─── requireOrg ───────────────────────────────────────────────────────────

describe('requireOrg', () => {
  it('resolves kind + role + memberId in exactly ONE joined read and sets all four vars', async () => {
    const ctx = makeCtx({ vars: { session: SESSION } })
    h.state.results = [[MEMBERSHIP]]
    const { nextCalled } = await run(requireOrg, ctx)
    expect(nextCalled).toBe(true)
    expect(h.state.selects).toBe(1) // the SPINE §4 "one joined read" guarantee
    expect(ctx.vars.get('orgId')).toBe('org-1')
    expect(ctx.vars.get('orgKind')).toBe('family')
    expect(ctx.vars.get('orgRole')).toBe('parent') // member.role IS the household vocabulary
    expect(ctx.vars.get('orgMemberId')).toBe('member-1')
  })

  it("an archived member's (or non-member's) session gets 403 — the join filters them", async () => {
    // The archived_at IS NULL clause makes an archived membership return zero rows — from the
    // middleware's viewpoint identical to no membership at all. Either way: 403 'forbidden'.
    const ctx = makeCtx({ vars: { session: SESSION } })
    h.state.results = [[]]
    const { res, nextCalled } = await run(requireOrg, ctx)
    expect(res?.status).toBe(403)
    expect(res?.body.error).toBe('forbidden')
    expect(nextCalled).toBe(false)
  })

  it('400 no active organization when the session has none', async () => {
    const ctx = makeCtx({
      vars: { session: { ...SESSION, session: { activeOrganizationId: null } } },
    })
    const { res } = await run(requireOrg, ctx)
    expect(res?.status).toBe(400)
    expect(res?.body.error).toBe('no active organization')
    expect(h.state.selects).toBe(0)
  })

  it('403 when the :orgId param names a DIFFERENT org — before any query runs', async () => {
    const ctx = makeCtx({ vars: { session: SESSION }, param: { orgId: 'org-OTHER' } })
    const { res } = await run(requireOrg, ctx)
    expect(res?.status).toBe(403)
    expect(res?.body.error).toBe('forbidden — not your active organization')
    expect(h.state.selects).toBe(0)
  })

  it('401 unauthorized when signed out', async () => {
    const { res } = await run(requireOrg, makeCtx())
    expect(res?.status).toBe(401)
    expect(res?.body.error).toBe('unauthorized')
  })
})

// ─── requireCapability ────────────────────────────────────────────────────

describe('requireCapability', () => {
  const orgVars = { session: SESSION, orgId: 'org-1', orgKind: 'family', orgRole: 'parent', orgMemberId: 'member-1' }

  it('grants per the matrix with ZERO added queries (default mint: no policyGates)', async () => {
    const ctx = makeCtx({ vars: orgVars })
    const { nextCalled } = await run(requireCapability('org:billing'), ctx)
    expect(nextCalled).toBe(true)
    expect(h.state.selects).toBe(0) // pure check — the policy SELECT never runs
  })

  it('403 forbidden — insufficient permission for an ungranted capability', async () => {
    const ctx = makeCtx({ vars: { ...orgVars, orgRole: 'kid' } })
    const { res, nextCalled } = await run(requireCapability('org:billing'), ctx)
    expect(res?.status).toBe(403)
    expect(res?.body.error).toBe('forbidden — insufficient permission')
    expect(nextCalled).toBe(false)
    expect(h.state.selects).toBe(0) // attacker denied with zero db cost
  })

  it('denies stale/unknown roles and kinds (deny-by-default, no crash)', async () => {
    const staleRole = makeCtx({ vars: { ...orgVars, orgRole: 'ghost' } })
    expect((await run(requireCapability('content:read'), staleRole)).res?.status).toBe(403)
    const staleKind = makeCtx({ vars: { ...orgVars, orgKind: 'legacy-nope' } })
    expect((await run(requireCapability('content:read'), staleKind)).res?.status).toBe(403)
  })

  it("the reserved 'personal' kind grants everything to its owner", async () => {
    const ctx = makeCtx({ vars: { ...orgVars, orgKind: 'personal', orgRole: 'owner' } })
    const { nextCalled } = await run(requireCapability('org:delete'), ctx)
    expect(nextCalled).toBe(true)
  })

  it('500 (programmer error, surfaced loudly) when mounted before requireOrg', async () => {
    const ctx = makeCtx({ vars: { session: SESSION } })
    const { res } = await run(requireCapability('org:billing'), ctx)
    expect(res?.status).toBe(500)
  })
})

// ─── requireRole (LEGACY — retained for app back-compat, B-1) ─────────────

describe('requireRole', () => {
  const orgVars = { session: SESSION, orgId: 'org-1', orgKind: 'team', orgRole: 'admin', orgMemberId: 'member-1' }

  it('reads c.get("orgRole") — no second query, byte-compatible 403 string', async () => {
    const ok = makeCtx({ vars: orgVars })
    expect((await run(requireRole('owner', 'admin'), ok)).nextCalled).toBe(true)
    const denied = makeCtx({ vars: { ...orgVars, orgRole: 'member' } })
    const { res } = await run(requireRole('owner', 'admin'), denied)
    expect(res?.status).toBe(403)
    expect(res?.body.error).toBe('forbidden — insufficient role')
    expect(h.state.selects).toBe(0)
  })
})

// ─── requireKind / requireKindFeature ─────────────────────────────────────

describe('requireKind / requireKindFeature', () => {
  const orgVars = { session: SESSION, orgId: 'org-1', orgKind: 'team', orgRole: 'admin', orgMemberId: 'member-1' }

  it('requireKind: 403 with the kind-neutral message for other kinds', async () => {
    const ok = makeCtx({ vars: orgVars })
    expect((await run(requireKind('team'), ok)).nextCalled).toBe(true)
    const wrong = makeCtx({ vars: { ...orgVars, orgKind: 'personal' } })
    const { res } = await run(requireKind('team'), wrong)
    expect(res?.status).toBe(403)
    expect(res?.body.error).toBe('not available for this organization type')
  })

  it('requireKindFeature: falls back to APP_CONFIG.features (export on, subjects off)', async () => {
    const on = makeCtx({ vars: orgVars })
    expect((await run(requireKindFeature('export'), on)).nextCalled).toBe(true)
    const off = makeCtx({ vars: orgVars })
    const { res } = await run(requireKindFeature('subjects'), off)
    expect(res?.status).toBe(403)
    expect(res?.body.error).toBe('not available for this organization type')
  })
})
