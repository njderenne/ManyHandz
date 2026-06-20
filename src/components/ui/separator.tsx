import { View } from 'react-native'
import { cn } from '@/lib/utils'

/**
 * Separator — a hairline divider, horizontal (default) or vertical.
 */
export type SeparatorProps = {
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

export function Separator({ orientation = 'horizontal', className }: SeparatorProps) {
  return (
    <View
      className={cn('bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    />
  )
}
