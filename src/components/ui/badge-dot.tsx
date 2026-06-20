import { View } from 'react-native'
import { cn } from '@/lib/utils'
import { fonts } from '@/lib/config/fonts'
import { Text } from './text'

/**
 * BadgeDot — a notification badge pinned to the top-right corner of whatever it wraps (an icon,
 * avatar, or tab item). Renders a plain dot by default, or a count pill when `count` is set
 * (capped at `max`, shown as "99+"). Hidden automatically when the count is 0, so callers can
 * bind it straight to unread counts without conditional rendering.
 */
export type BadgeDotProps = {
  /** Numeric badge. Omit (with `dot` default) for a plain attention dot. */
  count?: number
  /** Counts above this render as "{max}+". */
  max?: number
  /** Force the plain-dot style even when wrapping content. */
  dot?: boolean
  children?: React.ReactNode
  className?: string
}

export function BadgeDot({ count, max = 99, dot = false, children, className }: BadgeDotProps) {
  const showCount = !dot && typeof count === 'number'
  const visible = dot || (showCount && count > 0)
  const label = showCount ? (count > max ? `${max}+` : String(count)) : undefined

  const badge = visible ? (
    <View
      accessibilityLabel={label ? `${label} unread` : 'has updates'}
      className={cn(
        'items-center justify-center rounded-full bg-destructive',
        showCount ? 'h-4 min-w-4 px-1' : 'size-2.5',
        children && 'absolute -right-1 -top-1',
      )}
    >
      {label ? (
        <Text
          className="text-white"
          style={{ fontSize: 10, lineHeight: 12, fontFamily: fonts.semibold }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  ) : null

  if (!children) return <View className={className}>{badge}</View>
  return (
    <View className={cn('self-start', className)}>
      {children}
      {badge}
    </View>
  )
}
