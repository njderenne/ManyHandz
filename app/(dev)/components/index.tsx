import { View } from 'react-native'
import { Palette, TextCursorInput, LayoutGrid, Bell, Layers, Smartphone, Ruler } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { HubList, type HubItem } from '@/components/gallery/hub'

/**
 * Components hub — entry point of the Components tab. One row per gallery category; rows push
 * stack screens, so new categories are a row + a file (no new tabs as the chassis grows).
 */
const CATEGORIES: HubItem[] = [
  { title: 'Style', description: 'Colors, type scale, gradients, radii, theme', icon: Palette, route: '/components/style' },
  { title: 'Inputs', description: 'Buttons + every form control, validated form', icon: TextCursorInput, route: '/components/inputs' },
  { title: 'Measurement', description: 'Unit-aware input, imperial/metric formatting', icon: Ruler, route: '/components/measurement' },
  { title: 'Display', description: 'Cards, avatars, badges, lists, charts', icon: LayoutGrid, route: '/components/display' },
  { title: 'Feedback', description: 'Toasts, alerts, skeletons, progress, empty states', icon: Bell, route: '/components/feedback' },
  { title: 'Layout', description: 'Headers, sheets, tabs, navigation chrome', icon: Layers, route: '/components/chrome' },
  { title: 'Screens', description: 'Full example screens assembled from the kit', icon: Smartphone, route: '/components/screens' },
]

export default function ComponentsHub() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <View className="gap-1">
        <Text variant="h1">Components</Text>
        <Text variant="muted">The chassis, by category. Everything themes from your tokens.</Text>
      </View>
      <HubList items={CATEGORIES} />
    </PageWrapper>
  )
}
