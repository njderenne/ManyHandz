/**
 * Shared X-axis labeling for the Skia chart suite (line/area/bar). Keeps the three charts'
 * axis behaviour identical and backward-compatible: when no x-axis prop is supplied the resolved
 * formatter is `undefined`, so `axisOptions.formatXLabel` stays unset and the axis renders exactly
 * as before (byte-identical output).
 *
 * Contract for the `'date'` mode: numeric x values are **epoch milliseconds** (`Date.now()` units).
 * They're formatted to a short "Jun 13"-style label via `toLocaleDateString` (the same Hermes-safe
 * path app/users/[id].tsx and app/achievements.tsx already use). Epoch ms is chosen over day-indices
 * because it's the unit `new Date(...).getTime()` and most APIs hand you, so callers can plot raw
 * timestamps without remapping them to indices first.
 */
export type XAxisMode = 'number' | 'date'

export type XAxisProps = {
  /**
   * Caption rendered (centered, muted) below the chart — e.g. the date span a time-series covers.
   * Replaces hand-rolled "Mar 1 – Jun 13" captions callers used to glue under the chart by hand.
   */
  xAxisLabel?: string
  /**
   * `'date'` interprets x values as epoch ms and formats axis ticks as short dates. Default
   * `'number'` leaves x untouched. Ignored when `xFormat` is given.
   */
  xAxisMode?: XAxisMode
  /** Explicit per-tick formatter `(x) => string`. Wins over `xAxisMode` when both are set. */
  xFormat?: (x: number) => string
}

/** Short, locale-aware date tick, e.g. `"Jun 13"`. Hermes-safe (toLocaleDateString with options). */
const formatDateTick = (x: number) => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * Resolve the label inputs (`xFormat` > `xAxisMode='date'` > bar's legacy `labels` map) into a
 * single victory `formatXLabel`, or `undefined` when none apply (preserving prior axis output).
 */
export function resolveFormatXLabel(
  opts: Pick<XAxisProps, 'xFormat' | 'xAxisMode'> & { labels?: Record<number, string> },
): ((x: number) => string) | undefined {
  if (opts.xFormat) return opts.xFormat
  if (opts.xAxisMode === 'date') return formatDateTick
  if (opts.labels) return (x) => opts.labels![x] ?? ''
  return undefined
}
