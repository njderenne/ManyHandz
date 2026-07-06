import { lazySkiaChart } from './lazy-skia'

// Type-only — erased at build, so victory-native/Skia stay OUT of the app-start bundle graph.
export type { PieDatum } from './pie-chart'
import type { PieDatum } from './pie-chart'

/**
 * ./pie-chart types its props inline, so the lazy wrapper declares the named shape (kept in
 * lockstep with PieChart's signature — a drift fails tsc at the lazySkiaChart call below).
 */
export type PieChartProps = {
  data: PieDatum[]
  height?: number
  donut?: boolean
  innerRadius?: number | string
}

/** PieChartSkia — lazy, import-anywhere variant of ./pie-chart. See ./lazy-skia. */
export const PieChartSkia = lazySkiaChart<PieChartProps>(() =>
  import('./pie-chart').then((m) => ({ default: m.PieChart })),
)
