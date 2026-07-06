import { Suspense, lazy } from 'react'
import { Platform, View } from 'react-native'
import { Redirect } from 'expo-router'
import { ChartColumnBig } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Section } from '@/components/gallery/kit'
import {
  AreaSparkline,
  DeltaBadge,
  Donut,
  HBars,
  MultiLineChart,
  StackedBars,
  channelColor,
} from '@/components/ui/chart'
// Direct file imports, NOT the '@/components/charts' barrel: this route is statically bundled
// (expo-router), and the barrel also evaluates the EAGER Skia impls — on web that binds
// victory-native's CanvasKit reference before the wasm loads and poisons every later Skia render.
// The files below pull only the light lazy-wrapper machinery (see charts/lazy-skia.tsx).
import { ensureSkiaWeb } from '@/components/charts/lazy-skia'
import { LineChartSkia } from '@/components/charts/line-chart-skia'
import { useChartPalette } from '@/components/charts/palette'
import { usePrefs } from '@/lib/prefs'
import { t } from '@/lib/i18n'

/**
 * Charts gallery (pushed route, not a tab). Three tiers, top to bottom:
 *
 *   1. INLINE PRIMITIVES (ui/chart.tsx) — dependency-free SVG/View charts that render everywhere
 *      at zero bundle cost, all colored through chartPalette so the colorBlindSafe toggle below
 *      re-colors them live.
 *   2. LAZY SKIA VARIANTS (charts/*-skia.tsx) — import-anywhere wrappers that defer
 *      victory-native/Skia (and CanvasKit on web) until the chart mounts. No gating ceremony.
 *   3. THE EAGER SHOWCASE (gallery/charts-showcase.tsx) — the original suite, still gated here
 *      because it imports the eager chart impls via the barrel. ensureSkiaWeb() loads CanvasKit
 *      BEFORE that graph evaluates on web; on native it's a no-op and the ErrorBoundary catches
 *      builds that predate the Skia module.
 */
const ChartsShowcase = lazy(async () => {
  await ensureSkiaWeb()
  return import('@/components/gallery/charts-showcase')
})

function Unavailable() {
  return (
    <EmptyState
      icon={ChartColumnBig}
      title={Platform.OS === 'web' ? "Charts couldn't load" : 'Charts need the latest dev build'}
      description={
        Platform.OS === 'web'
          ? 'The chart engine (CanvasKit) failed to download — check your connection and reload the page.'
          : 'The chart engine (Skia) was just added. Install the newest dev build to view the interactive charts.'
      }
    />
  )
}

/** Deterministic sample data (gallery only) — indexes walk the palette like real dashboards do. */
const TREND = [12, 18, 15, 24, 21, 30, 27, 36, 33, 41]
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STACK_ROWS = [
  [5, 3, 2],
  [7, 2, 4],
  [4, 6, 3],
  [8, 4, 2],
  [6, 5, 5],
  [9, 3, 4],
  [7, 6, 3],
]

/** The colorBlindSafe pref, demoed live — flipping it re-colors every chart above/below instantly. */
function PaletteToggleCard() {
  const colorBlindSafe = usePrefs((s) => s.colorBlindSafe)
  const setColorBlindSafe = usePrefs((s) => s.setColorBlindSafe)
  const palette = useChartPalette()
  return (
    <Card>
      <CardContent className="gap-3">
        <View className="flex-row items-center justify-between gap-4">
          <View className="flex-1 gap-0.5">
            <Text variant="label">{t('preferences.colorBlindSafe')}</Text>
            <Text variant="caption">{t('preferences.colorBlindSafeHint')}</Text>
          </View>
          <Switch value={colorBlindSafe} onValueChange={setColorBlindSafe} />
        </View>
        {/* The active ramp, swatch by swatch — series 0 is brand-anchored in the default ramp. */}
        <View className="flex-row gap-1.5">
          {palette.map((c) => (
            <View key={c} style={{ backgroundColor: c }} className="h-5 flex-1 rounded-sm" />
          ))}
        </View>
      </CardContent>
    </Card>
  )
}

/** Every ui/chart.tsx primitive with live palette colors + the empty/single-datum edge cases. */
function PrimitivesGallery() {
  const palette = useChartPalette()
  const donutData = [
    { value: 44, color: palette[0] },
    { value: 27, color: palette[1] },
    { value: 18, color: palette[2] },
    { value: 11, color: palette[3] },
  ]
  const stacked = STACK_ROWS.map((row) => ({
    segments: row.map((value, i) => ({ value, color: palette[i % palette.length] })),
  }))
  const leaderboard = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((label, i) => ({
    label,
    value: [34, 27, 19, 8][i],
    valueLabel: `${[34, 27, 19, 8][i]} pts`,
    color: channelColor(palette, label), // stable key→color: same label, same color, every chart
  }))
  return (
    <>
      <Section title="Area sparkline (svg)" description="Filled single-metric trend for dashboard cards">
        <Card>
          <CardContent className="gap-4">
            <AreaSparkline data={TREND} />
            <View className="flex-row gap-4">
              <View className="flex-1">
                <AreaSparkline data={[]} height={48} className="rounded-md bg-muted/30" />
              </View>
              <View className="flex-1">
                <AreaSparkline data={[42]} height={48} className="rounded-md bg-muted/30" />
              </View>
            </View>
            <Text variant="caption">Fewer than two finite points (empty / single datum) renders an empty frame, never NaN geometry.</Text>
          </CardContent>
        </Card>
      </Section>

      <Section title="Stacked bars" description="Per-period totals split into palette-colored segments">
        <Card>
          <CardContent className="gap-4">
            <StackedBars data={stacked} />
            <StackedBars data={stacked.slice(0, 1)} height={64} />
            <Text variant="caption">A single column still lays out; segment colors walk the active ramp.</Text>
          </CardContent>
        </Card>
      </Section>

      <Section title="Donut" description="Share-of-total ring with a center overlay">
        <Card>
          <CardContent className="flex-row flex-wrap items-center gap-6">
            <Donut data={donutData}>
              <View className="items-center">
                <Text variant="caption" className="text-muted-foreground">Total</Text>
                <Text variant="label">100</Text>
              </View>
            </Donut>
            <View className="items-center gap-2">
              <Donut data={[{ value: 0, color: palette[0] }]} size={96} strokeWidth={12} />
              <Text variant="caption">Zero total → placeholder ring</Text>
            </View>
          </CardContent>
        </Card>
      </Section>

      <Section title="Horizontal bars" description="Label · bar · value leaderboard; colors via channelColor(key)">
        <Card>
          <CardContent className="gap-4">
            <HBars data={leaderboard} />
            <HBars data={leaderboard.slice(0, 1)} />
          </CardContent>
        </Card>
      </Section>

      <Section title="Delta badge" description="Signed period-over-period change; `inverse` for lower-is-better metrics">
        <Card>
          <CardContent className="flex-row flex-wrap items-center gap-x-6 gap-y-2">
            <DeltaBadge delta={0.123} />
            <DeltaBadge delta={-0.045} />
            <DeltaBadge delta={0} />
            <DeltaBadge delta={-0.045} inverse />
            <DeltaBadge delta={null} />
            <Text variant="caption">up · down · flat · down-but-inverse (good) · null renders nothing</Text>
          </CardContent>
        </Card>
      </Section>

      <Section title="Multi-line (svg)" description="Shared y-scale, palette-walked series, dashed reference overlay">
        <Card>
          <CardContent className="gap-4">
            <MultiLineChart
              dates={WEEK}
              series={[
                { key: 'active', label: 'Active', values: [14, 22, 18, 27, 24, 33, 29] },
                { key: 'new', label: 'New', values: [6, 9, 7, 12, 10, 15, 13] },
                { key: 'baseline', label: '7-day avg', values: [12, 13, 14, 15, 16, 17, 18], dashed: true },
              ]}
            />
            <MultiLineChart dates={['Mon']} series={[{ key: 'x', label: 'X', values: [3] }]} height={96} showLegend={false} />
            <Text variant="caption">One point (or one date) can't make a line — the shared no-data state renders instead.</Text>
          </CardContent>
        </Card>
      </Section>
    </>
  )
}

export default function ChartsScreen() {
  // PRODUCTION GUARD (same as app/(dev)/_layout.tsx): this is a QA/demo gallery, not a product
  // screen — reachable by URL/deep link, so a release build must redirect home before a store
  // reviewer stumbles into demo content (Apple 2.3.x class). Lives outside the (dev) group only
  // because it's a pushed route, not a tab.
  if (!__DEV__) return <Redirect href="/" />
  return (
    <PageWrapper className="gap-6 pb-24">
      <View className="gap-1">
        <Text variant="h1">Charts</Text>
        <Text variant="muted">
          Web-safe inline primitives, lazy Skia variants, and the interactive victory-native suite. Flip the palette toggle and watch every series re-color live.
        </Text>
      </View>

      <PaletteToggleCard />
      <PrimitivesGallery />

      <ErrorBoundary fallback={<Unavailable />}>
        <Section
          title="Lazy Skia (import-anywhere)"
          description="LineChartSkia — no gating ceremony: the wrapper defers Skia (and CanvasKit on web) until mount"
        >
          <Card>
            <CardContent className="gap-4">
              <LineChartSkia data={TREND.map((y, x) => ({ x, y }))} prefix="$" suffix="k" />
              <LineChartSkia data={[]} height={96} />
              <Text variant="caption">Empty data still resolves to the shared placeholder; until the impl loads you see the same frame.</Text>
            </CardContent>
          </Card>
        </Section>

        <Suspense
          fallback={
            <View className="items-center py-12">
              <Spinner />
            </View>
          }
        >
          <ChartsShowcase />
        </Suspense>
      </ErrorBoundary>
    </PageWrapper>
  )
}
