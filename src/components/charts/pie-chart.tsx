import { View } from 'react-native'
import { Pie, PolarChart } from 'victory-native'
import { useColors } from '@/lib/config/theme'
import { ChartEmpty } from './empty'

export type PieDatum = { label: string; value: number; color?: string }

/**
 * Themed pie / donut chart on victory-native (Skia). Slices auto-color from the theme palette unless
 * a slice supplies its own `color`. Pass `donut` for a ring; `innerRadius` tunes the hole.
 */
export function PieChart({
  data,
  height = 220,
  donut = false,
  innerRadius = '55%',
}: {
  data: PieDatum[]
  height?: number
  donut?: boolean
  innerRadius?: number | string
}) {
  const colors = useColors()
  const cycle = [colors.primary, colors.brand, colors.success, colors.warning, colors.destructive, colors.mutedForeground]
  // Negative/non-finite values make no sense as slices (and NaN the angle math); a zero total
  // would divide every slice by 0 — both fall back to the shared empty state. Cycle colors are
  // assigned from the ORIGINAL index so a slice keeps its color when siblings drop to zero
  // (legends/labels elsewhere stay consistent across data updates).
  const withColor = data
    .map((d, i) => ({ ...d, color: d.color ?? cycle[i % cycle.length] }))
    .filter((d) => Number.isFinite(d.value) && d.value > 0)
  if (withColor.length === 0) return <ChartEmpty height={height} />

  return (
    <View style={{ height }}>
      <PolarChart data={withColor} labelKey="label" valueKey="value" colorKey="color">
        <Pie.Chart innerRadius={donut ? innerRadius : 0}>
          {() => (
            <>
              <Pie.Slice />
              <Pie.SliceAngularInset angularInset={{ angularStrokeWidth: 2, angularStrokeColor: colors.card }} />
            </>
          )}
        </Pie.Chart>
      </PolarChart>
    </View>
  )
}
