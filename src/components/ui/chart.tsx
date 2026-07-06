import type { ReactNode } from 'react'
import { View } from 'react-native'
import Svg, { Circle, G, Polygon, Polyline } from 'react-native-svg'
import { TrendingDown, TrendingUp } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { useChartPalette } from '@/components/charts/palette'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

/**
 * Lightweight charts built on react-native-svg + plain Views (web-safe, no native module, zero
 * extra bundle cost) — the right pick for dashboard cards and inline trends on every surface
 * (cadio donor: its whole reporting UI runs on these). For interactive viz (drag-to-read
 * crosshair, gradients) use the Skia suite in `@/components/charts` — its lazy `-skia` variants
 * import safely anywhere.
 *
 * Series colors: single-series components default to a theme color; anything multi-series walks
 * the categorical ramp from `chartPalette`/`useChartPalette` (charts/palette.ts) so the
 * colorBlindSafe preference reaches every chart. Callers passing explicit colors should source
 * them from the same palette.
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

/**
 * AreaSparkline — a Sparkline with a soft filled area underneath. Same web-safe footprint; the fill
 * makes a single-metric trend read as a "volume" rather than a thin line on big cards.
 */
export function AreaSparkline({
  data,
  height = 80,
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
  const safe = data.filter((v) => Number.isFinite(v))
  if (safe.length < 2) return <View style={{ height }} className={cn('w-full', className)} />
  const max = Math.max(...safe)
  const min = Math.min(...safe)
  const range = max - min || 1
  // Y is squeezed into [2, 98] so the stroke isn't clipped at the viewBox edges.
  const xy = safe.map((v, i) => [(i / (safe.length - 1)) * 100, 100 - ((v - min) / range) * 96 - 2] as const)
  const line = xy.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `0,100 ${line} 100,100`
  return (
    <View style={{ height }} className={cn('w-full', className)}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Polygon points={area} fill={stroke} fillOpacity={0.14} stroke="none" />
        <Polyline points={line} fill="none" stroke={stroke} strokeWidth={2.5} />
      </Svg>
    </View>
  )
}

/**
 * StackedBars — one column per period, each split into per-dimension segments (e.g. activity by
 * category over time). Each segment is a colored View; column height encodes the period total.
 * Source segment colors from `useChartPalette()` (stable index per dimension).
 */
export function StackedBars({
  data,
  height = 140,
  className,
}: {
  data: { segments: { value: number; color: string }[] }[]
  height?: number
  className?: string
}) {
  const totals = data.map((d) => d.segments.reduce((s, x) => s + Math.max(0, x.value), 0))
  const max = Math.max(...totals, 1)
  return (
    <View style={{ height }} className={cn('w-full flex-row items-end gap-0.5', className)}>
      {data.map((d, i) => {
        const colTotal = totals[i] || 1
        return (
          <View key={i} className="h-full flex-1 justify-end">
            <View style={{ height: `${(totals[i] / max) * 100}%` }} className="w-full justify-end overflow-hidden rounded-t-sm">
              {d.segments.map((s, j) => (
                <View key={j} style={{ height: `${(Math.max(0, s.value) / colTotal) * 100}%`, backgroundColor: s.color }} className="w-full" />
              ))}
            </View>
          </View>
        )
      })}
    </View>
  )
}

/**
 * Donut — share-of-total ring (e.g. share by category). Built with the stroke-dasharray segment
 * technique so it needs no arc math and stays web-safe. Segments are drawn clockwise from
 * 12 o'clock; a zero total renders a muted placeholder ring. `children` overlays the center
 * (a total, a label). Source segment colors from `useChartPalette()`.
 */
export function Donut({
  data,
  size = 132,
  strokeWidth = 18,
  className,
  children,
}: {
  data: { value: number; color: string }[]
  size?: number
  strokeWidth?: number
  className?: string
  children?: ReactNode
}) {
  const colors = useColors()
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0)
  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const cx = size / 2
  let offset = 0
  return (
    <View style={{ width: size, height: size }} className={cn('items-center justify-center', className)}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
        <G rotation={-90} origin={`${cx}, ${cx}`}>
          {total > 0 ? (
            data.map((d, i) => {
              const len = (Math.max(0, d.value) / total) * circumference
              const seg = (
                <Circle
                  key={i}
                  cx={cx}
                  cy={cx}
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${len} ${circumference - len}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              )
              offset += len
              return seg
            })
          ) : (
            <Circle cx={cx} cy={cx} r={r} fill="none" stroke={colors.accent} strokeWidth={strokeWidth} />
          )}
        </G>
      </Svg>
      {children}
    </View>
  )
}

/**
 * HBars — a horizontal-bar leaderboard (label · bar · value). For "top N by measure" lists.
 * Pure Views so it themes and wraps cleanly; pass a preformatted valueLabel for currency/percent.
 */
export function HBars({
  data,
  className,
}: {
  data: { label: string; value: number; valueLabel?: string; color?: string }[]
  className?: string
}) {
  const colors = useColors()
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <View className={cn('gap-2.5', className)}>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`} className="gap-1">
          <View className="flex-row items-center justify-between gap-2">
            <Text variant="caption" numberOfLines={1} className="flex-1 text-foreground">{d.label}</Text>
            <Text variant="caption" className="text-muted-foreground">{d.valueLabel ?? String(d.value)}</Text>
          </View>
          <View className="h-2 w-full overflow-hidden rounded-full bg-accent">
            <View
              style={{ width: `${Math.max(2, (Math.max(0, d.value) / max) * 100)}%`, backgroundColor: d.color ?? colors.primary }}
              className="h-full rounded-full"
            />
          </View>
        </View>
      ))}
    </View>
  )
}

/**
 * DeltaBadge — period-over-period change as a colored ▲/▼ percentage. `delta` is a signed fraction
 * (0.123 → +12.3%). `inverse` flips the color semantics for "lower is better" metrics (cost, churn,
 * error rate). Renders nothing when delta is null/undefined/non-finite (no baseline yet).
 */
export function DeltaBadge({
  delta,
  inverse = false,
  className,
}: {
  delta: number | null | undefined
  inverse?: boolean
  className?: string
}) {
  const colors = useColors()
  if (delta == null || !Number.isFinite(delta)) return null
  const up = delta > 0
  const neutral = delta === 0
  const good = inverse ? !up : up
  const color = neutral ? colors.mutedForeground : good ? colors.success : colors.destructive
  const Arrow = up ? TrendingUp : TrendingDown
  return (
    <View className={cn('flex-row items-center gap-0.5', className)}>
      {!neutral ? <Arrow size={12} color={color} /> : null}
      <Text variant="caption" style={{ color }}>
        {`${up ? '+' : ''}${(delta * 100).toFixed(1)}%`}
      </Text>
    </View>
  )
}

/**
 * channelColor — a stable categorical color for a string key, so the same key (a channel, a
 * category, a member id) keeps its color in every chart + legend regardless of row order or of
 * siblings appearing/disappearing (cadio precedent, generalized from its fixed ad-channel list to
 * any key). A deterministic FNV-1a hash of the key indexes into the palette — pass
 * `chartPalette(...)`/`useChartPalette()` output. Distinct keys can collide on a color (8 slots);
 * for guaranteed-distinct small sets, index the palette by position instead.
 */
export function channelColor(palette: string[], key: string): string {
  if (palette.length === 0) return 'transparent' // defensive — chartPalette never returns empty
  // FNV-1a 32-bit: tiny, dependency-free, good spread on short keys.
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return palette[(h >>> 0) % palette.length]
}

/**
 * MultiLineChart — web-safe multi-series line chart on a shared y-scale. One Polyline per series;
 * non-finite points are skipped, bridging gaps. Colors: explicit `series[].color` wins, a `dashed`
 * series (a reference/baseline overlay, e.g. a blended average) renders muted + dashed, everything
 * else walks the colorBlindSafe-aware categorical ramp by index. `dates` only sets the x domain
 * (points are spaced evenly); labels aren't rendered — keep the count in a caption if needed.
 */
export function MultiLineChart({
  dates,
  series,
  height = 200,
  showLegend = true,
  className,
}: {
  dates: string[]
  series: { key: string; label: string; values: number[]; color?: string; dashed?: boolean }[]
  height?: number
  showLegend?: boolean
  className?: string
}) {
  const colors = useColors()
  const palette = useChartPalette()
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v))
  const colorFor = (s: { color?: string; dashed?: boolean }, idx: number): string =>
    s.color ?? (s.dashed ? colors.mutedForeground : palette[idx % palette.length])
  if (all.length < 2 || dates.length < 2) {
    return (
      <View style={{ height }} className={cn('w-full items-center justify-center', className)}>
        <Text variant="caption" className="text-muted-foreground">{t('charts.noData')}</Text>
      </View>
    )
  }
  const max = Math.max(...all)
  const min = Math.min(...all)
  const range = max - min || 1
  const n = dates.length
  return (
    <View className={cn('w-full', className)}>
      <View style={{ height }}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          {series.map((s, idx) => {
            const pts = s.values
              .map((v, i) => [i, v] as const)
              .filter(([, v]) => Number.isFinite(v))
              .map(([i, v]) => `${(i / (n - 1)) * 100},${100 - ((v - min) / range) * 100}`)
              .join(' ')
            if (!pts) return null
            return (
              <Polyline
                key={s.key}
                points={pts}
                fill="none"
                stroke={colorFor(s, idx)}
                strokeWidth={s.dashed ? 1.5 : 2.25}
                strokeDasharray={s.dashed ? '3 2' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
        </Svg>
      </View>
      {showLegend ? (
        <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
          {series.map((s, idx) => (
            <View key={s.key} className="flex-row items-center gap-1.5">
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorFor(s, idx) }} />
              <Text variant="caption" className="text-muted-foreground">{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}
