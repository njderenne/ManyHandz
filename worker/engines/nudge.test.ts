import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import {
  PROMPT_CATALOG,
  catalogKeys,
  selectPrompts,
  isDueState,
  runPromptNudges,
  CADENCE_WINDOW_MS,
  type DuePromptState,
  type NudgeIo,
  type PromptDef,
} from './nudge'

/**
 * Prompt/nudge engine — the pure selector + cadence math, plus the cron orchestration proven
 * over an injected I/O seam (NudgeIo): advance-BEFORE-send, the never-double-send window, the
 * run cap, and per-state failure isolation. No DB, no network — the seam is the point.
 */

const NOW = new Date('2026-07-05T12:00:00Z')
const HOUR_MS = 60 * 60 * 1000

let logSpy: MockInstance
let errorSpy: MockInstance
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

// ---------------------------------------------------------------------------
// Catalog invariants — the write-once key rules from the module header
// ---------------------------------------------------------------------------

describe('PROMPT_CATALOG', () => {
  const all = Object.values(PROMPT_CATALOG).flat()

  it('keys are unique across every pack (they live forever in servedPromptKeys)', () => {
    expect(new Set(all.map((p) => p.key)).size).toBe(all.length)
  })

  it('keys are dot-namespaced under their pack, and pack fields match the map key', () => {
    for (const [pack, prompts] of Object.entries(PROMPT_CATALOG)) {
      for (const p of prompts) {
        expect(p.pack).toBe(pack)
        expect(p.key.startsWith(`${pack}.`)).toBe(true)
      }
    }
  })

  it('copy honors the NO GUILT rule — no missed/streak/shame language', () => {
    for (const p of all) {
      expect(p.text).not.toMatch(/you missed|streak|catch.?up|behind|should have/i)
    }
  })

  it('catalogKeys() covers every prompt', () => {
    const keys = catalogKeys()
    for (const p of all) expect(keys.has(p.key)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// selectPrompts — deterministic, non-repeating, pack-safe
// ---------------------------------------------------------------------------

describe('selectPrompts', () => {
  const catalog: Record<string, PromptDef[]> = {
    core: [
      { key: 'core.one', pack: 'core', text: 'One' },
      { key: 'core.two', pack: 'core', text: 'Two' },
    ],
    extra: [{ key: 'extra.one', pack: 'extra', text: 'Extra one' }],
  }

  it('serves in packKeys order, catalog order within a pack', () => {
    const picked = selectPrompts({ packKeys: ['extra', 'core'], servedPromptKeys: [] }, catalog, 3)
    expect(picked.map((p) => p.key)).toEqual(['extra.one', 'core.one', 'core.two'])
  })

  it('NON-REPEATING: served keys are excluded outright', () => {
    const picked = selectPrompts(
      { packKeys: ['core'], servedPromptKeys: ['core.one'] },
      catalog,
      5,
    )
    expect(picked.map((p) => p.key)).toEqual(['core.two'])
  })

  it('PACK-SAFE: disabled packs are never served', () => {
    const picked = selectPrompts({ packKeys: ['core'], servedPromptKeys: [] }, catalog, 5)
    expect(picked.every((p) => p.pack === 'core')).toBe(true)
  })

  it('unknown packs and stale served keys degrade quietly (user data meets a moving catalog)', () => {
    const picked = selectPrompts(
      { packKeys: ['removed-pack', 'core'], servedPromptKeys: ['gone.key'] },
      catalog,
      1,
    )
    expect(picked.map((p) => p.key)).toEqual(['core.one'])
  })

  it('exhausted catalog → empty array; n ≤ 0 → empty array', () => {
    expect(
      selectPrompts({ packKeys: ['core'], servedPromptKeys: ['core.one', 'core.two'] }, catalog, 1),
    ).toEqual([])
    expect(selectPrompts({ packKeys: ['core'], servedPromptKeys: [] }, catalog, 0)).toEqual([])
  })

  it('is deterministic — the route and the cron can never disagree', () => {
    const state = { packKeys: ['core', 'extra'], servedPromptKeys: ['core.one'] }
    expect(selectPrompts(state, catalog, 2)).toEqual(selectPrompts(state, catalog, 2))
  })
})

// ---------------------------------------------------------------------------
// isDueState — the pure twin of the cron's SQL filter
// ---------------------------------------------------------------------------

describe('isDueState', () => {
  const state = (over: Partial<Parameters<typeof isDueState>[0]> = {}) => ({
    cadence: 'daily',
    lastServedAt: null,
    createdAt: new Date(NOW.getTime() - 30 * 24 * HOUR_MS),
    ...over,
  })

  it("cadence 'off' is silence, always", () => {
    expect(isDueState(state({ cadence: 'off' }), NOW)).toBe(false)
  })

  it('unknown cadence strings read as not due (TEXT column, fail-quiet)', () => {
    expect(isDueState(state({ cadence: 'hourly' }), NOW)).toBe(false)
  })

  it('a FRESH state waits one full window from createdAt — never nudged on the next tick', () => {
    const fresh = state({ createdAt: new Date(NOW.getTime() - 6 * HOUR_MS) })
    expect(isDueState(fresh, NOW)).toBe(false)
    const aged = state({ createdAt: new Date(NOW.getTime() - CADENCE_WINDOW_MS.daily) })
    expect(isDueState(aged, NOW)).toBe(true)
  })

  it('daily: due 24h after the last serve, not before', () => {
    expect(isDueState(state({ lastServedAt: new Date(NOW.getTime() - 23 * HOUR_MS) }), NOW)).toBe(false)
    expect(isDueState(state({ lastServedAt: new Date(NOW.getTime() - 24 * HOUR_MS) }), NOW)).toBe(true)
  })

  it('weekly: due 7 days after the last serve', () => {
    const s = (hoursAgo: number) =>
      state({ cadence: 'weekly', lastServedAt: new Date(NOW.getTime() - hoursAgo * HOUR_MS) })
    expect(isDueState(s(6 * 24), NOW)).toBe(false)
    expect(isDueState(s(7 * 24), NOW)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// runPromptNudges — orchestration over a fake NudgeIo
// ---------------------------------------------------------------------------

function dueState(over: Partial<DuePromptState> = {}): DuePromptState {
  return {
    id: 'ps_1',
    organizationId: 'org_1',
    subjectId: null,
    cadence: 'daily',
    packKeys: ['core'],
    servedPromptKeys: [],
    lastServedAt: new Date(NOW.getTime() - 25 * HOUR_MS),
    createdAt: new Date(NOW.getTime() - 30 * 24 * HOUR_MS),
    subjectName: null,
    ...over,
  }
}

/** A scripted seam that records every call in order — the advance-before-send witness. */
function fakeIo(due: DuePromptState[], recipientsByOrg: Record<string, string[]> = {}) {
  const calls: string[] = []
  const io: NudgeIo = {
    listDue: async () => due,
    advance: async (state) => {
      calls.push(`advance:${state.id}`)
    },
    recipients: async (orgId) => {
      calls.push(`recipients:${orgId}`)
      return recipientsByOrg[orgId] ?? ['user_1']
    },
    deliver: async (state, userId) => {
      calls.push(`deliver:${state.id}:${userId}`)
    },
  }
  return { io, calls }
}

describe('runPromptNudges', () => {
  it('nudges a due state: advance lands BEFORE any deliver (the double-send latch)', async () => {
    const { io, calls } = fakeIo([dueState()], { org_1: ['user_1', 'user_2'] })
    const result = await runPromptNudges(NOW, io)
    expect(result).toEqual({ nudged: 1, skipped: 0 })
    expect(calls).toEqual([
      'recipients:org_1',
      'advance:ps_1',
      'deliver:ps_1:user_1',
      'deliver:ps_1:user_2',
    ])
  })

  it('a 6h tick can never double-send inside a window: an advanced state is no longer due', async () => {
    // First tick nudges and advances (lastServedAt = NOW). Second tick 6h later: the state the
    // SQL would re-fetch (were the filter drifted) fails the pure re-check — nothing sends.
    const first = dueState()
    const { io: io1 } = fakeIo([first])
    await runPromptNudges(NOW, io1)

    const advanced = dueState({ lastServedAt: NOW })
    const sixHoursLater = new Date(NOW.getTime() + 6 * HOUR_MS)
    const { io: io2, calls } = fakeIo([advanced]) // simulate a drifted listDue over-fetching
    const result = await runPromptNudges(sixHoursLater, io2)
    expect(result).toEqual({ nudged: 0, skipped: 1 })
    expect(calls.filter((c) => c.startsWith('deliver'))).toEqual([])
    expect(calls.filter((c) => c.startsWith('advance'))).toEqual([])
  })

  it("cadence 'off' is silent even if listDue leaks it (defensive pure re-check)", async () => {
    const { io, calls } = fakeIo([dueState({ cadence: 'off' })])
    const result = await runPromptNudges(NOW, io)
    expect(result).toEqual({ nudged: 0, skipped: 1 })
    expect(calls).toEqual([])
  })

  it('a fresh state (inside its first window) is skipped, not nudged', async () => {
    const fresh = dueState({
      lastServedAt: null,
      createdAt: new Date(NOW.getTime() - 6 * HOUR_MS),
    })
    const { io } = fakeIo([fresh])
    expect(await runPromptNudges(NOW, io)).toEqual({ nudged: 0, skipped: 1 })
  })

  it('an exhausted catalog is skipped quietly — the window anchor stays put', async () => {
    const exhausted = dueState({
      servedPromptKeys: PROMPT_CATALOG.core.map((p) => p.key),
    })
    const { io, calls } = fakeIo([exhausted])
    expect(await runPromptNudges(NOW, io)).toEqual({ nudged: 0, skipped: 1 })
    expect(calls.filter((c) => c.startsWith('advance'))).toEqual([]) // anchor untouched
  })

  it('the run cap stops the WHOLE run before advancing the capped state', async () => {
    // 100 recipients per org: two orgs fit under the 200 cap, the third would cross it.
    const due = [
      dueState({ id: 'ps_1', organizationId: 'org_1' }),
      dueState({ id: 'ps_2', organizationId: 'org_2' }),
      dueState({ id: 'ps_3', organizationId: 'org_3' }),
      dueState({ id: 'ps_4', organizationId: 'org_4' }),
    ]
    const hundred = Array.from({ length: 100 }, (_, i) => `u${i}`)
    const { io, calls } = fakeIo(due, {
      org_1: hundred,
      org_2: hundred,
      org_3: hundred,
      org_4: hundred,
    })
    const result = await runPromptNudges(NOW, io)
    expect(result).toEqual({ nudged: 2, skipped: 2 }) // ps_3 capped, ps_4 never reached
    expect(calls.filter((c) => c.startsWith('advance'))).toEqual(['advance:ps_1', 'advance:ps_2'])
    expect(calls.filter((c) => c.startsWith('deliver'))).toHaveLength(200)
  })

  it('one failing state never starves the rest (per-state isolation)', async () => {
    const due = [dueState({ id: 'ps_bad' }), dueState({ id: 'ps_good' })]
    const { io, calls } = fakeIo(due)
    const originalAdvance = io.advance
    io.advance = async (state, now) => {
      if (state.id === 'ps_bad') throw new Error('db hiccup')
      return originalAdvance(state, now)
    }
    const result = await runPromptNudges(NOW, io)
    expect(result).toEqual({ nudged: 1, skipped: 1 })
    expect(calls.filter((c) => c.startsWith('deliver'))).toEqual(['deliver:ps_good:user_1'])
    expect(errorSpy).toHaveBeenCalledOnce()
  })

  it('recipient lists are cached per org within a run', async () => {
    const due = [
      dueState({ id: 'ps_1', organizationId: 'org_1', subjectId: 's1' }),
      dueState({ id: 'ps_2', organizationId: 'org_1', subjectId: 's2' }),
    ]
    const { io, calls } = fakeIo(due)
    await runPromptNudges(NOW, io)
    expect(calls.filter((c) => c.startsWith('recipients'))).toEqual(['recipients:org_1'])
  })

  it('an org with zero recipients still burns its window (silence this window is still this window)', async () => {
    const { io, calls } = fakeIo([dueState()], { org_1: [] })
    const result = await runPromptNudges(NOW, io)
    expect(result).toEqual({ nudged: 1, skipped: 0 })
    expect(calls).toEqual(['recipients:org_1', 'advance:ps_1'])
  })
})
