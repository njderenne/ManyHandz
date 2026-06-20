import { View } from 'react-native'
import { Card, CardContent } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { Section } from '@/components/gallery/kit'
import { BarChart as InlineBarChart, Sparkline } from '@/components/ui/chart'
import { AreaChart, BarChart, LineChart, PieChart, ScatterChart, type ChartPoint } from '@/components/charts'

/**
 * Charts showcase — every robust chart type with live sample data. Imported lazily by app/charts.tsx
 * (it pulls in Skia, a native module), so builds without Skia fall back gracefully instead of crashing.
 */
const REVENUE: ChartPoint[] = [
  { x: 0, y: 32 },
  { x: 1, y: 41 },
  { x: 2, y: 38 },
  { x: 3, y: 55 },
  { x: 4, y: 49 },
  { x: 5, y: 67 },
  { x: 6, y: 73 },
  { x: 7, y: 62 },
  { x: 8, y: 84 },
  { x: 9, y: 91 },
  { x: 10, y: 88 },
  { x: 11, y: 104 },
]

const WEEKLY: ChartPoint[] = [
  { x: 0, y: 14 },
  { x: 1, y: 22 },
  { x: 2, y: 18 },
  { x: 3, y: 27 },
  { x: 4, y: 24 },
  { x: 5, y: 33 },
  { x: 6, y: 29 },
]
const DAYS: Record<number, string> = { 0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun' }

const SCATTER: ChartPoint[] = [
  { x: 1, y: 3 },
  { x: 2, y: 5 },
  { x: 3, y: 4 },
  { x: 4, y: 8 },
  { x: 5, y: 6 },
  { x: 6, y: 11 },
  { x: 7, y: 9 },
  { x: 8, y: 13 },
  { x: 9, y: 10 },
  { x: 10, y: 16 },
]

const PLANS = [
  { label: 'Free', value: 120 },
  { label: 'Pro', value: 48 },
  { label: 'Team', value: 32 },
  { label: 'Enterprise', value: 18 },
]

function Note({ children }: { children: string }) {
  return <Text variant="caption">{children}</Text>
}

export default function ChartsShowcase() {
  return (
    <View className="gap-8">
      <Section title="Interactive line" description="Press and drag across the chart to read the value">
        <Card>
          <CardContent className="gap-3">
            <LineChart data={REVENUE} prefix="$" suffix="k" />
            <Note>Drag your finger — the crosshair, dot, and value track on the UI thread (60fps).</Note>
          </CardContent>
        </Card>
      </Section>

      <Section title="Line with markers + trend" description="Point markers and a least-squares regression line">
        <Card>
          <CardContent>
            <LineChart data={REVENUE} markers showTrend prefix="$" suffix="k" />
          </CardContent>
        </Card>
      </Section>

      <Section title="Area" description="Gradient fill + the same drag-to-read crosshair">
        <Card>
          <CardContent>
            <AreaChart data={REVENUE} prefix="$" suffix="k" />
          </CardContent>
        </Card>
      </Section>

      <Section title="Bar" description="Gradient bars with axis labels">
        <Card>
          <CardContent>
            <BarChart data={WEEKLY} labels={DAYS} />
          </CardContent>
        </Card>
      </Section>

      <Section title="Scatter" description="X/Y point cloud">
        <Card>
          <CardContent>
            <ScatterChart data={SCATTER} />
          </CardContent>
        </Card>
      </Section>

      <Section title="Pie & donut" description="Auto-colored from the theme palette">
        <Card>
          <CardContent className="flex-row gap-2">
            <View className="flex-1">
              <PieChart data={PLANS} height={180} />
            </View>
            <View className="flex-1">
              <PieChart data={PLANS} height={180} donut />
            </View>
          </CardContent>
        </Card>
      </Section>

      <Section
        title="Empty & sparse data"
        description="Charts guard zero/garbage input — a freshly minted app's first launch is all empty states"
      >
        <Card>
          <CardContent className="gap-4">
            <LineChart data={[]} height={120} />
            <View className="flex-row gap-2">
              <View className="flex-1">
                <PieChart data={[{ label: 'Free', value: 0 }]} height={120} />
              </View>
              <View className="flex-1">
                <LineChart data={[{ x: 0, y: 42 }]} height={120} markers />
              </View>
            </View>
            <Note>Empty (or all-zero) data renders the shared placeholder; one real point still mounts the chart.</Note>
          </CardContent>
        </Card>
      </Section>

      <Section
        title="Lightweight inline (svg)"
        description="Dependency-free, web-safe — for small dashboards inside regular screens; no Skia cost"
      >
        <Card>
          <CardContent className="gap-4">
            <InlineBarChart data={[4, 8, 5, 12, 9, 14, 7]} />
            <Sparkline data={[3, 5, 4, 8, 6, 9, 7, 11, 10]} />
          </CardContent>
        </Card>
      </Section>
    </View>
  )
}
