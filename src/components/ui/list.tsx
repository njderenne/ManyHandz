import { View, Pressable } from 'react-native'
import { cn } from '@/lib/utils'
import { Text } from './text'

/**
 * List + ListItem — grouped rows on a card surface (settings, menus, results).
 * ListItem takes optional `left`/`right` slots and becomes pressable when `onPress` is set.
 */
export function List({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <View className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      {children}
    </View>
  )
}

export type ListItemProps = {
  title: string
  subtitle?: string
  left?: React.ReactNode
  right?: React.ReactNode
  onPress?: () => void
  className?: string
}

export function ListItem({ title, subtitle, left, right, onPress, className }: ListItemProps) {
  const inner = (
    <>
      {left}
      <View className="flex-1 gap-0.5">
        <Text variant="label">{title}</Text>
        {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
      </View>
      {right}
    </>
  )
  const base = 'flex-row items-center gap-3 border-b border-border px-4 py-3.5'
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        className={cn(base, 'active:bg-accent', className)}
      >
        {inner}
      </Pressable>
    )
  }
  return <View className={cn(base, className)}>{inner}</View>
}
