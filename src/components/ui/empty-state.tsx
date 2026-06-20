import { View } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * EmptyState — the canonical "nothing here yet" block: icon + title + description + optional action.
 * Use it for empty lists, no-results, and first-run states so they never feel broken.
 */
export type EmptyStateProps = {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  const colors = useColors()
  return (
    <View className={cn('items-center gap-4 p-8', className)}>
      {Icon ? (
        <View className="size-16 items-center justify-center rounded-full bg-accent">
          <Icon color={colors.mutedForeground} size={28} />
        </View>
      ) : null}
      <View className="items-center gap-1">
        <Text variant="h3">{title}</Text>
        {description ? (
          <Text variant="muted" className="max-w-xs text-center">
            {description}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  )
}
