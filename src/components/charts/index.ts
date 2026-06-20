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
