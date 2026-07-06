import { lazySkiaChart } from './lazy-skia'

// Type-only — erased at build, so victory-native/Skia stay OUT of the app-start bundle graph.
export type { AreaChartProps } from './area-chart'
import type { AreaChartProps } from './area-chart'

/** AreaChartSkia — lazy, import-anywhere variant of ./area-chart. See ./lazy-skia. */
export const AreaChartSkia = lazySkiaChart<AreaChartProps>(() =>
  import('./area-chart').then((m) => ({ default: m.AreaChart })),
)
