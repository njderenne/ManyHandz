import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { schema, type DB } from '@/lib/db'
import type { Env } from '../env'
import {
  escalationSources,
  smsRecipientResolver,
  sweepEscalations,
  advanceEscalations,
  resolveEscalation,
  snoozeEscalation,
  type EscalationSlot,
} from './escalation'
import { sendSms } from './sms'

/**
 * Escalation engine — the SAFETY state machine, tested against a scripted in-memory DB (the
 * oversight.test.ts stub doctrine, grown to a stateful store: we model exactly the drizzle
 * chains the engine issues, and the unique-index conflict semantics of `escalation_slot_idx`,
 * so idempotence is tested for real rather than assumed).
 *
 * notify() is mocked (its own fan-out is covered by its module); sendSms is mocked so no test
 * ever touches the network — but smsConfigured / smsAllowed / recordSmsSent run REAL against a
 * fake env + KV, so the dormancy + daily-cap brakes (M-5) are exercised end to end.
 *
 * Times use the shipped config defaults (stages reminder→follow_up→alert→missed, dwell
 * 15/30/60, smsStage 'alert', dailySmsCap 10): entry offsets from scheduledFor are
 * follow_up +15m, alert +45m, missed +105m.
 */

vi.mock('../notify', () => ({ notify: vi.fn(async () => undefined) }))
vi.mock('./sms', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./sms')>()
  return { ...mod, sendSms: vi.fn(async () => ({ ok: true, sid: 'SM_test' })) }
})

import { notify } from '../notify'
const sendSmsMock = vi.mocked(sendSms)
const notifyMock = vi.mocked(notify)

// ---------------------------------------------------------------------------
// Fake DB — a stateful store speaking the exact chain shapes the engine uses
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> & { id: string }

/** Recursively pull bound values out of a drizzle condition (Param objects carry `.value`;
 *  columns carry `.table` and are skipped). Lets update() find its target row by id without
 *  interpreting SQL — every engine update includes eq(escalation.id, …). */
function extractParams(node: unknown, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== 'object') return out
  const anyNode = node as Record<string, unknown>
  if (Array.isArray(anyNode.queryChunks)) {
    for (const chunk of anyNode.queryChunks) extractParams(chunk, out)
  }
  if ('value' in anyNode && !('table' in anyNode)) out.push(anyNode.value)
  return out
}

/** The slot-identity key enforced by escalation_slot_idx. */
function slotKey(r: { organizationId: unknown; entityType: unknown; entityId: unknown; scheduledFor: unknown }): string {
  return `${r.organizationId}|${r.entityType}|${r.entityId}|${new Date(r.scheduledFor as Date).getTime()}`
}

class FakeDb {
  escalations: Row[] = []
  /** Live-member rows served to the engine's fan-out audience read. */
  members: { userId: string }[] = [{ userId: 'user_1' }]
  private nextId = 1

  select(_fields?: unknown) {
    const state: { table?: unknown } = {}
    const resolveRows = (): unknown[] => {
      if (state.table === schema.member) return this.members.map((m) => ({ ...m }))
      // The only escalation select the engine issues is the unresolved list.
      return this.escalations.filter((r) => r.resolvedAt == null).map((r) => ({ ...r }))
    }
    const chain = {
      from: (t: unknown) => ((state.table = t), chain),
      where: () => chain,
      limit: () => chain,
      orderBy: () => chain,
      then: (onF: (v: unknown[]) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolveRows()).then(onF, onR),
    }
    return chain
  }

  insert(_table: unknown) {
    let vals: Record<string, unknown>
    const chain = {
      values: (v: Record<string, unknown>) => ((vals = v), chain),
      onConflictDoNothing: () => chain,
      returning: () => {
        // escalation_slot_idx semantics: a duplicate slot insert is a silent no-op.
        if (this.escalations.some((r) => slotKey(r as never) === slotKey(vals as never))) {
          return Promise.resolve([])
        }
        const row: Row = {
          id: `esc_${this.nextId++}`,
          subjectId: null,
          snoozedUntil: null,
          smsSentAt: null,
          resolvedAt: null,
          resolution: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...vals,
        }
        this.escalations.push(row)
        return Promise.resolve([{ id: row.id }])
      },
    }
    return chain
  }

  update(_table: unknown) {
    let setVals: Record<string, unknown> = {}
    let cond: unknown
    const apply = (): Row[] => {
      const params = extractParams(cond)
      const updated: Row[] = []
      for (const r of this.escalations) {
        if (r.resolvedAt != null) continue // every engine update guards isNull(resolvedAt)
        if (!params.includes(r.id)) continue
        Object.assign(r, setVals)
        updated.push({ ...r })
      }
      return updated
    }
    const chain = {
      set: (v: Record<string, unknown>) => ((setVals = v), chain),
      where: (w: unknown) => ((cond = w), chain),
      returning: () => Promise.resolve(apply()),
      then: (onF: (v: Row[]) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(apply()).then(onF, onR),
    }
    return chain
  }

  asDb(): DB {
    return this as unknown as DB
  }
}

// ---------------------------------------------------------------------------
// Fake env — real KV semantics for the daily-cap counter
// ---------------------------------------------------------------------------

function fakeEnv(kv: Map<string, string>, opts: { twilio?: boolean } = {}): Env {
  const twilio = opts.twilio ?? true
  return {
    RATE_LIMIT: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
    },
    DATABASE_URL: 'postgres://test',
    BETTER_AUTH_SECRET: 'test',
    BETTER_AUTH_URL: 'http://localhost',
    ...(twilio
      ? { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'token', TWILIO_FROM_NUMBER: '+15550000000' }
      : {}),
  } as unknown as Env
}

// Shipped config defaults (see module doc): entry offsets from scheduledFor.
const NOW = new Date('2026-07-05T12:00:00.000Z')
const MIN = 60 * 1000
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * MIN)

function seedRow(db: FakeDb, over: Partial<Row> = {}): Row {
  const row: Row = {
    id: `seed_${db.escalations.length + 1}`,
    organizationId: 'org_1',
    subjectId: null,
    entityType: 'chore',
    entityId: 'chore_1',
    scheduledFor: minutesAgo(0),
    currentStage: 'reminder',
    stageTimestamps: { reminder: minutesAgo(0).toISOString() },
    snoozedUntil: null,
    smsSentAt: null,
    resolvedAt: null,
    resolution: null,
    createdAt: minutesAgo(0),
    updatedAt: minutesAgo(0),
    ...over,
  }
  db.escalations.push(row)
  return row
}

/**
 * Wrap db.update so the FIRST write targeting `rowId` rejects once (a Neon blip / serialization
 * error), then every later write passes through — the transient-failure shape both safety tests
 * below exercise. Installed via vi.spyOn; callers vi.restoreAllMocks() when done.
 */
function failFirstUpdateOn(db: FakeDb, rowId: string): void {
  const realUpdate = db.update.bind(db)
  let threw = false
  vi.spyOn(db, 'update').mockImplementation((table: unknown) => {
    const inner = realUpdate(table)
    return {
      set: (v: Record<string, unknown>) => {
        inner.set(v)
        return {
          where: (w: unknown) => {
            const targetsRow = extractParams(w).includes(rowId)
            inner.where(w)
            const rejectOnce = () => {
              threw = true
              return Promise.reject(new Error('neon connection reset'))
            }
            return {
              returning: () => {
                if (targetsRow && !threw) return rejectOnce()
                return inner.returning()
              },
              then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
                if (targetsRow && !threw) return rejectOnce().then(onF, onR)
                return (
                  inner as unknown as {
                    then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => unknown
                  }
                ).then(onF, onR)
              },
            }
          },
        }
      },
    } as unknown as ReturnType<typeof realUpdate>
  })
}

const defaultResolve = smsRecipientResolver.resolve

beforeEach(() => {
  escalationSources.length = 0
  smsRecipientResolver.resolve = defaultResolve
  sendSmsMock.mockClear()
  sendSmsMock.mockResolvedValue({ ok: true, sid: 'SM_test' })
  notifyMock.mockClear()
})

afterEach(() => {
  smsRecipientResolver.resolve = defaultResolve
})

// ---------------------------------------------------------------------------
// sweepEscalations
// ---------------------------------------------------------------------------

describe('sweepEscalations', () => {
  const slot = (over: Partial<EscalationSlot> = {}): EscalationSlot => ({
    organizationId: 'org_1',
    entityType: 'chore',
    entityId: 'chore_1',
    scheduledFor: minutesAgo(5),
    ...over,
  })

  it('is idempotent — a double run opens the slot exactly once (unique-index semantics)', async () => {
    const db = new FakeDb()
    const kv = new Map<string, string>()
    escalationSources.push(async () => [slot()])

    expect(await sweepEscalations(db.asDb(), fakeEnv(kv), NOW)).toEqual({ opened: 1 })
    expect(await sweepEscalations(db.asDb(), fakeEnv(kv), NOW)).toEqual({ opened: 0 })
    expect(db.escalations).toHaveLength(1)
    expect(db.escalations[0].currentStage).toBe('reminder')
    expect((db.escalations[0].stageTimestamps as Record<string, string>).reminder).toBe(NOW.toISOString())
  })

  it('does not open a ladder for a future slot — not late yet', async () => {
    const db = new FakeDb()
    escalationSources.push(async () => [slot({ scheduledFor: new Date(NOW.getTime() + 5 * MIN) })])
    expect(await sweepEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ opened: 0 })
    expect(db.escalations).toHaveLength(0)
  })

  it('opens nothing with no registered sources (the chassis default)', async () => {
    const db = new FakeDb()
    expect(await sweepEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ opened: 0 })
  })

  it('fans the opening push out to live members only when the slot carries notify copy', async () => {
    const db = new FakeDb()
    escalationSources.push(async () => [
      slot({ entityId: 'silent' }), // no notify → silent open
      slot({ entityId: 'noisy', notify: { title: 'Chore due', body: 'Dishes are waiting.' } }),
    ])
    await sweepEscalations(db.asDb(), fakeEnv(new Map()), NOW)
    expect(notifyMock).toHaveBeenCalledTimes(1)
    expect(notifyMock.mock.calls[0][2]).toMatchObject({
      organizationId: 'org_1',
      userId: 'user_1',
      kind: 'escalation.reminder',
      title: 'Chore due',
    })
  })

  it('one throwing source never starves the others', async () => {
    const db = new FakeDb()
    escalationSources.push(async () => {
      throw new Error('bad app registration')
    })
    escalationSources.push(async () => [slot()])
    expect(await sweepEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ opened: 1 })
  })
})

// ---------------------------------------------------------------------------
// advanceEscalations — cumulative-from-scheduledFor pacing (M-4)
// ---------------------------------------------------------------------------

describe('advanceEscalations — pacing', () => {
  it('advances at the EXACT cumulative boundary (scheduledFor + 15m ⇒ follow_up)', async () => {
    const db = new FakeDb()
    seedRow(db, { scheduledFor: minutesAgo(15) })
    const res = await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)
    expect(res).toEqual({ advanced: 1, missed: 0 })
    expect(db.escalations[0].currentStage).toBe('follow_up')
    expect((db.escalations[0].stageTimestamps as Record<string, string>).follow_up).toBe(NOW.toISOString())
  })

  it('holds one minute before the boundary', async () => {
    const db = new FakeDb()
    seedRow(db, { scheduledFor: minutesAgo(14) })
    expect(await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ advanced: 0, missed: 0 })
    expect(db.escalations[0].currentStage).toBe('reminder')
  })

  it('catches up multiple stages in ONE tick (6-hour-gap safety), stamping every entry', async () => {
    // +46m from scheduledFor: past follow_up (+15) AND alert (+45) — a sparse cron must land on
    // alert with BOTH stamps and must not have skipped follow_up's record.
    const db = new FakeDb()
    smsRecipientResolver.resolve = async () => ['+15551112222']
    seedRow(db, { scheduledFor: minutesAgo(46) })

    const res = await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)
    expect(res).toEqual({ advanced: 1, missed: 0 })
    const row = db.escalations[0]
    expect(row.currentStage).toBe('alert')
    const stamps = row.stageTimestamps as Record<string, string>
    expect(stamps.follow_up).toBe(NOW.toISOString())
    expect(stamps.alert).toBe(NOW.toISOString())
    // SMS exactly once even though two stages were crossed.
    expect(sendSmsMock).toHaveBeenCalledTimes(1)
    expect(row.smsSentAt).toEqual(NOW)
    // ONE push for the deepest stage reached — never one per crossed stage.
    expect(notifyMock).toHaveBeenCalledTimes(1)
    expect(notifyMock.mock.calls[0][2]).toMatchObject({ kind: 'escalation.alert' })
  })

  it('a 6-hour gap lands terminal: resolves as missed with every stage stamped', async () => {
    const db = new FakeDb()
    smsRecipientResolver.resolve = async () => ['+15551112222']
    seedRow(db, { scheduledFor: minutesAgo(360) })

    const res = await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)
    expect(res).toEqual({ advanced: 1, missed: 1 })
    const row = db.escalations[0]
    expect(row.currentStage).toBe('missed')
    expect(row.resolvedAt).toEqual(NOW)
    expect(row.resolution).toBe('missed')
    const stamps = row.stageTimestamps as Record<string, string>
    expect(stamps.follow_up).toBeTruthy()
    expect(stamps.alert).toBeTruthy()
    expect(stamps.missed).toBeTruthy()
    // Crossing alert on the way to terminal still fires the SMS exactly once.
    expect(sendSmsMock).toHaveBeenCalledTimes(1)
    // Resolved rows leave the unresolved set — the next tick is a no-op.
    expect(await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ advanced: 0, missed: 0 })
  })

  it('snooze holds the ladder while now < snoozedUntil, then it catches up cumulatively', async () => {
    const db = new FakeDb()
    seedRow(db, { scheduledFor: minutesAgo(20), snoozedUntil: new Date(NOW.getTime() + 10 * MIN) })
    expect(await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ advanced: 0, missed: 0 })
    expect(db.escalations[0].currentStage).toBe('reminder')

    // 11 minutes later the snooze lapsed — the ladder catches up from scheduledFor (now +31m ⇒ follow_up).
    const later = new Date(NOW.getTime() + 11 * MIN)
    expect(await advanceEscalations(db.asDb(), fakeEnv(new Map()), later)).toEqual({ advanced: 1, missed: 0 })
    expect(db.escalations[0].currentStage).toBe('follow_up')
  })

  it('a resolved escalation never advances', async () => {
    const db = new FakeDb()
    seedRow(db, { scheduledFor: minutesAgo(60), resolvedAt: minutesAgo(30), resolution: 'confirmed' })
    expect(await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ advanced: 0, missed: 0 })
    expect(db.escalations[0].currentStage).toBe('reminder')
  })

  it('unknown stage vocab (config drift under an open row): no crash, no advance', async () => {
    const db = new FakeDb()
    seedRow(db, { scheduledFor: minutesAgo(120), currentStage: 'legacy_stage' })
    expect(await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ advanced: 0, missed: 0 })
    expect(db.escalations[0].currentStage).toBe('legacy_stage')
    expect(db.escalations[0].resolvedAt).toBeNull()
  })

  it('per-row isolation: one row\'s transient update failure never starves the rest of the sweep', async () => {
    // Two unresolved rows both due to advance. Make the FIRST row's db.update throw once (a Neon
    // blip / serialization error). For a SAFETY ladder the SECOND row must still advance and the
    // run must return normally — a single flaky row cannot abort the batch (which cron.ts would
    // otherwise log as a whole failed advance sweep, lost until the next coarse tick).
    const db = new FakeDb()
    const first = seedRow(db, { entityId: 'chore_a', scheduledFor: minutesAgo(15) })
    seedRow(db, { entityId: 'chore_b', scheduledFor: minutesAgo(15) })

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    failFirstUpdateOn(db, first.id)

    // Row A throws on its update; row B advances. The run returns rather than propagating.
    const res = await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)
    expect(res).toEqual({ advanced: 1, missed: 0 })
    expect(db.escalations.find((r) => r.entityId === 'chore_b')?.currentStage).toBe('follow_up')
    // Row A never committed — still at its opening stage, retries next tick.
    expect(db.escalations.find((r) => r.entityId === 'chore_a')?.currentStage).toBe('reminder')
    // The failure was structured-logged as escalation.advance_failed, not thrown.
    expect(err.mock.calls.some((c) => String(c[0]).includes('escalation.advance_failed'))).toBe(true)
    vi.restoreAllMocks()
  })
})

// ---------------------------------------------------------------------------
// SMS fallback — dormancy, the smsSentAt latch, and the daily cap (M-5)
// ---------------------------------------------------------------------------

describe('advanceEscalations — SMS fallback', () => {
  it('no TWILIO_* set ⇒ SMS path skips, the ladder STILL advances (push/in-app only)', async () => {
    const db = new FakeDb()
    smsRecipientResolver.resolve = async () => ['+15551112222']
    seedRow(db, { scheduledFor: minutesAgo(45) })

    const res = await advanceEscalations(db.asDb(), fakeEnv(new Map(), { twilio: false }), NOW)
    expect(res).toEqual({ advanced: 1, missed: 0 })
    expect(db.escalations[0].currentStage).toBe('alert')
    expect(db.escalations[0].smsSentAt).toBeNull()
    expect(sendSmsMock).not.toHaveBeenCalled()
  })

  it('the default resolver resolves NOBODY — no SMS ever leaves a stock mint (M-6)', async () => {
    const db = new FakeDb()
    seedRow(db, { scheduledFor: minutesAgo(45) })
    await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)
    expect(db.escalations[0].currentStage).toBe('alert')
    expect(sendSmsMock).not.toHaveBeenCalled()
  })

  it('apps override via the mutable property; sends latch smsSentAt and bump the KV counter', async () => {
    const db = new FakeDb()
    const kv = new Map<string, string>()
    smsRecipientResolver.resolve = async () => ['+15551112222', '+15553334444']
    seedRow(db, { scheduledFor: minutesAgo(45) })

    await advanceEscalations(db.asDb(), fakeEnv(kv), NOW)
    expect(sendSmsMock).toHaveBeenCalledTimes(2) // one per recipient, one fan-out
    expect(sendSmsMock.mock.calls[0][3]).toEqual({ organizationId: 'org_1' })
    expect(db.escalations[0].smsSentAt).toEqual(NOW)
    expect(kv.get(`sms:org_1:${NOW.toISOString().slice(0, 10)}`)).toBe('2')
  })

  it('smsSentAt is the idempotence latch — a later tick never re-sends', async () => {
    const db = new FakeDb()
    smsRecipientResolver.resolve = async () => ['+15551112222']
    seedRow(db, { scheduledFor: minutesAgo(45) })

    await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)
    expect(sendSmsMock).toHaveBeenCalledTimes(1)

    // An hour later the row advances to terminal — alert is behind it; no second SMS.
    const later = new Date(NOW.getTime() + 60 * MIN)
    await advanceEscalations(db.asDb(), fakeEnv(new Map()), later)
    expect(db.escalations[0].currentStage).toBe('missed')
    expect(sendSmsMock).toHaveBeenCalledTimes(1)
  })

  it('COMMIT-BEFORE-SEND: a transient state-commit failure never double-sends (or pre-sends) SMS', async () => {
    // The regression this guards: if side effects fired BEFORE the state commit, a Neon blip on
    // the commit would leave smsSentAt/currentStage unstamped after a REAL Twilio fan-out, and the
    // next tick would re-cross smsStage and re-send to every recipient. With commit-first, a
    // failed tick sends NOTHING and the retry is a clean first attempt — exactly one SMS total.
    const db = new FakeDb()
    smsRecipientResolver.resolve = async () => ['+15551112222']
    const row = seedRow(db, { scheduledFor: minutesAgo(45) }) // crosses alert (the smsStage)

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    failFirstUpdateOn(db, row.id)

    // Tick 1: the commit rejects BEFORE any side effect — no SMS left the building.
    expect(await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ advanced: 0, missed: 0 })
    expect(sendSmsMock).not.toHaveBeenCalled()
    expect(db.escalations[0].currentStage).toBe('reminder')

    // Tick 2: the retry commits, THEN sends — exactly one SMS across both ticks, latch stamped.
    expect(await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ advanced: 1, missed: 0 })
    expect(db.escalations[0].currentStage).toBe('alert')
    expect(sendSmsMock).toHaveBeenCalledTimes(1)
    expect(db.escalations[0].smsSentAt).toEqual(NOW)
    expect(err.mock.calls.some((c) => String(c[0]).includes('escalation.advance_failed'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('daily cap (M-5): the 11th same-UTC-day send is SKIPPED, ladder still advances', async () => {
    const db = new FakeDb()
    const kv = new Map<string, string>()
    kv.set(`sms:org_1:${NOW.toISOString().slice(0, 10)}`, '10') // cap (10) already spent today
    smsRecipientResolver.resolve = async () => ['+15551112222']
    seedRow(db, { scheduledFor: minutesAgo(45) })
    const warn = vi.spyOn(console, 'warn')

    const res = await advanceEscalations(db.asDb(), fakeEnv(kv), NOW)
    expect(res).toEqual({ advanced: 1, missed: 0 })
    expect(sendSmsMock).not.toHaveBeenCalled()
    expect(db.escalations[0].smsSentAt).toBeNull()
    // The over-cap skip is structured-logged (sms.daily_cap_hit).
    expect(warn.mock.calls.some((c) => String(c[0]).includes('sms.daily_cap_hit'))).toBe(true)
    warn.mockRestore()
  })

  it('the cap brakes MID-fan-out — consulted before every send', async () => {
    const db = new FakeDb()
    const kv = new Map<string, string>()
    kv.set(`sms:org_1:${NOW.toISOString().slice(0, 10)}`, '9') // one send left today
    smsRecipientResolver.resolve = async () => ['+15551112222', '+15553334444', '+15555556666']
    seedRow(db, { scheduledFor: minutesAgo(45) })

    await advanceEscalations(db.asDb(), fakeEnv(kv), NOW)
    expect(sendSmsMock).toHaveBeenCalledTimes(1) // 10th went out; 11th+ braked
    expect(db.escalations[0].smsSentAt).toEqual(NOW) // at least one landed ⇒ latched
    expect(kv.get(`sms:org_1:${NOW.toISOString().slice(0, 10)}`)).toBe('10')
  })

  it('a throwing resolver is swallowed — the ladder advances SMS-less', async () => {
    const db = new FakeDb()
    smsRecipientResolver.resolve = async () => {
      throw new Error('app registry bug')
    }
    seedRow(db, { scheduledFor: minutesAgo(45) })
    const res = await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)
    expect(res).toEqual({ advanced: 1, missed: 0 })
    expect(db.escalations[0].currentStage).toBe('alert')
    expect(db.escalations[0].smsSentAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveEscalation / snoozeEscalation — the route-facing verbs
// ---------------------------------------------------------------------------

describe('resolveEscalation / snoozeEscalation', () => {
  it('resolve closes the row and stops advancement; a second resolve is a no-op undefined', async () => {
    const db = new FakeDb()
    const row = seedRow(db, { scheduledFor: minutesAgo(45) })

    const resolved = await resolveEscalation(db.asDb(), 'org_1', row.id, 'confirmed', NOW)
    expect(resolved?.resolution).toBe('confirmed')
    expect(resolved?.resolvedAt).toEqual(NOW)

    expect(await resolveEscalation(db.asDb(), 'org_1', row.id, 'dismissed', NOW)).toBeUndefined()
    expect(await advanceEscalations(db.asDb(), fakeEnv(new Map()), NOW)).toEqual({ advanced: 0, missed: 0 })
  })

  it('snooze sets snoozedUntil without touching the stage or resolving', async () => {
    const db = new FakeDb()
    const row = seedRow(db, { scheduledFor: minutesAgo(20), currentStage: 'follow_up' })
    const until = new Date(NOW.getTime() + 30 * MIN)

    const snoozed = await snoozeEscalation(db.asDb(), 'org_1', row.id, until)
    expect(snoozed?.snoozedUntil).toEqual(until)
    expect(snoozed?.currentStage).toBe('follow_up')
    expect(snoozed?.resolvedAt).toBeNull()
  })
})
