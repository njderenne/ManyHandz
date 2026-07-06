import { useMemo, useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import { Canvas, Path, Circle, Skia } from '@shopify/react-native-skia'
import { MapPinned } from 'lucide-react-native'
import { decodePolyline, fitPointsToBox, type LatLng } from '@/lib/gps/polyline'
import { useChartPalette } from '@/components/charts/palette'
import { useColors } from '@/lib/config/theme'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

/**
 * RouteMap (NATIVE) — a TILE-FREE Skia route renderer: polyline → Path, auto-fit bounds,
 * start/end markers. No map tiles, no API key, no network — the route's SHAPE is the story
 * (where you went, how loopy it was), and a Strava-style trace card tells it without dragging
 * react-native-maps into every list row. When an app wants geography (streets, terrain), it
 * composes `SimpleMap` (src/components/native/map-view.tsx) with the decoded points instead —
 * this component is the cheap default for feeds, history rows, and share cards.
 *
 * Accepts EITHER an encoded polyline (the storage/transfer format — decoded internally) or
 * pre-decoded points; `points` wins when both are given (callers that already decoded shouldn't
 * pay twice). Colors: the trace strokes with the caller's `color` or series 0 of the chart
 * palette (B4's `chartPalette` — respects the colorBlindSafe preference); start/end markers use
 * the semantic success/destructive theme colors via useColors(). Zero hardcoded hexes.
 *
 * The web build resolves route-map.web.tsx (same surface, SVG render — no Skia/CanvasKit on web).
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

  // Project into the measured box; empty until onLayout delivers a width.
  const projected = useMemo(
    () => (width > 0 ? fitPointsToBox(route, width, height, PADDING) : []),
    [route, width, height],
  )

  const path = useMemo(() => {
    if (projected.length < 2) return null
    const p = Skia.Path.Make()
    p.moveTo(projected[0].x, projected[0].y)
    for (let i = 1; i < projected.length; i++) p.lineTo(projected[i].x, projected[i].y)
    return p
  }, [projected])

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)

  // No usable route (manual entries, a track with <2 accepted fixes) — a quiet placeholder, not a crash.
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
        {path && start && end ? (
          <Canvas style={{ width, height }}>
            <Path
              path={path}
              style="stroke"
              strokeWidth={strokeWidth}
              strokeJoin="round"
              strokeCap="round"
              color={stroke}
            />
            {/* Start (success) / end (destructive) markers with a card-colored core for contrast. */}
            <Circle cx={start.x} cy={start.y} r={6} color={colors.success} />
            <Circle cx={start.x} cy={start.y} r={2.5} color={colors.card} />
            <Circle cx={end.x} cy={end.y} r={6} color={colors.destructive} />
            <Circle cx={end.x} cy={end.y} r={2.5} color={colors.card} />
          </Canvas>
        ) : null}
      </View>
    </View>
  )
}
