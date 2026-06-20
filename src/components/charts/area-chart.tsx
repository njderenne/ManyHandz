import { View } from 'react-native'
import { LinearGradient, vec } from '@shopify/react-native-skia'
import { Area, CartesianChart, Line, useChartPressState } from 'victory-native'
import { useColors } from '@/lib/config/theme'
import { useChartFont } from './chart-font'
import { Crosshair } from './crosshair'
import { ChartEmpty } from './empty'
import { finitePoints } from './trend'
import type { ChartPoint } from './trend'
import { resolveFormatXLabel, type XAxisProps } from './x-axis'
import { XAxisCaption } from './x-axis-caption'

export type AreaChartProps = XAxisProps & {
  data: ChartPoint[]
  height?: number
  interactive?: boolean
  curve?: 'linear' | 'natural'
  decimals?: number
  prefix?: string
  suffix?: string
  color?: string
}

/**
 * Themed area chart on victory-native (Skia): a Skia gradient fill under a crisp top line, with the
 * same drag-to-value crosshair as LineChart.
 */
export function AreaChart({
  data,
  height = 220,
  interactive = true,
  curve = 'natural',
  decimals = 0,
  prefix = '',
  suffix = '',
  color,
  xAxisLabel,
  xAxisMode,
  xFormat,
}: AreaChartProps) {
  const colors = useColors()
  const font = useChartFont(12)
  const { state, isActive } = useChartPressState({ x: 0, y: { y: 0 } })
  const line = color ?? colors.primary
  const formatXLabel = resolveFormatXLabel({ xFormat, xAxisMode })

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
          domainPadding={{ left: 16, right: 16, top: 24, bottom: 8 }}
          axisOptions={{ font, lineColor: colors.border, labelColor: colors.mutedForeground, formatXLabel }}
          chartPressState={interactive ? state : undefined}
        >
          {({ points, chartBounds }) => (
            <>
              <Area points={points.y} y0={chartBounds.bottom} curveType={curve} animate={{ type: 'timing', duration: 300 }}>
                <LinearGradient
                  start={vec(0, chartBounds.top)}
                  end={vec(0, chartBounds.bottom)}
                  colors={[line, `${line}00`]}
                />
              </Area>
              <Line points={points.y} color={line} strokeWidth={3} curveType={curve} />
              {interactive && isActive ? (
                <Crosshair
                  state={state}
                  top={chartBounds.top}
                  bottom={chartBounds.bottom}
                  lineColor={colors.border}
                  dotColor={line}
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
