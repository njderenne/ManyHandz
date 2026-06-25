import { useState } from 'react'
import { View, Pressable } from 'react-native'
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
import {
  useSubscription,
  usePlans,
  formatPlanPrice,
  formatPriceAmount,
  frequencyLabel,
  TIER_ORDER,
  type Tier,
  type PlanPrice,
} from '@/lib/billing/useSubscription'
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
 * FALLBACK paywall copy. The live source is GET /api/billing/plans (usePlans below) — composed
 * from Stripe + product metadata and managed centrally by the studio admin (Criterial). These
 * consts only render when that fetch hasn't resolved or a tier's price can't be read, so the
 * paywall is never blank. FEATURES are marketing copy, not enforcement (that's TierGate + Worker).
 */
const FALLBACK_PRICES: Record<Tier, string> = {
  FREE: '$0',
  STANDARD: '$6.99 / month',
  PREMIUM: '$14.99 / month',
}

const FALLBACK_FEATURES: Record<Tier, string[]> = {
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
 * Fallback Stripe price IDs (EXPO_PUBLIC_, inlined at build) — used only if /api/billing/plans
 * can't be reached. Normally the price id comes live from that endpoint, so pricing changes need
 * no rebuild. Keep these set to the SAME ids the Worker holds as STRIPE_PRICE_STANDARD/PREMIUM.
 */
const FALLBACK_PRICE_IDS: Partial<Record<Tier, string>> = {
  STANDARD: process.env.EXPO_PUBLIC_STRIPE_PRICE_STANDARD,
  PREMIUM: process.env.EXPO_PUBLIC_STRIPE_PRICE_PREMIUM,
}

export default function PaywallScreen() {
  const { toast } = useToast()
  const colors = useColors()
  const { data: session } = useSession()
  const { data: summary, refetch } = useSubscription()
  const { data: plans } = usePlans()
  const [buying, setBuying] = useState<Tier | null>(null)
  const [managing, setManaging] = useState(false)
  // The billing frequency the user picked per tier (priceId). Defaults to the tier's primary.
  const [selectedPrice, setSelectedPrice] = useState<Partial<Record<Tier, string>>>({})

  const currentTier: Tier = summary?.tier ?? 'FREE'

  // Per-tier view: live plans (GET /api/billing/plans) layered over the baked fallbacks, with the
  // user-selected billing frequency. Always renders even if the plans fetch is pending.
  const view = (tier: Tier) => {
    const plan = plans?.tiers.find((p) => p.tier === tier)
    const prices: PlanPrice[] = plan?.prices ?? []
    const selectedId = selectedPrice[tier] ?? plan?.priceId ?? prices[0]?.priceId ?? null
    const selected = prices.find((p) => p.priceId === selectedId) ?? null
    const amount = selected ? formatPriceAmount(selected) : plan ? formatPlanPrice(plan) : null
    return {
      label: plan?.label ?? APP_CONFIG.monetization.tiers[tier].label,
      amount: amount ?? FALLBACK_PRICES[tier],
      frequency: selected ? frequencyLabel(selected) : null,
      features: plan && plan.features.length ? plan.features : FALLBACK_FEATURES[tier],
      priceId: selectedId ?? FALLBACK_PRICE_IDS[tier],
      prices,
    }
  }

  const upgrade = async (tier: Tier) => {
    if (!session) {
      toast({ title: t('paywall.signInToSubscribe'), variant: 'error' })
      return
    }
    const priceId = view(tier).priceId
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
          const v = view(tier)
          // Hide a paid tier with no price (a half-configured / unsold tier).
          if (isPaid && !v.priceId) return null
          return (
            <Card key={tier} className={isCurrent ? 'border-primary' : undefined}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{v.label}</CardTitle>
                {isCurrent ? <Badge variant="secondary" label={t('paywall.currentPlan')} /> : null}
              </CardHeader>
              <CardContent className="gap-3">
                <View className="gap-0.5">
                  <Text variant="h2">{v.amount}</Text>
                  {v.frequency ? <Text variant="caption">{v.frequency}</Text> : null}
                </View>
                {isPaid && v.prices.length > 1 ? (
                  <View className="flex-row flex-wrap gap-2">
                    {v.prices.map((p) => {
                      const on = p.priceId === v.priceId
                      return (
                        <Pressable
                          key={p.priceId}
                          onPress={() => setSelectedPrice((s) => ({ ...s, [tier]: p.priceId }))}
                          className={`rounded-full border px-3 py-1.5 ${on ? 'border-primary bg-primary/10' : 'border-border'}`}
                        >
                          <Text variant="label" className={on ? 'text-primary' : 'text-muted-foreground'}>
                            {frequencyLabel(p)}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                ) : null}
                <View className="gap-1.5">
                  {v.features.map((feature) => (
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
                    label={t('paywall.getPlan', { plan: v.label })}
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
