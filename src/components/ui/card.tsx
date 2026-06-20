import { View, type ViewProps } from 'react-native'
import { cn } from '@/lib/utils'
import { Text } from './text'

/**
 * Card — the canonical surface container.
 *
 * Card / CardHeader / CardTitle / CardContent compose a padded, bordered surface on the
 * `card` token. Use the sub-parts for consistent internal rhythm, or just `<Card>` for a
 * plain panel.
 */
export function Card({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn('gap-1 p-4 pb-2', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text variant="h3" className={className} {...props} />
}

export function CardContent({ className, ...props }: ViewProps) {
  return <View className={cn('p-4 pt-2', className)} {...props} />
}
