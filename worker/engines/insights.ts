/**
 * Insights engine SKELETON — deterministic, rule-based "smart" observations with ZERO model
 * calls (pet-pilot's shape: its "AI Insights" screen is exact thresholds over fetched rows —
 * deterministic is the point; the doctrine is that an insight a user acts on must be
 * explainable and reproducible, and a model call is neither).
 *
 * How a minted app uses this:
 *
 *   1. The ROUTE fetches + org-scopes the rows an insight needs (rule 4 lives in the route),
 *      grouping them under named input keys: { workouts: [...], weights: [...] }.
 *   2. The app defines InsightRule objects — each one pure: (inputs, ctx) → drafts.
 *   3. composeInsights() runs the rules, stamps ephemeral ids, and returns the sorted list.
 *      Insights are computed per request and NEVER persisted (they'd go stale the moment the
 *      underlying rows change — the derive-never-store doctrine again).
 *
 * COPY RULE (inherited from the nudge engine's NO GUILT law): insight copy informs, it never
 * shames — "Things have been quiet" is an observation; "You've been slacking" is a bug.
 */

export type InsightType = 'info' | 'warning' | 'alert' | 'positive'

/**
 * One computed insight. priority 1 = highest (most urgent) … 5 = lowest; the composed list is
 * sorted ascending. entityType/entityId anchor the insight to a domain row (deep-link target,
 * dedupe key) — subjects, catalog items, whatever the rule is about.
 */
export type Insight = {
  /** Ephemeral (`insight_{ts}_{n}`) — never persisted, never a foreign key. */
  id: string
  type: InsightType
  priority: number
  title: string
  description: string
  /** Client deep-link, e.g. '/subjects/abc123'. */
  actionUrl?: string
  actionLabel?: string
  entityType?: string
  entityId?: string
}

/** What a rule produces — the runner owns id assignment. */
export type InsightDraft = Omit<Insight, 'id'>

/**
 * One pure rule. `inputs` holds whatever row groups the route fetched (a rule reads only the
 * keys it documents; missing keys read as empty). `ctx.now` is the injected clock — rules never
 * call Date.now() themselves (engines convention: determinism is testability).
 */
export type InsightRule = {
  /** Stable identifier — shows up in logs when a rule misbehaves. */
  key: string
  run: (inputs: Record<string, unknown[]>, ctx: { now: Date }) => InsightDraft[]
}

/**
 * Run the rules and assemble the response list:
 *
 *   - Rules run in array order; one rule throwing is logged and dropped, never fatal (an
 *     insight is decoration on top of the data, not the data).
 *   - Sort: priority ASC (1 = most urgent first); ties keep rule order, then draft order —
 *     stable and deterministic.
 *   - Ids are `insight_{now-ms}_{n}` with n assigned AFTER the sort, so the same inputs + now
 *     produce byte-identical output (pet-pilot used a random suffix; the chassis drops it —
 *     determinism outranks id prettiness).
 */
export function composeInsights(
  inputs: Record<string, unknown[]>,
  rules: InsightRule[],
  opts: { now?: Date } = {},
): Insight[] {
  const now = opts.now ?? new Date()

  const drafts: Array<{ draft: InsightDraft; order: number }> = []
  let order = 0
  for (const rule of rules) {
    try {
      for (const draft of rule.run(inputs, { now })) {
        drafts.push({ draft, order: order++ })
      }
    } catch (e) {
      // A broken rule must not take the screen down — log and keep composing.
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'insights.rule_failed',
          rule: rule.key,
          message: e instanceof Error ? e.message : String(e),
        }),
      )
    }
  }

  return drafts
    .sort((a, b) => a.draft.priority - b.draft.priority || a.order - b.order)
    .map(({ draft }, n) => ({ id: `insight_${now.getTime()}_${n}`, ...draft }))
}

// ---------------------------------------------------------------------------
// Example rules — the shapes apps copy. Both read a generic `{ at: Date }` row
// group under inputs['events'] (map any timestamped domain rows onto it).
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

/** Narrow unknown rows to the `{ at: Date }` shape example rules read — bad rows are skipped. */
function timestamped(rows: unknown[] | undefined): Array<{ at: Date }> {
  return (rows ?? []).filter(
    (r): r is { at: Date } =>
      typeof r === 'object' && r !== null && (r as { at?: unknown }).at instanceof Date,
  )
}

/**
 * Example 1 — "quiet week": history exists but nothing landed in the last 7 days. A gentle
 * observation (info, low priority), NOT a nag — see the copy rule in the header.
 */
export const quietWeekRule: InsightRule = {
  key: 'example.quiet-week',
  run: (inputs, { now }) => {
    const events = timestamped(inputs.events)
    if (events.length === 0) return [] // nothing ever logged — onboarding's job, not an insight
    const weekAgo = now.getTime() - 7 * DAY_MS
    if (events.some((e) => e.at.getTime() >= weekAgo)) return []
    return [
      {
        type: 'info',
        priority: 4,
        title: 'Things have been quiet',
        description: 'Nothing has been logged in the past week. Whenever you’re ready, it only takes a moment.',
      },
    ]
  },
}

/**
 * Example 2 — "momentum": this week's activity beat last week's by ≥ 20% (both non-zero).
 * Positives exist in this taxonomy on purpose (pet-pilot doctrine) — an insights surface that
 * only ever warns trains users to ignore it.
 */
export const momentumRule: InsightRule = {
  key: 'example.momentum',
  run: (inputs, { now }) => {
    const events = timestamped(inputs.events)
    const nowMs = now.getTime()
    const thisWeek = events.filter((e) => nowMs - e.at.getTime() <= 7 * DAY_MS).length
    const priorWeek = events.filter((e) => {
      const age = nowMs - e.at.getTime()
      return age > 7 * DAY_MS && age <= 14 * DAY_MS
    }).length
    if (thisWeek === 0 || priorWeek === 0) return []
    if (thisWeek < priorWeek * 1.2) return []
    return [
      {
        type: 'positive',
        priority: 5,
        title: 'Momentum is building',
        description: `${thisWeek} entries this week, up from ${priorWeek} last week. Nice pace.`,
      },
    ]
  },
}

/** The example set — apps replace this wholesale; it exists so the skeleton demos end to end. */
export const EXAMPLE_RULES: InsightRule[] = [quietWeekRule, momentumRule]
