import { useEffect, useState } from 'react'
import { Platform, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { BadgeCheck, Check } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TierGate } from '@/components/ui/tier-gate'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { startCheckout, openBillingPortal } from '@/lib/billing'
import { paywallMode } from '@/lib/billing/paywall-mode'
import {
  isIapAvailable,
  configurePurchases,
  getOfferings,
  purchasePackage,
  restorePurchases,
  type IapPackage,
} from '@/lib/billing/purchases'
import {
  useSubscription,
  usePlans,
  frequencyLabel,
  formatPriceAmount,
  type PlanPrice,
  type PlanTier,
  type Plans,
  type Tier,
} from '@/lib/billing/useSubscription'
import { tierFallback, isSellable } from '@/lib/config/monetization'
import { ApiError } from '@/lib/api/client'
import { useSession } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { t, type TranslationKey } from '@/lib/i18n'

/**
 * Paywall — the standard upgrade screen, BYTE-IDENTICAL fleet-wide (BILLING_SPEC §9.3 / V5).
 * There are NO per-app constants in this file: baked copy lives in APP_CONFIG.monetization.tiers
 * [tier].fallback (src/lib/config/app.ts) and is OVERRIDDEN at runtime by live Stripe Product
 * metadata served through GET /api/billing/plans — pricing + marketing copy change with no app
 * rebuild. Accepts ?reason=<BillingErrorCode> (isUpgradeError call sites) to headline WHY the
 * user landed here.
 *
 * The golden three-way platform branch (paywallMode — pure + regression-tested):
 *   web                    → Stripe: live /plans cards (frequency chips, trial chip, Lifetime
 *                            card), checkout + billing portal.
 *   native, IAP configured → RevenueCat offerings ONLY (store price strings — /plans Stripe
 *                            amounts NEVER render), filtered to sellable tiers + Restore
 *                            Purchases (Apple requires it).
 *   native, no IAP         → the honest "in-app purchases aren't configured yet" notice.
 *
 * ANTI-STEERING: on native (especially iOS) we never render a Stripe CTA, price, or external
 * purchase link — the only buy path is the store IAP (Apple guideline 3.1.1). Restore stays.
 *
 * To enable native IAP per app: `npm i react-native-purchases` + its config plugin, fill
 * IAP_PRODUCT_TIERS (src/lib/config/entitlements.ts), set EXPO_PUBLIC_REVENUECAT_KEY, rebuild via
 * EAS, and configure the webhook secret REVENUECAT_WEBHOOK_AUTH. See builder/MINT.md.
 */

/**
 * LEGACY client-side price ids (EXPO_PUBLIC_STRIPE_PRICE_*) — FALLBACK ONLY. The live source is
 * GET /api/billing/plans; these render a static card only while the plans fetch is pending or
 * failed, so an existing app mid-backport never shows a blank paywall. New mints don't set them.
 */
const LEGACY_PRICE_IDS: Partial<Record<Tier, string | undefined>> = {
  STANDARD: process.env.EXPO_PUBLIC_STRIPE_PRICE_STANDARD,
  PREMIUM: process.env.EXPO_PUBLIC_STRIPE_PRICE_PREMIUM,
}

/** ?reason= → headline copy. Only known billing-denial codes map; anything else falls through to
 *  the default subtitle (never interpolate an arbitrary query param into a t() key). */
const REASON_KEYS = {
  tier_required: 'paywall.reason.tier_required',
  entity_cap_exceeded: 'paywall.reason.entity_cap_exceeded',
  storage_quota_exceeded: 'paywall.reason.storage_quota_exceeded',
  ai_quota_exceeded: 'paywall.reason.ai_quota_exceeded',
  member_cap_exceeded: 'paywall.reason.member_cap_exceeded',
  tenant_limit_exceeded: 'paywall.reason.tenant_limit_exceeded',
} as const satisfies Record<string, TranslationKey>

export default function PaywallScreen() {
  const { data: summary } = useSubscription()
  const { reason } = useLocalSearchParams<{ reason?: string }>()

  const currentTier: Tier = summary?.tier ?? 'FREE'
  const mode = paywallMode(Platform.OS, isIapAvailable())

  // Own-property check, NOT `in` — a crafted deep link `?reason=toString` would match
  // Object.prototype through the prototype chain and hand a FUNCTION to t() (W-1 hardening).
  const reasonKey =
    reason && Object.hasOwn(REASON_KEYS, reason)
      ? REASON_KEYS[reason as keyof typeof REASON_KEYS]
      : null

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('paywall.title') }} />
      <PageWrapper className="gap-5 pb-16">
        <View className="gap-1">
          <Text variant="h1">{t('paywall.hero')}</Text>
          <Text variant="muted">
            {reasonKey ? t(reasonKey) : t('paywall.heroSubtitle', { app: APP_CONFIG.name })}
          </Text>
        </View>

        {/* THE worked example of TierGate (src/components/ui/tier-gate.tsx) — the client-side mirror
            of the Worker's requireTier gate. The gate only decorates: paying orgs see the
            confirmation, FREE orgs see nothing. fallback must be an empty fragment, not null —
            TierGate nullish-coalesces a missing fallback into its default UpgradePrompt, whose CTA
            pushes /paywall (a loop here). Authorization stays in the Worker; this never replaces it. */}
        <TierGate min="STANDARD" fallback={<></>}>
          <OnPlanBanner currentTier={currentTier} />
        </TierGate>

        {/* Plan cards — three-way by PLATFORM (paywallMode, not just IAP availability), so a native
            build with no RevenueCat NEVER renders a Stripe "Get plan" CTA (anti-steering, Apple
            guideline 3.1.1): native+IAP → store offerings; native−IAP → the honest notice; web →
            Stripe. paywall-mode.test.ts is the regression gate on this branch. */}
        {mode === 'store' ? (
          <NativeSection />
        ) : mode === 'store-unconfigured' ? (
          <View className="rounded-xl border border-border bg-muted p-4">
            <Text variant="label">{t('paywall.iapNotConfigured')}</Text>
            <Text variant="caption">{t('paywall.iapNotConfiguredHint')}</Text>
          </View>
        ) : (
          <StripeSection currentTier={currentTier} />
        )}
      </PageWrapper>
    </>
  )
}

/** "You're on the X plan" confirmation banner (rendered inside the TierGate above). */
function OnPlanBanner({ currentTier }: { currentTier: Tier }) {
  const colors = useColors()
  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4">
      <BadgeCheck color={colors.success} size={20} />
      <Text variant="label" className="flex-1">
        {t('paywall.onPlan', { plan: APP_CONFIG.monetization.tiers[currentTier].label })}
      </Text>
    </View>
  )
}

// ─── WEB / Stripe ──────────────────────────────────────────────────────────────────────────────

/**
 * The whole Stripe surface: live plan cards, the Lifetime card, and restore/manage. Rendered ONLY
 * in paywallMode 'stripe' (web), so the hooks in here never even fetch prices on native.
 */
function StripeSection({ currentTier }: { currentTier: Tier }) {
  const { toast } = useToast()
  const colors = useColors()
  const { data: session } = useSession()
  const { data: summary, refetch } = useSubscription()
  const { data: plans, isLoading, isError, refetch: refetchPlans } = usePlans()
  const [buying, setBuying] = useState<string | null>(null)
  const [managing, setManaging] = useState(false)

  const checkout = async (priceId: string) => {
    if (!session) {
      toast({ title: t('paywall.signInToSubscribe'), variant: 'error' })
      return
    }
    setBuying(priceId)
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

  // Trial chip eligibility: advertised ONLY when config grants a trial AND this org hasn't
  // consumed one (trialEndsAt null = untrialed → full trial; future = live trial → remaining
  // days convert at checkout). The server re-checks regardless (checkoutTrialDays) — this just
  // avoids advertising a trial a checkout won't grant.
  const trialDays = plans?.subscription.trialDays ?? 0
  const trialEligible =
    trialDays > 0 &&
    (!summary?.trialEndsAt || new Date(summary.trialEndsAt).getTime() > Date.now())

  const hasLegacyFallback = Boolean(LEGACY_PRICE_IDS.STANDARD || LEGACY_PRICE_IDS.PREMIUM)

  // Plans pending/failed: the legacy static card keeps an already-shipped app's paywall alive
  // (never blank); without it, pending shows a loading row and an ERROR shows retry — a network
  // failure is NOT "billing isn't configured" (that's the mode:null branch below, MINOR-2).
  if (isLoading || isError) {
    if (hasLegacyFallback) {
      return (
        <LegacyStaticPlans currentTier={currentTier} buying={buying} onCheckout={checkout} colors={colors} />
      )
    }
    if (isLoading) {
      return (
        <Card>
          <CardContent className="gap-2 py-6">
            <Text variant="muted">{t('paywall.loadingPlans')}</Text>
          </CardContent>
        </Card>
      )
    }
    return (
      <View className="gap-3 rounded-xl border border-border bg-muted p-4">
        <Text variant="label">{t('paywall.plansError')}</Text>
        <Button variant="outline" label={t('paywall.retry')} onPress={() => void refetchPlans()} />
      </View>
    )
  }
  if (!plans) return null

  // mode:null = the Worker has no STRIPE_SECRET_KEY — billing genuinely isn't configured.
  // Render the baked config copy with DISABLED CTAs + the honest notice (a legacy client price id
  // can't help here: checkout would 503 against the unconfigured Worker).
  const unconfigured = plans.mode === null

  return (
    <>
      {unconfigured ? (
        <View className="rounded-xl border border-border bg-muted p-4">
          <Text variant="label">{t('paywall.billingNotConfigured')}</Text>
          <Text variant="caption">{t('paywall.notConfiguredWeb')}</Text>
        </View>
      ) : null}

      {plans.tiers.map((plan) => (
        <StripePlanCard
          key={plan.tier}
          plan={plan}
          currentTier={currentTier}
          trialChip={trialEligible && plan.tier !== 'FREE' ? trialDays : null}
          disabled={unconfigured}
          buying={buying}
          onCheckout={checkout}
          colors={colors}
        />
      ))}

      {plans.lifetime ? (
        <LifetimeCard
          lifetime={plans.lifetime}
          buying={buying}
          disabled={unconfigured}
          onCheckout={checkout}
          colors={colors}
        />
      ) : null}

      {/* Manage — portal for Stripe-managed subs; store-managed subs (bought on a device, viewed
          on web) can only be changed in the store's subscription settings. */}
      {summary?.managedBy === 'stripe' ? (
        <View className="gap-2">
          <Button variant="outline" label={t('paywall.manage')} loading={managing} onPress={manage} />
          <Text variant="caption">{t('paywall.restoreHint')}</Text>
        </View>
      ) : summary?.managedBy === 'apple' || summary?.managedBy === 'google' ? (
        <Text variant="caption">{t('paywall.manageStore')}</Text>
      ) : null}
    </>
  )
}

/** One live plan card: Stripe metadata copy → config fallback; frequency chips when the tier
 *  sells more than one billing interval; price = the SELECTED frequency's live amount. */
function StripePlanCard({
  plan,
  currentTier,
  trialChip,
  disabled,
  buying,
  onCheckout,
  colors,
}: {
  plan: PlanTier
  currentTier: Tier
  trialChip: number | null
  disabled: boolean
  buying: string | null
  onCheckout: (priceId: string) => void
  colors: ReturnType<typeof useColors>
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const isCurrent = plan.tier === currentTier
  const isPaid = plan.tier !== 'FREE'
  const fallback = tierFallback(plan.tier)

  // Live copy first (Stripe Product metadata — admin-managed), baked config copy second.
  const label = plan.label ?? APP_CONFIG.monetization.tiers[plan.tier].label
  const features = plan.features.length > 0 ? plan.features : fallback.features

  const selected: PlanPrice | undefined =
    plan.prices.find((p) => p.priceId === selectedId) ?? plan.prices[0]
  const liveAmount = selected ? formatPriceAmount(selected) : null
  const priceLabel = isPaid
    ? (liveAmount ?? fallback.priceLabel)
    : (fallback.priceLabel ?? formatPriceAmount({ unitAmount: 0, currency: 'usd' }))

  return (
    <Card className={isCurrent ? 'border-primary' : undefined}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{label}</CardTitle>
        {isCurrent ? (
          <Badge variant="secondary" label={t('paywall.currentPlan')} />
        ) : trialChip ? (
          <Badge variant="secondary" label={t('paywall.trialChip', { days: trialChip })} />
        ) : null}
      </CardHeader>
      <CardContent className="gap-3">
        <View className="flex-row items-baseline gap-2">
          {priceLabel ? <Text variant="h2">{priceLabel}</Text> : null}
          {selected && liveAmount ? <Text variant="caption">{frequencyLabel(selected)}</Text> : null}
        </View>
        {plan.prices.length > 1 ? (
          <SegmentedControl
            value={selected?.priceId ?? ''}
            onValueChange={setSelectedId}
            options={plan.prices.map((p) => ({ label: frequencyLabel(p), value: p.priceId }))}
          />
        ) : null}
        <PlanFeatures features={features} color={colors.success} />
        {isPaid && !isCurrent ? (
          <Button
            label={t('paywall.getPlan', { plan: label })}
            loading={buying === selected?.priceId}
            // No resolvable price (unconfigured Worker / empty product) = honest disabled state —
            // a dead "Get" button that toasts an error is worse than a visibly disabled one.
            disabled={disabled || !selected || buying !== null}
            onPress={() => selected && onCheckout(selected.priceId)}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

/** The one-time Lifetime card — present only when the Worker has STRIPE_PRICE_LIFETIME set. */
function LifetimeCard({
  lifetime,
  buying,
  disabled,
  onCheckout,
  colors,
}: {
  lifetime: NonNullable<Plans['lifetime']>
  buying: string | null
  disabled: boolean
  onCheckout: (priceId: string) => void
  colors: ReturnType<typeof useColors>
}) {
  const amount = formatPriceAmount(lifetime)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('paywall.lifetimeTitle')}</CardTitle>
        <Badge variant="secondary" label={APP_CONFIG.monetization.tiers[lifetime.tier].label} />
      </CardHeader>
      <CardContent className="gap-3">
        {amount ? <Text variant="h2">{amount}</Text> : null}
        <View className="flex-row items-center gap-2">
          <Check color={colors.success} size={16} />
          <Text variant="body" className="flex-1">
            {t('paywall.lifetimeCard')}
          </Text>
        </View>
        <Button
          label={t('paywall.getPlan', { plan: t('paywall.lifetimeTitle') })}
          loading={buying === lifetime.priceId}
          disabled={disabled || buying !== null}
          onPress={() => onCheckout(lifetime.priceId)}
        />
      </CardContent>
    </Card>
  )
}

/**
 * LEGACY static cards — the pending/failed-fetch fallback for apps still shipping
 * EXPO_PUBLIC_STRIPE_PRICE_* (grandfathered forever, BILLING §5). Copy comes from the baked
 * config; the CTA stays ENABLED (only the plans FETCH failed — the Worker itself may be fine).
 */
function LegacyStaticPlans({
  currentTier,
  buying,
  onCheckout,
  colors,
}: {
  currentTier: Tier
  buying: string | null
  onCheckout: (priceId: string) => void
  colors: ReturnType<typeof useColors>
}) {
  const tiers: Tier[] = ['FREE', 'STANDARD', 'PREMIUM']
  return (
    <>
      {tiers.map((tier) => {
        const isCurrent = tier === currentTier
        const isPaid = tier !== 'FREE'
        const priceId = LEGACY_PRICE_IDS[tier]
        // Paid card only with a configured legacy price AND a sellable tier — a dead "Get" button
        // is worse than no card.
        if (isPaid && (!priceId || !isSellable(tier))) return null
        const fallback = tierFallback(tier)
        return (
          <Card key={tier} className={isCurrent ? 'border-primary' : undefined}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{APP_CONFIG.monetization.tiers[tier].label}</CardTitle>
              {isCurrent ? <Badge variant="secondary" label={t('paywall.currentPlan')} /> : null}
            </CardHeader>
            <CardContent className="gap-3">
              {fallback.priceLabel ? <Text variant="h2">{fallback.priceLabel}</Text> : null}
              <PlanFeatures features={fallback.features} color={colors.success} />
              {isPaid && !isCurrent && priceId ? (
                <Button
                  label={t('paywall.getPlan', { plan: APP_CONFIG.monetization.tiers[tier].label })}
                  loading={buying === priceId}
                  disabled={buying !== null}
                  onPress={() => onCheckout(priceId)}
                />
              ) : null}
            </CardContent>
          </Card>
        )
      })}
    </>
  )
}

// ─── NATIVE / RevenueCat ───────────────────────────────────────────────────────────────────────

/**
 * Store offerings + Restore Purchases. Store price strings ONLY — the /plans Stripe amounts never
 * render here, and (MINOR-3) neither does the Stripe trial chip: a Stripe trial is not a native
 * trial promise. Store INTRO PRICING (RevenueCat offerings carry it in the localized priceString /
 * store metadata) is the only trial truth native may advertise.
 */
function NativeSection() {
  const { toast } = useToast()
  const { data: session } = useSession()
  const { data: summary, refetch } = useSubscription()
  const [buying, setBuying] = useState<string | null>(null)
  const [managing, setManaging] = useState(false)
  const [iapPackages, setIapPackages] = useState<IapPackage[] | null>(null)
  const [iapConfigured, setIapConfigured] = useState(false)

  const userId = session?.user?.id

  // Configure RevenueCat with the Better-Auth user id (so the webhook's app_user_id maps back to
  // this user → their personal org) and load the store offerings.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const cfg = configurePurchases(userId)
    setIapConfigured(cfg.configured)
    if (!cfg.configured) return
    void getOfferings().then((res) => {
      if (cancelled) return
      setIapPackages(res.configured ? res.packages : [])
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const buy = async (pkg: IapPackage) => {
    if (!session) {
      toast({ title: t('paywall.signInToSubscribe'), variant: 'error' })
      return
    }
    setBuying(pkg.identifier)
    try {
      const res = await purchasePackage(pkg)
      if (!res.configured) {
        toast({ title: t('paywall.iapNotConfigured'), description: t('paywall.iapNotConfiguredHint'), variant: 'error' })
        return
      }
      if (res.cancelled) {
        toast({ title: t('paywall.purchaseCanceled') })
        return
      }
      // The store + the RevenueCat webhook are the source of truth; refetch the org summary so the
      // newly-granted tier appears once the server processes the event.
      toast({ title: t('paywall.purchaseSuccess'), variant: 'success' })
      await refetch()
    } catch (e) {
      toast({
        title: t('paywall.purchaseFailed'),
        description: e instanceof Error ? e.message : t('errors.connectionHint'),
        variant: 'error',
      })
    } finally {
      setBuying(null)
    }
  }

  const restore = async () => {
    setManaging(true)
    try {
      const res = await restorePurchases()
      if (!res.configured) {
        toast({ title: t('paywall.restoreFailed'), description: t('paywall.iapNotConfiguredHint'), variant: 'error' })
        return
      }
      toast({
        title: res.tier ? t('paywall.restoreSuccess') : t('paywall.restoreNone'),
        variant: res.tier ? 'success' : undefined,
      })
      await refetch()
    } catch (e) {
      toast({
        title: t('paywall.restoreFailed'),
        description: e instanceof Error ? e.message : t('errors.connectionHint'),
        variant: 'error',
      })
    } finally {
      setManaging(false)
    }
  }

  // Sellable-tier filter (the ONE native change vs the old screen): a single-paid-tier app's
  // store may still carry legacy SKUs for the unsold tier — don't offer them. Packages whose
  // product isn't mapped in IAP_PRODUCT_TIERS keep rendering (tier null — can't judge them, and
  // hiding a store-configured package on a mapping gap would mask the misconfig).
  const packages = iapPackages?.filter((pkg) => pkg.tier === null || isSellable(pkg.tier)) ?? null

  return (
    <>
      <NativePlans packages={packages} configured={iapConfigured} buying={buying} onBuy={buy} />
      {/* Restore Purchases is REQUIRED by Apple on any paywall. Manage = the store's subscription
          settings — NO external/web link (anti-steering). */}
      <View className="gap-2">
        <Button
          variant="outline"
          label={t('paywall.restorePurchases')}
          loading={managing}
          onPress={restore}
        />
        {/* A Stripe-managed sub viewed on device gets the NEUTRAL "managed where purchased" line —
            never a web/portal link (anti-steering). Everything else: store settings. */}
        <Text variant="caption">
          {summary?.managedBy === 'stripe' ? t('paywall.manageExternal') : t('paywall.manageNative')}
        </Text>
      </View>
    </>
  )
}

/** NATIVE plan cards — driven by the store's RevenueCat offerings (already sellable-filtered). */
function NativePlans({
  packages,
  configured,
  buying,
  onBuy,
}: {
  packages: IapPackage[] | null
  configured: boolean
  buying: string | null
  onBuy: (pkg: IapPackage) => void
}) {
  const colors = useColors()
  // Still loading the offerings (configured, but the fetch hasn't resolved).
  if (configured && packages === null) {
    return (
      <Card>
        <CardContent className="gap-2 py-6">
          <Text variant="muted">{t('paywall.loadingPlans')}</Text>
        </CardContent>
      </Card>
    )
  }
  if (!configured || !packages || packages.length === 0) {
    return (
      <View className="rounded-xl border border-border bg-muted p-4">
        <Text variant="label">{t('paywall.iapNotConfigured')}</Text>
        <Text variant="caption">{t('paywall.iapNotConfiguredHint')}</Text>
      </View>
    )
  }
  return (
    <>
      {packages.map((pkg) => (
        <Card key={pkg.identifier}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{pkg.title}</CardTitle>
            {pkg.tier ? (
              <Badge variant="secondary" label={APP_CONFIG.monetization.tiers[pkg.tier].label} />
            ) : null}
          </CardHeader>
          <CardContent className="gap-3">
            <Text variant="h2">{pkg.priceString}</Text>
            {pkg.tier ? (
              <PlanFeatures features={tierFallback(pkg.tier).features} color={colors.success} />
            ) : null}
            <Button
              label={t('paywall.getPlan', { plan: pkg.title })}
              loading={buying === pkg.identifier}
              disabled={buying !== null}
              onPress={() => onBuy(pkg)}
            />
          </CardContent>
        </Card>
      ))}
    </>
  )
}

/** Shared feature checklist row block. */
function PlanFeatures({ features, color }: { features: string[]; color: string }) {
  return (
    <View className="gap-1.5">
      {features.map((feature) => (
        <View key={feature} className="flex-row items-center gap-2">
          <Check color={color} size={16} />
          <Text variant="body" className="flex-1">
            {feature}
          </Text>
        </View>
      ))}
    </View>
  )
}
