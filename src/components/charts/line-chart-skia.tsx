import { lazySkiaChart } from './lazy-skia'

// Type-only — erased at build, so victory-native/Skia stay OUT of the app-start bundle graph.
export type { LineChartProps } from './line-chart'
import type { LineChartProps } from './line-chart'

/**
 * LineChartSkia — the lazy, import-anywhere variant of ./line-chart. Importing this file pulls NO
 * runtime victory-native/Skia code — the heavy impl arrives only when the chart mounts and (on web)
 * after CanvasKit is in place. See ./lazy-skia for the why, and for the naming note (in the
 * projectgains donor the suffix roles are inverted).
 */
export const LineChartSkia = lazySkiaChart<LineChartProps>(() =>
  import('./line-chart').then((m) => ({ default: m.LineChart })),
)
