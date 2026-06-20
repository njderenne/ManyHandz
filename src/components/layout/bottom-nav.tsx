import { View, Pressable } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from '@/components/ui/text'

/**
 * BottomNav — a presentational bottom tab bar (icon + label per tab). The app's real navigation
 * uses Expo Router's <Tabs>; this reusable component is for custom bars or non-route toggles.
 */
export type BottomNavItem = { label: string; icon: LucideIcon; value: string }

export function BottomNav({
  items,
  value,
  onValueChange,
  className,
}: {
  items: BottomNavItem[]
  value: string
  onValueChange: (value: string) => void
  className?: string
}) {
  const colors = useColors()
  return (
    <View className={cn('flex-row border-t border-border bg-card', className)}>
      {items.map((it) => {
        const active = value === it.value
        const Icon = it.icon
        return (
          <Pressable
            key={it.value}
            onPress={() => onValueChange(it.value)}
            className="flex-1 items-center gap-1 py-2 active:opacity-70"
            accessibilityRole="tab"
            accessibilityLabel={it.label}
            accessibilityState={{ selected: active }}
          >
            <Icon color={active ? colors.brand : colors.mutedForeground} size={22} />
            {/* Same scheme-aware token as the icon — a fixed brand-400 class would drift in light mode. */}
            <Text variant="caption" style={active ? { color: colors.brand } : undefined}>
              {it.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
