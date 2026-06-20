import { View, Pressable } from 'react-native'
import { cn } from '@/lib/utils'
import { Text } from './text'

/**
 * Tabs — an in-page tab bar (not navigation). Controlled via `value` + `onValueChange`;
 * the parent renders the active panel. For app-level bottom tabs, use Expo Router's Tabs.
 */
export type TabItem = { label: string; value: string }

export function Tabs({
  tabs,
  value,
  onValueChange,
  className,
}: {
  tabs: TabItem[]
  value: string
  onValueChange: (value: string) => void
  className?: string
}) {
  return (
    <View className={cn('flex-row border-b border-border', className)}>
      {tabs.map((t) => {
        const active = value === t.value
        return (
          <Pressable
            key={t.value}
            onPress={() => onValueChange(t.value)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: active }}
            className={cn('mr-5 border-b-2 pb-2.5 active:opacity-70', active ? 'border-primary' : 'border-transparent')}
          >
            <Text variant={active ? 'label' : 'muted'}>{t.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
