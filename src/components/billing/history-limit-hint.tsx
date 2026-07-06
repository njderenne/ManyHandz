import { View } from 'react-native'
import { router } from 'expo-router'
import { History } from 'lucide-react-native'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { useColors } from '@/lib/config/theme'
import { useHasTier } from '@/lib/billing/useSubscription'
import { limitFor } from '@/lib/config/monetization'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'

/**
 * HistoryLimitHint — a compact "you're seeing limited history" banner for FREE orgs, shown above
 * truncated history lists (pet-pilot donor, genericized). The SERVER is the real gate: list
 * routes clamp a FREE org's window via historyCutoff (worker/billing/limits.ts, reserved key
 * monetization.limits.historyDays), so a FREE user simply receives fewer rows — this banner
 * explains WHY and links to the paywall.
 *
 * Renders NOTHING when the org already meets the trial tier (they get the full window — nothing
 * to upsell) or when the historyDays key is absent (the enforcement is a no-op, so the hint would
 * be a lie). It leans on useHasTier, which is FREE-while-loading — acceptable for a non-blocking
 * soft upsell that disappears once the real tier resolves; this is a hint, not a gate.
 */
export function HistoryLimitHint({ days }: { days?: number }) {
  const colors = useColors()
  const entitled = useHasTier(APP_CONFIG.subscription.trialTier)
  const window = days ?? limitFor('historyDays')
  if (entitled || window === undefined) return null

  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3">
      <History color={colors.brand} size={18} />
      <View className="flex-1 gap-0.5">
        <Text variant="label">{t('billing.historyHint', { days: window })}</Text>
        <Text variant="muted">
          {t('billing.historyHintUpgrade', {
            plan: APP_CONFIG.monetization.tiers[APP_CONFIG.subscription.trialTier].label,
          })}
        </Text>
      </View>
      <Button
        size="sm"
        label={t('billing.upgradeAction')}
        onPress={() => router.push('/paywall?reason=tier_required')}
      />
    </View>
  )
}
