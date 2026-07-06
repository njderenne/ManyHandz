import { useMemo, useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Svg, { Path, Circle } from 'react-native-svg'
import { MapPinned } from 'lucide-react-native'
import { decodePolyline, fitPointsToBox, type LatLng } from '@/lib/gps/polyline'
import { useChartPalette } from '@/components/charts/palette'
import { useColors } from '@/lib/config/theme'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

/**
 * RouteMap (WEB fallback) — Metro resolves this on web in place of route-map.tsx. Identical
 * surface and projection (fitPointsToBox), rendered as an SVG path via react-native-svg — the
 * same dependency the QR component already uses on web — so the web bundle never touches
 * Skia/CanvasKit (~2MB wasm) for a simple trace card.
 */
export type RouteMapProps = {
  /** Encoded polyline (Google precision-5) — the storage format. Ignored when `points` is given. */
  polyline?: string | null
  /** Pre-decoded route points. Takes precedence over `polyline`. */
  points?: LatLng[]
  /** Card height in px (width fills the container). */
  height?: number
  strokeWidth?: number
  /** Trace color override; defaults to the chart palette's series 0. */
  color?: string
  className?: string
}

const PADDING = 16

export function RouteMap({
  polyline,
  points,
  height = 180,
  strokeWidth = 3,
  color,
  className,
}: RouteMapProps) {
  const colors = useColors()
  const series = useChartPalette()
  const [width, setWidth] = useState(0)

  const route = useMemo<LatLng[]>(() => {
    if (points && points.length > 0) return points
    if (polyline) return decodePolyline(polyline)
    return []
  }, [points, polyline])

  const projected = useMemo(
    () => (width > 0 ? fitPointsToBox(route, width, height, PADDING) : []),
    [route, width, height],
  )

  // "M x y L x y …" — the SVG twin of the native SkPath build.
  const d = useMemo(() => {
    if (projected.length < 2) return null
    return projected
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ')
  }, [projected])

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)

  if (route.length < 2) {
    return (
      <View
        className={className}
        style={{ height, borderRadius: 12, overflow: 'hidden' }}
        accessibilityLabel={t('gps.noRoute')}
      >
        <View className="flex-1 items-center justify-center gap-1 bg-muted px-4">
          <MapPinned color={colors.mutedForeground} size={22} />
          <Text variant="caption" className="text-center">
            {t('gps.noRoute')}
          </Text>
        </View>
      </View>
    )
  }

  const stroke = color ?? series[0]
  const start = projected[0]
  const end = projected[projected.length - 1]

  return (
    <View
      onLayout={onLayout}
      className={className}
      style={{ height, borderRadius: 12, overflow: 'hidden' }}
      accessibilityRole="image"
    >
      <View className="flex-1 bg-muted">
        {d && start && end ? (
          <Svg width={width} height={height}>
            <Path
              d={d}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
            {/* Start (success) / end (destructive) markers with a card-colored core for contrast. */}
            <Circle cx={start.x} cy={start.y} r={6} fill={colors.success} />
            <Circle cx={start.x} cy={start.y} r={2.5} fill={colors.card} />
            <Circle cx={end.x} cy={end.y} r={6} fill={colors.destructive} />
            <Circle cx={end.x} cy={end.y} r={2.5} fill={colors.card} />
          </Svg>
        ) : null}
      </View>
    </View>
  )
}
