/**
 * Range-metrics engine — the deterministic math half of the report generator (RxMndr's
 * doctor-report shape, generalized). The route (worker/routes/generated-reports.ts) fetches +
 * org-scopes rows through an app-registered loader, this engine reduces them to aggregates,
 * and the output object IS the `generated_report.data` DTO — stored as jsonb, rendered by the
 * client, and optionally summarized by a later AI prose pass that can never block generation.
 *
 * DETERMINISM IS THE CONTRACT (acceptance-tested): same input → byte-identical output. That is
 * why there is no `generatedAt` timestamp in here (the row's createdAt column carries it), why
 * numbers are rounded through one helper, and why series/kind keys serialize in sorted order.
 *
 * Everything reduces over one universal row shape — `(at, value, kind)`:
 *   - COUNT metrics: value null (dose taken, chore done, entry logged) — counted, not summed.
 *   - VALUE metrics: numeric value (weight, minutes, score) — sum/avg/min/max over non-nulls.
 *   - ADHERENCE: a series with `expected` (how many SHOULD have happened in the range) gets
 *     adherencePct = count / expected — RxMndr's headline number, generalized.
 */

/** One fact: when, optional magnitude, per-app kind ('taken', 'workout', 'weigh-in', …). */
export type MetricRow = {
  at: Date
  /** null = a count-only event; numeric = a measured value. */
  value: number | null
  kind: string
}

/** One named series — a report is a handful of these ('adherence', 'vitals', 'activity'…). */
export type MetricSeries = {
  /** Stable key — becomes the field name in the output DTO. */
  key: string
  /** Display label (the client may also localize by key — this is the fallback). */
  label?: string
  rows: MetricRow[]
  /** How many events SHOULD have landed in the range — enables adherencePct when > 0. */
  expected?: number
}

export type RangeMetricsInput = {
  rangeStart: Date
  rangeEnd: Date
  series: MetricSeries[]
}

/** Per-series aggregates. All numeric fields are null when no in-range rows carry values. */
export type SeriesAggregates = {
  label: string | null
  /** In-range row count (count-only AND valued rows). */
  count: number
  /** Count per kind, keys sorted — the breakdown table. */
  byKind: Record<string, number>
  sum: number | null
  avg: number | null
  min: number | null
  max: number | null
  /** ISO timestamps of the first/last in-range row — the "period actually covered" hint. */
  firstAt: string | null
  lastAt: string | null
  /** count / expected as a 0–100 percentage (0.1 precision); null without a positive expected. */
  adherencePct: number | null
  expected: number | null
}

/** THE generated_report.data DTO — JSON-serializable by construction (no Date objects). */
export type RangeMetricsData = {
  period: {
    start: string
    end: string
    /** Whole days spanned (ceil, min 1) — the denominator for per-day rates client-side. */
    days: number
  }
  series: Record<string, SeriesAggregates>
  aggregates: {
    /** Total in-range rows across every series. */
    totalCount: number
    seriesCount: number
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** One rounding rule for every derived number — 2 decimals, and -0 normalized to 0. */
function round2(n: number): number {
  const r = Math.round(n * 100) / 100
  return r === 0 ? 0 : r
}

/** Percentages get 0.1 precision (RxMndr's convention — 92.3%, not 92.31415%). */
function roundPct(n: number): number {
  const r = Math.round(n * 1000) / 10
  return r === 0 ? 0 : r
}

/**
 * Reduce the input to the report DTO. Rows outside [rangeStart, rangeEnd] (inclusive) are
 * excluded — loaders usually pre-filter in SQL, but the engine re-fences so a sloppy loader
 * can't leak out-of-range facts into a report. Duplicate series keys are a programmer error
 * and throw (two series silently merging is how report bugs hide).
 */
export function computeRangeMetrics(input: RangeMetricsInput): RangeMetricsData {
  const startMs = input.rangeStart.getTime()
  const endMs = input.rangeEnd.getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) {
    throw new Error('computeRangeMetrics: invalid range (start must be ≤ end)')
  }

  const seriesOut: Record<string, SeriesAggregates> = {}
  let totalCount = 0

  // Sorted keys → deterministic serialization regardless of loader array order.
  const sorted = [...input.series].sort((a, b) => a.key.localeCompare(b.key))
  const seen = new Set<string>()

  for (const series of sorted) {
    if (seen.has(series.key)) {
      throw new Error(`computeRangeMetrics: duplicate series key '${series.key}'`)
    }
    seen.add(series.key)

    // In-range fence + chronological order (loaders often deliver DB order; sort makes
    // first/last honest and the whole reduction input-order-independent).
    const rows = series.rows
      .filter((r) => {
        const t = r.at.getTime()
        return t >= startMs && t <= endMs
      })
      .sort((a, b) => a.at.getTime() - b.at.getTime())

    const byKindMap = new Map<string, number>()
    let sum = 0
    let valued = 0
    let min: number | null = null
    let max: number | null = null
    for (const row of rows) {
      byKindMap.set(row.kind, (byKindMap.get(row.kind) ?? 0) + 1)
      if (row.value !== null) {
        valued++
        sum += row.value
        if (min === null || row.value < min) min = row.value
        if (max === null || row.value > max) max = row.value
      }
    }

    const byKind: Record<string, number> = {}
    for (const kind of [...byKindMap.keys()].sort()) byKind[kind] = byKindMap.get(kind)!

    const expected =
      typeof series.expected === 'number' && series.expected > 0
        ? Math.floor(series.expected)
        : null

    seriesOut[series.key] = {
      label: series.label ?? null,
      count: rows.length,
      byKind,
      sum: valued > 0 ? round2(sum) : null,
      avg: valued > 0 ? round2(sum / valued) : null,
      min,
      max,
      firstAt: rows.length > 0 ? rows[0].at.toISOString() : null,
      lastAt: rows.length > 0 ? rows[rows.length - 1].at.toISOString() : null,
      // Capped at 100 — over-delivery (extra doses, bonus workouts) is not >100% adherence.
      adherencePct: expected ? roundPct(Math.min(rows.length / expected, 1)) : null,
      expected,
    }
    totalCount += rows.length
  }

  return {
    period: {
      start: input.rangeStart.toISOString(),
      end: input.rangeEnd.toISOString(),
      days: Math.max(1, Math.ceil((endMs - startMs) / DAY_MS)),
    },
    series: seriesOut,
    aggregates: { totalCount, seriesCount: sorted.length },
  }
}
