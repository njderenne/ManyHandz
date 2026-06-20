import { View } from 'react-native'
import { cn } from '@/lib/utils'
import { fonts } from '@/lib/config/fonts'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

/**
 * UnreadBadge — the tiny unread-count pill for nav placements (tab items, header bells, settings
 * rows). Primary-on-primary theming, deliberately distinct from BadgeDot's destructive "attention"
 * styling: unread counts are informational, not alarming. Counts above 9 render as "9+"; 0 (or
 * negative) renders nothing, so callers can bind it straight to `unreadCount(…)` from
 * src/lib/query/hooks/useNotifications.ts without conditionals.
 */
export type UnreadBadgeProps = {
  /** Unread count — 0 or less renders nothing. */
  count: number
  /** Plain dot instead of the count pill, for tight placements (e.g. tab-bar icons). */
  dot?: boolean
  className?: string
}

export function UnreadBadge({ count, dot = false, className }: UnreadBadgeProps) {
  if (count <= 0) return null
  const label = count > 9 ? '9+' : String(count)
  return (
    <View
      accessibilityLabel={t('notifications.unreadCountA11y', { count })}
      className={cn(
        'items-center justify-center rounded-full bg-primary',
        dot ? 'size-2.5' : 'h-4 min-w-4 px-1',
        className,
      )}
    >
      {dot ? null : (
        // Below the smallest Text variant — fixed 10px digits keep the pill 16px tall. Font
        // scaling is pinned (multiplier 1) so large-text settings can't burst the fixed pill;
        // the accessibilityLabel above carries the count for assistive tech instead.
        <Text
          className="text-primary-foreground"
          style={{ fontSize: 10, lineHeight: 12, fontFamily: fonts.semibold }}
          maxFontSizeMultiplier={1}
        >
          {label}
        </Text>
      )}
    </View>
  )
}
