import { View } from 'react-native'
import { CartesianChart, Scatter } from 'victory-native'
import { useColors } from '@/lib/config/theme'
import { useChartFont } from './chart-font'
import { ChartEmpty } from './empty'
import { finitePoints } from './trend'
import type { ChartPoint } from './trend'

/** Themed scatter plot on victory-native (Skia). */
export function ScatterChart({
  data,
  height = 220,
  radius = 6,
  color,
}: {
  data: ChartPoint[]
  height?: number
  radius?: number
  color?: string
}) {
  const colors = useColors()
  const font = useChartFont(12)

  // Guard before CartesianChart mounts — empty data NaNs victory's domain math (see ChartEmpty).
  const plottable = finitePoints(data)
  if (plottable.length === 0) return <ChartEmpty height={height} />

  return (
    <View style={{ height }}>
      <CartesianChart
        data={plottable}
        xKey="x"
        yKeys={['y']}
        domainPadding={{ left: 16, right: 16, top: 16, bottom: 8 }}
        axisOptions={{ font, lineColor: colors.border, labelColor: colors.mutedForeground }}
      >
        {({ points }) => <Scatter points={points.y} radius={radius} style="fill" color={color ?? colors.primary} />}
      </CartesianChart>
    </View>
  )
}
