import { useMemo } from 'react'
import { palette } from '@/lib/config/theme'
import { usePrefs } from '@/lib/prefs'

/**
 * chartPalette — the one categorical series ramp for every chart in the app.
 *
 * ── STAGE-0 APPLIED (2026-07-05 harvest, STAGE0_SPEC §6.5) ───────────────────────────────────
 * The exported SIGNATURE is a frozen contract (STAGE0 §9): B4's gallery/primitives and B5's
 * route-map both import it. B4 owns this file's logic post-stage-0 and may extend it (more
 * ramps, helpers) — the `chartPalette(opts)` shape never changes.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * SANCTIONED HEX EXCEPTION: alongside theme.ts, this file is the ONE place chart-series hexes may
 * live (the zero-hardcoded-hexes law applies everywhere else). Categorical series colors are
 * scheme-stable by design — the same data series keeps its color across light/dark (cadio
 * precedent: one chartSeries array for both schemes); axes/labels/grid still theme via useColors().
 *
 * Callers pass the user's accessibility preference (B4 adds `colorBlindSafe` to the prefs store):
 *
 *   const series = chartPalette({ colorBlindSafe })
 *   <Donut data={rows.map((r, i) => ({ ...r, color: series[i % series.length] }))} />
 */

/**
 * Default ramp — anchored on the brand primary so single-series charts stay on-brand, then
 * spaced hues (teal/amber/pink/green/sky/purple/rose) picked to stay distinct on both scheme
 * backgrounds. Consumers index modulo length.
 */
const DEFAULT_SERIES: readonly string[] = [
  palette.dark.primary, // brand primary (#6366f1 in the template) — series 0 is always on-brand
  '#2dd4bf', // teal
  '#f59e0b', // amber (= theme warning)
  '#f472b6', // pink
  '#34d399', // green
  '#60a5fa', // sky
  '#c084fc', // purple
  '#fb7185', // rose
]

/**
 * Okabe-Ito ramp — the standard color-vision-deficiency-safe categorical set (Okabe & Ito 2008),
 * distinguishable under protanopia/deuteranopia/tritanopia. The canonical set's black is swapped
 * for a mid grey (#999999) so the last series survives the dark scheme's near-black background.
 */
const OKABE_ITO: readonly string[] = [
  '#0072b2', // blue
  '#e69f00', // orange
  '#009e73', // bluish green
  '#cc79a7', // reddish purple
  '#56b4e9', // sky blue
  '#d55e00', // vermillion
  '#f0e442', // yellow
  '#999999', // grey (canonical black, swapped for dark-scheme visibility)
]

/** The categorical series ramp. Returns a fresh array — callers may mutate/slice freely. */
export function chartPalette(opts: { colorBlindSafe: boolean }): string[] {
  return opts.colorBlindSafe ? [...OKABE_ITO] : [...DEFAULT_SERIES]
}

/**
 * useChartPalette — the React side of chartPalette (B4 extension; the chartPalette signature above
 * stays frozen per STAGE0 §9). Subscribes to the persisted `colorBlindSafe` preference so every
 * chart on screen live-flips its series colors the moment the toggle changes — no reload, no prop
 * drilling. Memoized on the pref so the array identity is stable across unrelated re-renders
 * (safe in hook deps). Non-React callers keep passing the pref to chartPalette() explicitly.
 */
export function useChartPalette(): string[] {
  const colorBlindSafe = usePrefs((s) => s.colorBlindSafe)
  return useMemo(() => chartPalette({ colorBlindSafe }), [colorBlindSafe])
}
