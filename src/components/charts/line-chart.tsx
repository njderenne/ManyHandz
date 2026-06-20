import { View } from 'react-native'
import { Circle } from '@shopify/react-native-skia'
import { CartesianChart, Line, useChartPressState } from 'victory-native'
import { useColors } from '@/lib/config/theme'
import { useChartFont } from './chart-font'
import { Crosshair } from './crosshair'
import { ChartEmpty } from './empty'
import { finitePoints, withTrend, type ChartPoint } from './trend'
import { resolveFormatXLabel, type XAxisProps } from './x-axis'
import { XAxisCaption } from './x-axis-caption'

export type LineChartProps = XAxisProps & {
  data: ChartPoint[]
  height?: number
  /** Drag-to-read crosshair + value tooltip. Default on — the headline feature. */
  interactive?: boolean
  curve?: 'linear' | 'natural'
  /** Overlay a dashed least-squares trend line. */
  showTrend?: boolean
  /** Render a dot at every data point. */
  markers?: boolean
  /** Tooltip value formatting (worklet-safe — no formatter fn). */
  decimals?: number
  prefix?: string
  suffix?: string
  color?: string
}

/**
 * Themed line chart on victory-native (Skia). Smooth UI-thread drag-to-value via `interactive`,
 * optional regression `showTrend`, optional point `markers`. Reads colors from the active theme.
 */
export function LineChart({
  data,
  height = 220,
  interactive = true,
  curve = 'natural',
  showTrend = false,
  markers = false,
  decimals = 0,
  prefix = '',
  suffix = '',
  color,
  xAxisLabel,
  xAxisMode,
  xFormat,
}: LineChartProps) {
  const colors = useColors()
  const font = useChartFont(12)
  // Seed must include every yKey (we always plot a `trend` series for stable typing).
  const { state, isActive } = useChartPressState({ x: 0, y: { y: 0, trend: 0 } })
  const lineColor = color ?? colors.primary
  const formatXLabel = resolveFormatXLabel({ xFormat, xAxisMode })

  // Guard before CartesianChart mounts — empty data NaNs victory's domain math (see ChartEmpty).
  const plottable = finitePoints(data)
  if (plottable.length === 0) return <ChartEmpty height={height} />

  // Always compute trend so the yKeys tuple stays stable (typing); render it only when asked.
  const chartData = withTrend(plottable)

  return (
    <>
      <View style={{ height }}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={['y', 'trend']}
          domainPadding={{ left: 16, right: 16, top: 24, bottom: 8 }}
          axisOptions={{ font, lineColor: colors.border, labelColor: colors.mutedForeground, formatXLabel }}
          chartPressState={interactive ? state : undefined}
        >
          {({ points, chartBounds }) => (
            <>
              {showTrend ? (
                <Line points={points.trend} color={colors.mutedForeground} strokeWidth={1.5} curveType="linear" />
              ) : null}
              <Line
                points={points.y}
                color={lineColor}
                strokeWidth={3}
                curveType={curve}
                animate={{ type: 'timing', duration: 300 }}
              />
              {markers
                ? points.y.map((p, i) =>
                    p.y == null ? null : <Circle key={i} cx={p.x} cy={p.y} r={4} color={lineColor} />,
                  )
                : null}
              {interactive && isActive ? (
                <Crosshair
                  state={state}
                  top={chartBounds.top}
                  bottom={chartBounds.bottom}
                  lineColor={colors.border}
                  dotColor={lineColor}
                  textColor={colors.foreground}
                  font={font}
                  decimals={decimals}
                  prefix={prefix}
                  suffix={suffix}
                />
              ) : null}
            </>
          )}
        </CartesianChart>
      </View>
      <XAxisCaption label={xAxisLabel} />
    </>
  )
}
