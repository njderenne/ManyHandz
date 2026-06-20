import { useState } from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { BadgeCheck, Check } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TierGate } from '@/components/ui/tier-gate'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { startCheckout, openBillingPortal } from '@/lib/billing'
import { useSubscription, TIER_ORDER, type Tier } from '@/lib/billing/useSubscription'
import { ApiError } from '@/lib/api/client'
import { useSession } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'

/**
 * Paywall — the standard upgrade screen: one plan card per tier in APP_CONFIG.monetization.tiers
 * (label from config, price + feature copy from the per-app consts below), checkout via the
 * existing Stripe helper, and the billing portal for restore/manage. Pushed from TierGate's
 * UpgradePrompt and SubscriptionBanner. The Stripe flow here is the web/dev path — see the
 * platform note at the bottom for what iOS store builds require.
 */

/**
 * Per-app paywall copy — the factory rewrites these when minting. PRICES are display-only
 * placeholders; the real price lives in the Stripe dashboard products behind the price IDs.
 * FEATURES are marketing copy, not enforcement — enforcement is TierGate + the Worker's checks.
 */
const PRICES: Record<Tier, string> = {
  FREE: '$0',
  STANDARD: '$6.99 / month',
  PREMIUM: '$14.99 / month',
}

const FEATURES: Record<Tier, string[]> = {
  FREE: ['Everything you need to get started', `One ${APP_CONFIG.tenant.singular.toLowerCase()}`],
  STANDARD: [
    `Everything in ${APP_CONFIG.monetization.tiers.FREE.label}`,
    'Unlimited usage — no free-tier limits',
    'Priority support',
  ],
  PREMIUM: [
    `Everything in ${APP_CONFIG.monetization.tiers.STANDARD.label}`,
    'Advanced AI features',
    'Early access to new features',
  ],
}

/**
 * Stripe price IDs per paid tier. Client-readable env vars must be EXPO_PUBLIC_-prefixed
 * (inlined into the bundle — see .env.example); set them to the SAME price IDs the Worker
 * holds as STRIPE_PRICE_STANDARD / STRIPE_PRICE_PREMIUM, since that mapping is how the
 * webhook resolves a Stripe price back to a tier.
 */
const PRICE_IDS: Partial<Record<Tier, string>> = {
  STANDARD: process.env.EXPO_PUBLIC_STRIPE_PRICE_STANDARD,
  PREMIUM: process.env.EXPO_PUBLIC_STRIPE_PRICE_PREMIUM,
}

export default function PaywallScreen() {
  const { toast } = useToast()
  const colors = useColors()
  const { data: session } = useSession()
  const { data: summary, refetch } = useSubscription()
  const [buying, setBuying] = useState<Tier | null>(null)
  const [managing, setManaging] = useState(false)

  const currentTier: Tier = summary?.tier ?? 'FREE'

  const upgrade = async (tier: Tier) => {
    if (!session) {
      toast({ title: t('paywall.signInToSubscribe'), variant: 'error' })
      return
    }
    const priceId = PRICE_IDS[tier]
    if (!priceId) {
      toast({
        title: t('paywall.billingNotConfigured'),
        description: t('paywall.billingNotConfiguredHint'),
        variant: 'error',
      })
      return
    }
    setBuying(tier)
    try {
      await startCheckout(priceId)
      // The in-app browser closed — the webhook may have synced a new tier; refresh the summary.
      await refetch()
    } catch (e) {
      toast({
        title: t('paywall.checkoutFailed'),
        description: e instanceof ApiError ? e.message : t('errors.connectionHint'),
        variant: 'error',
      })
    } finally {
      setBuying(null)
    }
  }

  const manage = async () => {
    if (!session) {
      toast({ title: t('paywall.signInToManage'), variant: 'error' })
      return
    }
    setManaging(true)
    try {
      await openBillingPortal()
      await refetch()
    } catch (e) {
      toast({
        title: t('paywall.billingPortalFailed'),
        description: e instanceof ApiError ? e.message : t('errors.connectionHint'),
        variant: 'error',
      })
    } finally {
      setManaging(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('paywall.title') }} />
      <PageWrapper className="gap-5 pb-16">
        <View className="gap-1">
          <Text variant="h1">{t('paywall.hero')}</Text>
          <Text variant="muted">{t('paywall.heroSubtitle', { app: APP_CONFIG.name })}</Text>
        </View>

        {/* THE worked example of TierGate (src/components/ui/tier-gate.tsx) — the client-side
            mirror of the Worker's requireTier gate on POST /api/ai/image (worker/routes/ai.ts).
            The gate only decorates: paying orgs see the confirmation, FREE orgs see nothing.
            fallback must be an empty fragment, not null — TierGate nullish-coalesces a missing
            fallback into its default UpgradePrompt, whose CTA pushes /paywall (a loop here).
            Authorization stays in the Worker; this never replaces a server check. */}
        <TierGate min="STANDARD" fallback={<></>}>
          <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4">
            <BadgeCheck color={colors.success} size={20} />
            <Text variant="label" className="flex-1">
              {t('paywall.onPlan', { plan: APP_CONFIG.monetization.tiers[currentTier].label })}
            </Text>
          </View>
        </TierGate>

        {TIER_ORDER.map((tier) => {
          const isCurrent = tier === currentTier
          const isPaid = tier !== 'FREE'
          // Don't render a paid tier with no configured Stripe price — a minted app may sell fewer
          // tiers than the FREE→STANDARD→PREMIUM ladder, and a dead "Get" button (undefined price →
          // "billing not configured" toast) is worse than no card. Same gating class as the social
          // buttons; pairs with the readiness doctor's "require ≥1 paid price" check.
          if (isPaid && !PRICE_IDS[tier]) return null
          return (
            <Card key={tier} className={isCurrent ? 'border-primary' : undefined}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{APP_CONFIG.monetization.tiers[tier].label}</CardTitle>
                {isCurrent ? <Badge variant="secondary" label={t('paywall.currentPlan')} /> : null}
              </CardHeader>
              <CardContent className="gap-3">
                <Text variant="h2">{PRICES[tier]}</Text>
                <View className="gap-1.5">
                  {FEATURES[tier].map((feature) => (
                    <View key={feature} className="flex-row items-center gap-2">
                      <Check color={colors.success} size={16} />
                      <Text variant="body" className="flex-1">
                        {feature}
                      </Text>
                    </View>
                  ))}
                </View>
                {isPaid && !isCurrent ? (
                  <Button
                    label={t('paywall.getPlan', { plan: APP_CONFIG.monetization.tiers[tier].label })}
                    loading={buying === tier}
                    disabled={buying !== null}
                    onPress={() => upgrade(tier)}
                  />
                ) : null}
              </CardContent>
            </Card>
          )
        })}

        <View className="gap-2">
          <Button
            variant="outline"
            label={t('paywall.restoreManage')}
            loading={managing}
            onPress={manage}
          />
          <Text variant="caption">{t('paywall.restoreHint')}</Text>
        </View>

        {/* Developer note, not product copy — dev builds only, never shipped UI. */}
        {__DEV__ ? (
          <Text variant="caption">
            Note: this Stripe checkout is the web/dev flow. On iOS, purchases of digital goods
            must go through App Store in-app purchase before store release (Apple guideline
            3.1.1) — wire RevenueCat per app; see builder/MINT.md §8.
          </Text>
        ) : null}
      </PageWrapper>
    </>
  )
}
