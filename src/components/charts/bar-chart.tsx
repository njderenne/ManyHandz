import { View } from 'react-native'
import { LinearGradient, vec } from '@shopify/react-native-skia'
import { CartesianChart, Bar } from 'victory-native'
import { useColors } from '@/lib/config/theme'
import { useChartFont } from './chart-font'
import { ChartEmpty } from './empty'
import { finitePoints } from './trend'
import type { ChartPoint } from './trend'
import { resolveFormatXLabel, type XAxisProps } from './x-axis'
import { XAxisCaption } from './x-axis-caption'

export type BarChartProps = XAxisProps & {
  data: ChartPoint[]
  height?: number
  /** Axis labels keyed by x value (e.g. month names). Superseded by `xFormat`/`xAxisMode` if set. */
  labels?: Record<number, string>
  rounded?: number
  color?: string
}

/**
 * Themed bar chart on victory-native (Skia) with a vertical gradient fill. Replaces the lightweight
 * CSS-bar placeholder for real, axis-aware bars. `labels` maps x values → axis text; `xFormat` /
 * `xAxisMode='date'` (shared with line/area) take precedence when supplied.
 */
export function BarChart({
  data,
  height = 220,
  labels,
  rounded = 6,
  color,
  xAxisLabel,
  xAxisMode,
  xFormat,
}: BarChartProps) {
  const colors = useColors()
  const font = useChartFont(12)
  const top = color ?? colors.brand
  const bottom = color ?? colors.primary
  const formatXLabel = resolveFormatXLabel({ xFormat, xAxisMode, labels })

  // Guard before CartesianChart mounts — empty data NaNs victory's domain math (see ChartEmpty).
  const plottable = finitePoints(data)
  if (plottable.length === 0) return <ChartEmpty height={height} />

  return (
    <>
      <View style={{ height }}>
        <CartesianChart
          data={plottable}
          xKey="x"
          yKeys={['y']}
          domainPadding={{ left: 28, right: 28, top: 24 }}
          axisOptions={{
            font,
            lineColor: colors.border,
            labelColor: colors.mutedForeground,
            formatXLabel,
          }}
        >
          {({ points, chartBounds }) => (
            <Bar
              points={points.y}
              chartBounds={chartBounds}
              roundedCorners={{ topLeft: rounded, topRight: rounded }}
              animate={{ type: 'timing', duration: 300 }}
            >
              <LinearGradient start={vec(0, chartBounds.top)} end={vec(0, chartBounds.bottom)} colors={[top, bottom]} />
            </Bar>
          )}
        </CartesianChart>
      </View>
      <XAxisCaption label={xAxisLabel} />
    </>
  )
}
