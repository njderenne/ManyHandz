import { lazySkiaChart } from './lazy-skia'

// Type-only — erased at build, so victory-native/Skia stay OUT of the app-start bundle graph.
import type { ChartPoint } from './trend'

/**
 * ./scatter-chart types its props inline, so the lazy wrapper declares the named shape (kept in
 * lockstep with ScatterChart's signature — a drift fails tsc at the lazySkiaChart call below).
 */
export type ScatterChartProps = {
  data: ChartPoint[]
  height?: number
  radius?: number
  color?: string
}

/** ScatterChartSkia — lazy, import-anywhere variant of ./scatter-chart. See ./lazy-skia. */
export const ScatterChartSkia = lazySkiaChart<ScatterChartProps>(() =>
  import('./scatter-chart').then((m) => ({ default: m.ScatterChart })),
)
