import { View, Pressable } from 'react-native'
import { router, type Href } from 'expo-router'
import { ChevronRight, type LucideIcon } from 'lucide-react-native'
import { Text } from '@/components/ui/text'
import { useColors } from '@/lib/config/theme'

/**
 * Hub list — the gallery's category-row pattern (icon + title + description + chevron, pushes a
 * stack screen). Used by the Components / Native / Services hub tabs so they all read the same.
 */
export type HubItem = { title: string; description: string; icon: LucideIcon; route: Href }

export function HubList({ items }: { items: HubItem[] }) {
  const colors = useColors()
  return (
    <View className="gap-2">
      {items.map(({ title, description, icon: Icon, route }) => (
        <Pressable
          key={title}
          onPress={() => router.push(route)}
          accessibilityRole="button"
          accessibilityLabel={`${title}: ${description}`}
          className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-3 active:bg-accent"
        >
          <View className="size-10 items-center justify-center rounded-md bg-muted">
            <Icon color={colors.brand} size={20} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text variant="label">{title}</Text>
            <Text variant="caption">{description}</Text>
          </View>
          <ChevronRight color={colors.mutedForeground} size={18} />
        </Pressable>
      ))}
    </View>
  )
}
