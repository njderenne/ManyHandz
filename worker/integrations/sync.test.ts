import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { schema, type DB } from '@/lib/db'
import type { Env } from '../env'

/**
 * Provider pull-sync — the registry sweep tested against a scripted in-memory DB (the
 * escalation.test.ts stub doctrine): we model exactly the drizzle chains the sweep issues, so
 * the bookkeeping + skip semantics are tested for real rather than assumed.
 *
 * The load-bearing assertions:
 *   • no pullers registered ⇒ `{}` with ZERO db work (the stock template pays nothing).
 *   • a completed pull stamps lastSyncedAt on BOTH provider_token and sync_state.
 *   • soft-fail isolation: one throwing puller poisons only its provider's rollup — other rows
 *     still run and stamp.
 *   • M-11: a user with NO personal org is SKIPPED with the `integrations.sync.no_destination`
 *     structured log — the puller is never invoked, so a write to another org is impossible.
 *   • a hard `result.error` leaves the checkpoint unstamped (the row retries from its old cursor).
 */

const dbHolder = vi.hoisted(() => ({ current: null as unknown, getDbCalls: 0 }))

vi.mock('@/lib/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...mod,
    getDb: () => {
      dbHolder.getDbCalls += 1
      return dbHolder.current as ReturnType<typeof mod.getDb>
    },
  }
})

import {
  providerPullers,
  syncAllProviders,
  resolvePersonalOrgId,
  type SyncResult,
  type SyncTokenRow,
} from './sync'

// ---------------------------------------------------------------------------
// Fake DB — speaks the exact chain shapes sync.ts issues
// ---------------------------------------------------------------------------

/** Recursively pull bound values out of a drizzle condition (Param objects carry `.value`;
 *  columns carry `.table` and are skipped) — the escalation.test.ts helper. */
function extractParams(node: unknown, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== 'object') return out
  const anyNode = node as Record<string, unknown>
  if (Array.isArray(anyNode.queryChunks)) {
    for (const chunk of anyNode.queryChunks) extractParams(chunk, out)
  }
  if ('value' in anyNode && !('table' in anyNode)) out.push(anyNode.value)
  return out
}

type TokenRow = {
  userId: string
  provider: string
  ciphertext: string
  expiresAt: Date | null
  lastSyncedAt: Date | null
}

type RecordedUpdate = { table: unknown; values: Record<string, unknown>; params: unknown[] }

function makeFakeDb(script: {
  tokens: TokenRow[]
  /** userId → personal orgId (null = multi-org user with no personal org). */
  personalByUser: Record<string, string | null>
}) {
  const updates: RecordedUpdate[] = []
  let tokenScans = 0
  let memberLookups = 0

  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.providerToken) {
          tokenScans += 1
          // Production chains .where().orderBy(lastSyncedAt asc nulls first).limit(MAX_TOKENS_PER_RUN)
          // for the per-run cap; the mock mirrors that shape and returns the scripted rows in order.
          return {
            where: () => ({
              orderBy: () => ({ limit: async () => script.tokens }),
            }),
          }
        }
        if (table === schema.member) {
          return {
            innerJoin: () => ({
              where: (cond: unknown) => ({
                limit: async () => {
                  memberLookups += 1
                  // The first bound param of the where() is the userId (eq(member.userId, …)).
                  const userId = extractParams(cond).find((p) => typeof p === 'string')
                  const orgId = script.personalByUser[userId as string] ?? null
                  return orgId ? [{ orgId }] : []
                },
              }),
            }),
          }
        }
        throw new Error('unexpected select target')
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          updates.push({ table, values, params: extractParams(cond) })
        },
      }),
    }),
  }

  return {
    asDb: () => db as unknown as DB,
    updates,
    counts: { tokenScans: () => tokenScans, memberLookups: () => memberLookups },
  }
}

const env = { DATABASE_URL: 'postgres://unit-test' } as unknown as Env

function token(userId: string, provider: string): TokenRow {
  return { userId, provider, ciphertext: 'enc', expiresAt: null, lastSyncedAt: null }
}

function okResult(row: SyncTokenRow, inserted = 1): SyncResult {
  return { provider: row.provider, userId: row.userId, inserted, skipped: 0 }
}

beforeEach(() => {
  for (const key of Object.keys(providerPullers)) delete providerPullers[key]
  dbHolder.getDbCalls = 0
})

afterEach(() => {
  for (const key of Object.keys(providerPullers)) delete providerPullers[key]
  vi.restoreAllMocks()
})

describe('syncAllProviders', () => {
  it('returns {} with zero db work when no pullers are registered', async () => {
    const rollup = await syncAllProviders(env)
    expect(rollup).toEqual({})
    expect(dbHolder.getDbCalls).toBe(0)
  })

  it('runs a registered puller with the destination org resolved and stamps both checkpoints', async () => {
    const fake = makeFakeDb({
      tokens: [token('user_1', 'acme')],
      personalByUser: { user_1: 'org_personal_1' },
    })
    dbHolder.current = fake.asDb()

    const seen: SyncTokenRow[] = []
    providerPullers.acme = async (_env, row) => {
      seen.push(row)
      return okResult(row, 3)
    }

    const rollup = await syncAllProviders(env)
    expect(rollup).toEqual({ acme: { ok: true, synced: 3 } })

    // The puller received the caller's token row + the pre-resolved personal destination.
    expect(seen).toHaveLength(1)
    expect(seen[0].userId).toBe('user_1')
    expect(seen[0].destinationOrgId).toBe('org_personal_1')

    // lastSyncedAt stamped on BOTH tables, targeting (user, provider).
    const tokenStamp = fake.updates.find((u) => u.table === schema.providerToken)
    const stateStamp = fake.updates.find((u) => u.table === schema.syncState)
    expect(tokenStamp?.values.lastSyncedAt).toBeInstanceOf(Date)
    expect(stateStamp?.values.lastSyncedAt).toBeInstanceOf(Date)
    expect(tokenStamp?.params).toEqual(expect.arrayContaining(['user_1', 'acme']))
  })

  it('M-11: a user with no personal org is skipped with the no_destination log — puller never runs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fake = makeFakeDb({
      tokens: [token('user_multi', 'acme'), token('user_ok', 'acme')],
      personalByUser: { user_multi: null, user_ok: 'org_personal_ok' },
    })
    dbHolder.current = fake.asDb()

    const pulled: string[] = []
    providerPullers.acme = async (_env, row) => {
      pulled.push(row.userId)
      return okResult(row)
    }

    const rollup = await syncAllProviders(env)

    // The destination-less user never reached the puller — no write anywhere was possible.
    expect(pulled).toEqual(['user_ok'])
    expect(rollup.acme).toEqual({ ok: true, synced: 1 })
    expect(
      log.mock.calls.some((c) => String(c[0]).includes('integrations.sync.no_destination')),
    ).toBe(true)
    // And no checkpoint stamp for the skipped user.
    expect(fake.updates.every((u) => !u.params.includes('user_multi'))).toBe(true)
  })

  it('soft-fail: a throwing puller poisons only its provider; other rows still run + stamp', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = makeFakeDb({
      tokens: [token('user_1', 'broken'), token('user_2', 'healthy')],
      personalByUser: { user_1: 'org_1', user_2: 'org_2' },
    })
    dbHolder.current = fake.asDb()

    providerPullers.broken = async () => {
      throw new Error('provider exploded')
    }
    providerPullers.healthy = async (_env, row) => okResult(row, 2)

    const rollup = await syncAllProviders(env)
    expect(rollup.broken).toEqual({ ok: false, synced: 0, error: 'provider exploded' })
    expect(rollup.healthy).toEqual({ ok: true, synced: 2 })
    // The failing row never stamped; the healthy one did.
    expect(fake.updates.every((u) => !u.params.includes('user_1'))).toBe(true)
    expect(fake.updates.some((u) => u.params.includes('user_2'))).toBe(true)
    expect(err.mock.calls.some((c) => String(c[0]).includes('integrations.sync.failed'))).toBe(true)
  })

  it('a hard result.error leaves the checkpoint unstamped (row retries from its old cursor)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = makeFakeDb({
      tokens: [token('user_1', 'acme')],
      personalByUser: { user_1: 'org_1' },
    })
    dbHolder.current = fake.asDb()

    providerPullers.acme = async (_env, row) => ({
      provider: row.provider,
      userId: row.userId,
      inserted: 0,
      skipped: 0,
      error: 'token_refresh_failed',
    })

    const rollup = await syncAllProviders(env)
    expect(rollup.acme).toEqual({ ok: false, synced: 0, error: 'token_refresh_failed' })
    expect(fake.updates).toHaveLength(0)
  })

  it('a warning still counts as ran: logged, stamped, ok stays true', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = makeFakeDb({
      tokens: [token('user_1', 'acme')],
      personalByUser: { user_1: 'org_1' },
    })
    dbHolder.current = fake.asDb()

    providerPullers.acme = async (_env, row) => ({ ...okResult(row, 1), warning: 'no_body_weight' })

    const rollup = await syncAllProviders(env)
    expect(rollup.acme).toEqual({ ok: true, synced: 1 })
    expect(fake.updates.length).toBeGreaterThan(0)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('integrations.sync.warning'))).toBe(true)
  })

  it('resolves each user once per sweep, however many providers they connected', async () => {
    const fake = makeFakeDb({
      tokens: [token('user_1', 'a'), token('user_1', 'b')],
      personalByUser: { user_1: 'org_1' },
    })
    dbHolder.current = fake.asDb()

    providerPullers.a = async (_env, row) => okResult(row)
    providerPullers.b = async (_env, row) => okResult(row)

    await syncAllProviders(env)
    expect(fake.counts.memberLookups()).toBe(1)
  })
})

describe('resolvePersonalOrgId', () => {
  it('returns the personal org id, or null when the user has none (no fallback — M-11)', async () => {
    const fake = makeFakeDb({ tokens: [], personalByUser: { u1: 'org_p', u2: null } })
    expect(await resolvePersonalOrgId(fake.asDb(), 'u1')).toBe('org_p')
    expect(await resolvePersonalOrgId(fake.asDb(), 'u2')).toBeNull()
  })
})
