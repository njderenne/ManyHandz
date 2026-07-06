import { describe, it, expect, vi } from 'vitest'
import {
  composeInsights,
  quietWeekRule,
  momentumRule,
  EXAMPLE_RULES,
  type InsightRule,
} from './insights'

/**
 * Insights engine skeleton — determinism, ordering, rule isolation, and the two example rules'
 * thresholds. "Deterministic is the point" (pet-pilot doctrine), so identity across runs is
 * asserted literally.
 */

const NOW = new Date('2026-07-05T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

const at = (daysAgo: number) => ({ at: new Date(NOW.getTime() - daysAgo * DAY_MS) })

describe('composeInsights', () => {
  const rule = (key: string, priority: number, title = key): InsightRule => ({
    key,
    run: () => [{ type: 'info', priority, title, description: 'd' }],
  })

  it('sorts by priority ascending, keeping rule order on ties', () => {
    const out = composeInsights({}, [rule('low', 5), rule('urgent', 1), rule('alsoUrgent', 1)], {
      now: NOW,
    })
    expect(out.map((i) => i.title)).toEqual(['urgent', 'alsoUrgent', 'low'])
  })

  it('assigns deterministic ephemeral ids (same inputs + now → byte-identical output)', () => {
    const rules = [rule('a', 2), rule('b', 1)]
    const first = composeInsights({}, rules, { now: NOW })
    const second = composeInsights({}, rules, { now: NOW })
    expect(first).toEqual(second)
    expect(first[0].id).toBe(`insight_${NOW.getTime()}_0`)
    expect(first[1].id).toBe(`insight_${NOW.getTime()}_1`)
  })

  it('a throwing rule is dropped and logged; the rest still compose', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const broken: InsightRule = {
        key: 'broken',
        run: () => {
          throw new Error('boom')
        },
      }
      const out = composeInsights({}, [broken, rule('survivor', 3)], { now: NOW })
      expect(out.map((i) => i.title)).toEqual(['survivor'])
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0][0]).toContain('insights.rule_failed')
    } finally {
      spy.mockRestore()
    }
  })

  it('no rules / no drafts → empty list, never null', () => {
    expect(composeInsights({}, [], { now: NOW })).toEqual([])
  })
})

describe('quietWeekRule', () => {
  it('fires when history exists but the last 7 days are empty', () => {
    const out = quietWeekRule.run({ events: [at(10), at(20)] }, { now: NOW })
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('info')
    // Copy rule: an observation, never a guilt trip.
    expect(out[0].title).not.toMatch(/miss|fail|slack/i)
  })

  it('stays silent with recent activity', () => {
    expect(quietWeekRule.run({ events: [at(2), at(20)] }, { now: NOW })).toEqual([])
  })

  it("stays silent with NO history at all (onboarding's job, not an insight)", () => {
    expect(quietWeekRule.run({ events: [] }, { now: NOW })).toEqual([])
    expect(quietWeekRule.run({}, { now: NOW })).toEqual([])
  })

  it('skips malformed rows instead of throwing (inputs are unknown[] by contract)', () => {
    const out = quietWeekRule.run({ events: [{ nope: true }, null, at(10)] }, { now: NOW })
    expect(out).toHaveLength(1)
  })
})

describe('momentumRule', () => {
  it('fires positive when this week beats last week by ≥ 20%', () => {
    const events = [at(1), at(2), at(3), at(9), at(10)] // 3 this week vs 2 prior
    const out = momentumRule.run({ events }, { now: NOW })
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('positive')
  })

  it('stays silent below the threshold or when either week is empty', () => {
    expect(momentumRule.run({ events: [at(1), at(9)] }, { now: NOW })).toEqual([]) // 1 vs 1
    expect(momentumRule.run({ events: [at(1), at(2)] }, { now: NOW })).toEqual([]) // prior empty
    expect(momentumRule.run({ events: [at(9), at(10)] }, { now: NOW })).toEqual([]) // this empty
  })
})

describe('EXAMPLE_RULES end to end', () => {
  it('composes over the example set without collisions', () => {
    const events = [at(1), at(2), at(3), at(9), at(10)]
    const out = composeInsights({ events }, EXAMPLE_RULES, { now: NOW })
    expect(out.map((i) => i.type)).toEqual(['positive']) // momentum fires, quiet-week doesn't
  })
})
