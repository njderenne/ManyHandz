/**
 * Robust chart suite on victory-native (Skia). Interactive (drag-to-value) line + area, gradient
 * bars, pie/donut, scatter, and a least-squares trend overlay — all themed from the active palette.
 *
 * Native-only: Skia is a native module, so these need an EAS dev build (won't run in Expo Go). For
 * cheap, non-interactive inline charts that also work everywhere, use the lightweight Sparkline in
 * `@/components/ui/chart`.
 */
export { LineChart, type LineChartProps } from './line-chart'
export { BarChart, type BarChartProps } from './bar-chart'
export { AreaChart, type AreaChartProps } from './area-chart'
export { PieChart, type PieDatum } from './pie-chart'
export { ScatterChart } from './scatter-chart'
export { Crosshair, type CrosshairState } from './crosshair'
export { ChartEmpty } from './empty'
export { finitePoints, leastSquares, withTrend, type ChartPoint } from './trend'
export { resolveFormatXLabel, type XAxisMode, type XAxisProps } from './x-axis'

// ── Lazy `-skia` variants (2026-07-05 harvest, B4) ────────────────────────────────────────────
// Import-anywhere wrappers that defer victory-native/Skia (and on web, the CanvasKit wasm) until
// the chart actually mounts — no screen-level gating ceremony. Prefer these in new screens.
//
// ⚠ WEB CAUTION — importing THIS BARREL from a startup-reachable module also evaluates the eager
// impls above, which bind victory-native's CanvasKit reference before the wasm exists and poison
// every later Skia render on web. From screens, import the `-skia` files directly
// (`@/components/charts/line-chart-skia`), or keep barrel imports behind a Skia gate the way
// app/charts.tsx gates its showcase. Native builds are unaffected (Skia is baked in).
export { LineChartSkia } from './line-chart-skia'
export { AreaChartSkia } from './area-chart-skia'
export { BarChartSkia } from './bar-chart-skia'
export { PieChartSkia, type PieChartProps } from './pie-chart-skia'
export { ScatterChartSkia, type ScatterChartProps } from './scatter-chart-skia'
export { ensureSkiaWeb, lazySkiaChart } from './lazy-skia'
// Categorical series colors — the one sanctioned source; respects the colorBlindSafe pref.
export { chartPalette, useChartPalette } from './palette'
