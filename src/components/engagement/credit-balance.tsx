import { View } from 'react-native'
import { Coins } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from '@/components/ui/text'
import { useCreditBalance } from '@/lib/query/hooks/useCredits'
import { t } from '@/lib/i18n'

/**
 * CreditBalance — the compact balance pill for headers, dashboards, and store screens: a coin
 * icon plus the caller's formatted balance, self-fetching via useCreditBalance. Renders nothing
 * until the balance is known (loading, signed out, or no active org), so callers can mount it
 * unconditionally — same bind-and-forget contract as UnreadBadge. Tapping/navigation is the
 * caller's concern: wrap it in a Pressable that pushes /credits where that makes sense.
 */

/**
 * Ledger amounts as display strings — locale-grouped integers ("1,250"). Math.round because
 * AnimatedNumber feeds fractional in-flight values through the same formatter (app/credits.tsx).
 */
export function formatCredits(n: number): string {
  return Math.round(n).toLocaleString()
}

export type CreditBalanceProps = {
  /** Active org — pass `activeOrg?.id ?? ''`; the empty string just renders nothing. */
  orgId: string
  /** Narrow to one ledger namespace (e.g. 'reward_points'); omit for the combined balance. */
  kind?: string
  className?: string
}

export function CreditBalance({ orgId, kind, className }: CreditBalanceProps) {
  const colors = useColors()
  const { data: balance } = useCreditBalance(orgId, kind)
  if (balance === undefined) return null
  return (
    <View
      accessibilityLabel={t('credits.balanceA11y', { count: formatCredits(balance) })}
      className={cn(
        'flex-row items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1',
        className,
      )}
    >
      <Coins size={14} color={colors.warning} />
      <Text variant="label">{formatCredits(balance)}</Text>
    </View>
  )
}
