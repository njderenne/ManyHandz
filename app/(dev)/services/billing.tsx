import { useState } from 'react'
import { Platform, View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Section, Row } from '@/components/gallery/kit'
import { useAsyncAction, Result } from '@/components/gallery/async-action'
import { startCheckout } from '@/lib/billing'
import {
  useSubscription,
  usePlans,
  frequencyLabel,
  formatPriceAmount,
} from '@/lib/billing/useSubscription'
import { SELLABLE_TIERS, REQUIRE_SUBSCRIPTION, LIFETIME_TIER, TRIAL_ON_ORG_CREATE } from '@/lib/config/monetization'

/**
 * Billing dev screen — the live view of the whole billing chassis: raw /plans JSON, the effective
 * summary the gates read, web checkout test buttons, and the degradation state at a glance.
 * Dev gallery only (never shipped) — i18n-exempt, English literals are fine here.
 */

const isWeb = Platform.OS === 'web'

/** Degradation-state banner: what the /plans payload says about the Worker's Stripe config. */
function DegradationState() {
  const { data: plans, isLoading, isError } = usePlans()
  if (isLoading) return <Text variant="muted">Loading /api/billing/plans…</Text>
  if (isError) return <Text variant="caption" className="text-destructive">plans fetch FAILED (network/Worker down) — the paywall falls back to legacy EXPO_PUBLIC price cards or a retry state.</Text>
  if (!plans) return null
  return (
    <View className="gap-2">
      <Row label="Stripe mode">
        <Badge
          variant={plans.mode ? 'secondary' : 'destructive'}
          label={plans.mode ?? 'not configured'}
        />
      </Row>
      <Row label="Sellable tiers">
        <Text variant="caption">{plans.sellableTiers.join(' · ')}</Text>
      </Row>
      <Row label="Lifetime SKU">
        <Text variant="caption">{plans.lifetime ? `${plans.lifetime.priceId} → ${plans.lifetime.tier}` : 'dormant (STRIPE_PRICE_LIFETIME unset)'}</Text>
      </Row>
      <Row label="Trial">
        <Text variant="caption">
          {plans.subscription.trialDays ?? 0} days → {plans.subscription.trialTier} (onOrgCreate: {TRIAL_ON_ORG_CREATE})
        </Text>
      </Row>
      <Row label="Hard wall">
        <Text variant="caption">{REQUIRE_SUBSCRIPTION ? 'ON (requireSubscription)' : 'off (freemium)'}</Text>
      </Row>
      <Row label="Lifetime grants">
        <Text variant="caption">{LIFETIME_TIER} (config)</Text>
      </Row>
      {plans.mode === null ? (
        <Text variant="caption">
          STRIPE_SECRET_KEY unset — /plans serves empty shells, checkout/portal 503
          billing_not_configured, paywall renders config fallback copy with disabled CTAs.
        </Text>
      ) : null}
    </View>
  )
}

/** The effective summary — what every client gate (useHasTier / TierGate / the wall) reads. */
function SummaryView() {
  const { data: summary, isLoading, refetch } = useSubscription()
  if (isLoading) return <Text variant="muted">Loading /api/billing/summary…</Text>
  if (!summary) return <Text variant="muted">No summary (signed out / no active org).</Text>
  return (
    <View className="gap-2">
      <Row label="Effective tier">
        <Badge variant="secondary" label={summary.tier} />
      </Row>
      <Row label="Status">
        <Text variant="caption">{summary.status ?? 'null'}</Text>
      </Row>
      <Row label="Trial ends">
        <Text variant="caption">{summary.trialEndsAt ?? 'null'}</Text>
      </Row>
      <Row label="Period end">
        <Text variant="caption">{summary.currentPeriodEnd ?? 'null'}</Text>
      </Row>
      <Row label="Managed by">
        <Text variant="caption">{summary.managedBy ?? 'null (no live subscription row)'}</Text>
      </Row>
      <Button variant="outline" size="sm" label="Refetch" onPress={() => void refetch()} />
    </View>
  )
}

/** Web checkout testers — one button per sellable price (test-mode Stripe: card 4242…). */
function CheckoutTesters() {
  const { data: plans } = usePlans()
  const { state, run } = useAsyncAction()
  if (!isWeb) {
    return (
      <Text variant="muted">
        Checkout test buttons are web-only — native buys via RevenueCat IAP (anti-steering).
      </Text>
    )
  }
  const priced = (plans?.tiers ?? []).filter((t) => t.prices.length > 0)
  const lifetime = plans?.lifetime
  if (!priced.length && !lifetime) {
    return <Text variant="muted">No sellable prices resolved — set STRIPE_PRODUCT_* (or legacy STRIPE_PRICE_*) on the Worker.</Text>
  }
  return (
    <View className="gap-2">
      {priced.flatMap((tier) =>
        tier.prices.map((p) => (
          <Button
            key={p.priceId}
            variant="outline"
            size="sm"
            label={`${tier.tier} · ${frequencyLabel(p)} · ${formatPriceAmount(p) ?? '?'} (${p.priceId.slice(0, 14)}…)`}
            onPress={() => run(() => startCheckout(p.priceId).then(() => 'Checkout window opened'))}
          />
        )),
      )}
      {lifetime ? (
        <Button
          variant="outline"
          size="sm"
          label={`LIFETIME · ${formatPriceAmount(lifetime) ?? '?'} → ${lifetime.tier}`}
          onPress={() => run(() => startCheckout(lifetime.priceId).then(() => 'Checkout window opened'))}
        />
      ) : null}
      <Result state={state} />
    </View>
  )
}

/** Raw /plans payload — the exact contract Criterial + the paywall consume. */
function PlansJson() {
  const { data: plans, refetch } = usePlans()
  const [shown, setShown] = useState(false)
  return (
    <View className="gap-2">
      <View className="flex-row gap-2">
        <Button variant="outline" size="sm" label={shown ? 'Hide JSON' : 'Show JSON'} onPress={() => setShown((s) => !s)} />
        <Button variant="outline" size="sm" label="Refetch" onPress={() => void refetch()} />
      </View>
      {shown ? (
        <Text variant="caption" className="font-mono">
          {JSON.stringify(plans ?? null, null, 2)}
        </Text>
      ) : null}
    </View>
  )
}

export default function BillingScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Billing</Text>
      <Section
        title="Degradation state"
        description="Honest-degradation matrix at a glance (BILLING_SPEC §10) — what's configured, what's dormant"
      >
        <DegradationState />
      </Section>
      <Section
        title="Effective summary"
        description="GET /api/billing/summary — the effective tier every client gate reads"
      >
        <SummaryView />
      </Section>
      <Section
        title="Checkout testers"
        description={`Web Stripe checkout per sellable price. Config sells: ${SELLABLE_TIERS.join(' · ')}`}
      >
        <CheckoutTesters />
      </Section>
      <Section title="Raw /plans payload" description="The public pricing contract (paywall + Criterial)">
        <PlansJson />
      </Section>
    </PageWrapper>
  )
}
