import { View } from 'react-native'
import { router } from 'expo-router'
import { Lock } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { useHasTier, type Tier } from '@/lib/billing/useSubscription'
import { APP_CONFIG } from '@/lib/config/app'
import { Text } from './text'
import { Button } from './button'

/**
 * TierGate — render children only when the active org's subscription meets `min`.
 *
 * The runtime companion to FeatureGate (./feature-gate.tsx): FeatureGate gates on compile-time
 * APP_CONFIG feature flags (what this app ships), TierGate gates on the live subscription tier
 * from the Worker (what this org has paid for) via useHasTier — failing closed to FREE while
 * loading or signed out. Default fallback is a compact upgrade card that pushes /paywall.
 */
export function TierGate({
  min,
  children,
  fallback,
}: {
  min: Tier
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const hasTier = useHasTier(min)
  if (hasTier) return <>{children}</>
  return <>{fallback ?? <UpgradePrompt min={min} />}</>
}

/** The default gate fallback — a compact card naming the required plan, CTA → /paywall. */
export function UpgradePrompt({ min, className }: { min: Tier; className?: string }) {
  const colors = useColors()
  const plan = APP_CONFIG.monetization.tiers[min].label
  return (
    <View
      className={cn(
        'flex-row items-center gap-3 rounded-xl border border-border bg-card p-4',
        className,
      )}
    >
      <Lock color={colors.brand} size={20} />
      <View className="flex-1 gap-0.5">
        <Text variant="label">{plan} feature</Text>
        <Text variant="muted">Upgrade your plan to unlock this.</Text>
      </View>
      <Button size="sm" label="Upgrade" onPress={() => router.push('/paywall')} />
    </View>
  )
}
