import { lazySkiaChart } from './lazy-skia'

// Type-only — erased at build, so victory-native/Skia stay OUT of the app-start bundle graph.
export type { BarChartProps } from './bar-chart'
import type { BarChartProps } from './bar-chart'

/** BarChartSkia — lazy, import-anywhere variant of ./bar-chart. See ./lazy-skia. */
export const BarChartSkia = lazySkiaChart<BarChartProps>(() =>
  import('./bar-chart').then((m) => ({ default: m.BarChart })),
)
