import { View } from 'react-native'
import { Flame } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { Text } from '@/components/ui/text'
import { useColors } from '@/lib/config/theme'
import { t } from '@/lib/i18n'

/**
 * StreakFlame — the compact streak widget for headers, stat rows, and profile chips: a flame
 * icon + the current consecutive-day count, with an optional personal-best subtext. Muted when
 * the streak is 0 (broken or never started); warm when alive. Purely presentational — feed it
 * `useStreak(orgId)` data:
 *
 *   const { data } = useStreak(orgId)
 *   <StreakFlame count={data?.currentCount ?? 0} best={data?.longestCount} />
 */
export type StreakFlameProps = {
  /** Effective consecutive-day count (useStreak's `currentCount`) — 0 renders muted. */
  count: number
  /** Personal best (useStreak's `longestCount`) — renders the 'best {n}' subtext when > 0. */
  best?: number
  className?: string
}

export function StreakFlame({ count, best, className }: StreakFlameProps) {
  const colors = useColors()
  const active = count > 0
  const showBest = typeof best === 'number' && best > 0
  return (
    <View
      accessibilityLabel={
        showBest
          ? t('streaks.countWithBestA11y', { count, best })
          : t('streaks.countA11y', { count })
      }
      className={cn('flex-row items-center gap-1', className)}
    >
      <Flame size={14} color={active ? colors.warning : colors.mutedForeground} />
      {/* caption variant is muted by default — the 0 state; an alive streak lifts to foreground. */}
      <Text variant="caption" className={active ? 'text-foreground' : undefined}>
        {String(count)}
      </Text>
      {showBest ? <Text variant="caption">{t('streaks.best', { n: best })}</Text> : null}
    </View>
  )
}
