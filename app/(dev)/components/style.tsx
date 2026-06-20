import { useState } from 'react'
import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Gradient } from '@/components/ui/gradient'
import { Stagger } from '@/components/ui/stagger'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Progress } from '@/components/ui/progress'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useThemeMode } from '@/lib/config/theme'
import { formatCurrency } from '@/lib/format/currency'
import { Section, Swatch } from '@/components/gallery/kit'

/**
 * Style tab — the design language: color tokens, candidate color schemes, the type scale,
 * gradients, and the radius scale. The "pick what it looks like" surface.
 */

const COLOR_SCHEMES = [
  { name: '1 · Indigo (default)', colors: ['#a5affc', '#6366f1', '#4338ca'] },
  { name: '2 · Emerald', colors: ['#6ee7b7', '#10b981', '#047857'] },
  { name: '3 · Rose', colors: ['#fda4af', '#f43f5e', '#be123c'] },
  { name: '4 · Amber', colors: ['#fcd34d', '#f59e0b', '#b45309'] },
  { name: '5 · Sky', colors: ['#7dd3fc', '#0ea5e9', '#0369a1'] },
]

const RADII = [
  { name: 'sm · 8', className: 'rounded-sm' },
  { name: 'md · 10', className: 'rounded-md' },
  { name: 'lg · 12', className: 'rounded-lg' },
  { name: 'xl · 16', className: 'rounded-xl' },
  { name: 'full', className: 'rounded-full' },
]

export default function StyleScreen() {
  const [replayKey, setReplayKey] = useState(0)
  const [stat, setStat] = useState(1280)
  const [prog, setProg] = useState(35)
  const mode = useThemeMode((s) => s.mode)
  const setMode = useThemeMode((s) => s.setMode)
  const replay = () => {
    setStat((s) => s + 1340)
    setProg((p) => (p >= 90 ? 20 : p + 25))
    setReplayKey((k) => k + 1)
  }
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Style</Text>

      <Section title="Theme" description="Light / Dark / System — applies to everything instantly">
        <SegmentedControl
          value={mode}
          onValueChange={(v) => setMode(v as 'light' | 'dark' | 'system')}
          options={[
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
            { label: 'System', value: 'system' },
          ]}
        />
      </Section>

      <Section title="Color tokens" description="Semantic tokens from tailwind.config.js">
        <View className="flex-row flex-wrap gap-3">
          <Swatch name="background" className="bg-background" />
          <Swatch name="card" className="bg-card" />
          <Swatch name="primary" className="bg-primary" />
          <Swatch name="secondary" className="bg-secondary" />
          <Swatch name="accent" className="bg-accent" />
          <Swatch name="muted" className="bg-muted" />
          <Swatch name="destructive" className="bg-destructive" />
          <Swatch name="success" className="bg-success" />
          <Swatch name="warning" className="bg-warning" />
        </View>
        <View className="flex-row flex-wrap gap-3">
          <Swatch name="brand-300" className="bg-brand-300" />
          <Swatch name="brand-400" className="bg-brand-400" />
          <Swatch name="brand-500" className="bg-brand-500" />
          <Swatch name="brand-600" className="bg-brand-600" />
          <Swatch name="brand-700" className="bg-brand-700" />
        </View>
      </Section>

      <Section title="Color schemes (1–5)" description="Candidate brand palettes — pick one per app">
        <View className="gap-3">
          {COLOR_SCHEMES.map((s) => (
            <View key={s.name} className="flex-row items-center gap-3">
              <View className="flex-row overflow-hidden rounded-md border border-border">
                {s.colors.map((c) => (
                  <View key={c} className="size-10" style={{ backgroundColor: c }} />
                ))}
              </View>
              <Text variant="muted">{s.name}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Typography" description="One scale, set in Text variants">
        <Text variant="h1">Heading 1</Text>
        <Text variant="h2">Heading 2</Text>
        <Text variant="h3">Heading 3</Text>
        <Text variant="body">Body — the default paragraph text.</Text>
        <Text variant="label">Label — form fields and controls.</Text>
        <Text variant="muted">Muted — secondary, lower-emphasis copy.</Text>
        <Text variant="caption">Caption — the smallest annotation tier.</Text>
      </Section>

      <Section title="Gradients" description="Drawn with react-native-svg (no extra native module)">
        <View className="gap-3">
          <Gradient colors={['#6366f1', '#a855f7']} className="h-20 justify-end p-3">
            <Text variant="h3" className="text-base text-white">Indigo → Violet</Text>
          </Gradient>
          <Gradient colors={['#0ea5e9', '#22c55e']} className="h-20 justify-end p-3">
            <Text variant="h3" className="text-base text-white">Sky → Emerald</Text>
          </Gradient>
          <Gradient colors={['#f59e0b', '#ef4444', '#ec4899']} className="h-20 justify-end p-3">
            <Text variant="h3" className="text-base text-white">Amber → Rose</Text>
          </Gradient>
        </View>
      </Section>

      <Section title="Radius scale">
        <View className="flex-row flex-wrap gap-3">
          {RADII.map((r) => (
            <View key={r.name} className="items-center gap-1">
              <View className={`size-14 border border-border bg-accent ${r.className}`} />
              <Text variant="caption">{r.name}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Motion" description="Tap Replay — the number counts up, the bar fills, and the cards cascade in. Every button also springs when you press it.">
        <Button label="Replay" className="self-start" onPress={replay} />
        <Card>
          <CardContent className="items-center gap-3 py-6">
            <AnimatedNumber value={stat} variant="h1" format={formatCurrency} />
            <Text variant="caption">Animated counter</Text>
            <Progress value={prog} className="mt-1" />
          </CardContent>
        </Card>
        <Stagger key={replayKey} className="gap-2">
          {['First card in', 'Second card in', 'Third card in'].map((label) => (
            <Card key={label}>
              <CardContent className="py-3">
                <Text variant="label">{label}</Text>
              </CardContent>
            </Card>
          ))}
        </Stagger>
      </Section>

      <Section title="Card styles">
        <Card>
          <CardContent>
            <Text variant="label">Default</Text>
            <Text variant="muted">border + card surface</Text>
          </CardContent>
        </Card>
        <Card className="border-0 bg-muted">
          <CardContent>
            <Text variant="label">Filled</Text>
            <Text variant="muted">no border, muted fill</Text>
          </CardContent>
        </Card>
        <Card className="bg-transparent">
          <CardContent>
            <Text variant="label">Outline</Text>
            <Text variant="muted">border only, transparent</Text>
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}
