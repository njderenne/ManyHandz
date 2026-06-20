import { View } from 'react-native'
import Svg, { Polyline } from 'react-native-svg'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'

/**
 * Lightweight charts built on react-native-svg (web-safe, no extra native module). BarChart and
 * Sparkline cover the common cases; for complex/interactive viz, add victory-native per app.
 */
export function BarChart({
  data,
  height = 120,
  color,
  className,
}: {
  data: number[]
  height?: number
  color?: string
  className?: string
}) {
  const colors = useColors()
  const fill = color ?? colors.primary
  // Same data hygiene as the Skia charts' finitePoints: NaN yields an invalid 'NaN%' height,
  // negative values a negative one — drop the former, clamp the latter.
  const safe = data.filter((v) => Number.isFinite(v))
  const max = Math.max(...safe, 1)
  return (
    <View style={{ height }} className={cn('w-full flex-row items-end gap-1.5', className)}>
      {safe.map((v, i) => (
        <View
          key={i}
          className="flex-1 rounded-t-sm"
          style={{ height: `${Math.max(0, (v / max) * 100)}%`, backgroundColor: fill }}
        />
      ))}
    </View>
  )
}

export function Sparkline({
  data,
  height = 64,
  color,
  className,
}: {
  data: number[]
  height?: number
  color?: string
  className?: string
}) {
  const colors = useColors()
  const stroke = color ?? colors.brand
  // Non-finite points would poison the whole polyline — drop them (cf. charts/trend.ts).
  const safe = data.filter((v) => Number.isFinite(v))
  if (safe.length < 2) return <View style={{ height }} className={cn('w-full', className)} />
  const max = Math.max(...safe)
  const min = Math.min(...safe)
  const range = max - min || 1
  const points = safe
    .map((v, i) => `${(i / (safe.length - 1)) * 100},${100 - ((v - min) / range) * 100}`)
    .join(' ')
  return (
    <View style={{ height }} className={cn('w-full', className)}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Polyline points={points} fill="none" stroke={stroke} strokeWidth={3} />
      </Svg>
    </View>
  )
}
