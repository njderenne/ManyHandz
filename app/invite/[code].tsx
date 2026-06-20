import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Gift, PartyPopper } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { ApiError } from '@/lib/api/client'
import { authClient, useSession } from '@/lib/auth/client'
import { redeemReferral } from '@/lib/referrals'
import { queryKeys } from '@/lib/query/keys'
import { APP_CONFIG } from '@/lib/config/app'
import { useColors } from '@/lib/config/theme'
import { t } from '@/lib/i18n'

/**
 * Invite landing — where the shared referral link (`${APP_CONFIG.url}/invite/<code>`, built by
 * src/lib/referrals.ts) actually lands. Opens in the browser (web build) or the app via deep
 * link, mirroring accept-invite/[id].tsx.
 *
 * Signed-in: auto-redeems ONCE on mount via POST /api/referrals/redeem, then shows a celebratory
 * card (+credits) or a friendly per-reason error (the Worker returns a machine-readable
 * `data.code` — see worker/routes/referrals.ts).
 *
 * Signed-out: explains the invite and CTAs to sign up / sign in, passing the code along as a
 * `referral` router param. The auth screens (app/(auth)/signup.tsx, login.tsx) read that param
 * and route back here after a successful auth, where the effect below auto-redeems now that a
 * session exists — the full signed-out → auth → credits loop.
 */

type RedeemState =
  | { phase: 'redeeming' }
  | { phase: 'success'; credits: number }
  | { phase: 'error'; reason: string }

/** Map the Worker's machine-readable failure reason out of an ApiError; 'unknown' otherwise. */
function failureReason(e: unknown): string {
  if (e instanceof ApiError && typeof e.data === 'object' && e.data !== null && 'code' in e.data) {
    const reason = (e.data as { code?: unknown }).code
    if (typeof reason === 'string') return reason
  }
  return 'unknown'
}

function errorBody(reason: string): string {
  switch (reason) {
    case 'not_found':
    case 'invalid_code':
      return t('invite.errorNotFound')
    case 'already_redeemed':
      return t('invite.errorAlreadyRedeemed')
    case 'already_redeemed_by_you':
      return t('invite.errorAlreadyRedeemedByYou')
    case 'own_code':
      return t('invite.errorOwnCode')
    case 'no_organization':
      return t('invite.errorNoOrganization', {
        tenant: APP_CONFIG.tenant.singular.toLowerCase(),
      })
    default:
      return t('invite.errorGeneric')
  }
}

export default function InviteScreen() {
  const colors = useColors()
  const params = useLocalSearchParams<{ code?: string }>()
  const code = typeof params.code === 'string' ? params.code : undefined
  const { data: session, isPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const queryClient = useQueryClient()
  const attempted = useRef(false)
  const [state, setState] = useState<RedeemState>({ phase: 'redeeming' })

  const activeOrgId = activeOrg?.id
  const attempt = useCallback(async () => {
    if (!code) {
      setState({ phase: 'error', reason: 'not_found' })
      return
    }
    setState({ phase: 'redeeming' })
    try {
      const res = await redeemReferral(code)
      setState({ phase: 'success', credits: res.creditsAwarded })
      // Fresh credits just landed — refetch the balance/history the rewards UI shows.
      if (activeOrgId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organizations.creditBalance(activeOrgId),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organizations.creditHistory(activeOrgId),
        })
      }
    } catch (e) {
      setState({ phase: 'error', reason: failureReason(e) })
    }
  }, [code, activeOrgId, queryClient])

  // Auto-redeem exactly once per mount, as soon as the session resolves to signed-in. Manual
  // retries (the buttons below) call attempt() directly and bypass this guard. The effect
  // depends ONLY on session resolution: attempt's identity shifts whenever code/activeOrgId
  // settle, and re-running on those would risk stale-closure double-fires — so the latest
  // attempt is read through a ref instead of the dependency array.
  const attemptRef = useRef(attempt)
  attemptRef.current = attempt
  useEffect(() => {
    if (isPending || !session || attempted.current) return
    attempted.current = true
    void attemptRef.current()
  }, [isPending, session])

  return (
    <PageWrapper className="gap-6 pb-24">
      <Stack.Screen options={{ headerShown: true, title: t('invite.screenTitle') }} />
      <View className="items-center gap-2 pt-8">
        <View className="size-14 items-center justify-center rounded-xl bg-muted">
          <Gift color={colors.brand} size={28} />
        </View>
        <Text variant="h2">{t('invite.heroTitle')}</Text>
        <Text variant="muted" className="text-center">
          {t('invite.heroSubtitle', { app: APP_CONFIG.name })}
        </Text>
      </View>

      {isPending ? (
        <View className="items-center py-8">
          <Spinner />
        </View>
      ) : !session ? (
        <SignedOutCard code={code} />
      ) : state.phase === 'redeeming' ? (
        <View className="items-center gap-3 py-8">
          <Spinner />
          <Text variant="muted">{t('invite.redeeming')}</Text>
        </View>
      ) : state.phase === 'success' ? (
        <Card>
          <CardContent className="items-center gap-3 py-6">
            <PartyPopper color={colors.success} size={36} />
            <Text variant="h3">{t('invite.successTitle')}</Text>
            <Text variant="h1" style={{ color: colors.success }}>
              +{state.credits}
            </Text>
            <Text variant="muted" className="text-center">
              {t('invite.successBody', { credits: state.credits })}
            </Text>
            <Button
              className="self-stretch"
              label={t('invite.goHome')}
              onPress={() => router.replace('/')}
            />
          </CardContent>
        </Card>
      ) : (
        <ErrorCard reason={state.reason} onRetry={attempt} />
      )}
    </PageWrapper>
  )
}

/** Sign up / sign in CTAs, threading the code through as a `referral` param (see header note). */
function SignedOutCard({ code }: { code?: string }) {
  const referralParams = code ? { referral: code } : undefined
  return (
    <Card>
      <CardContent className="gap-3">
        <Text variant="muted">
          {t('invite.signedOutBody', { app: APP_CONFIG.name, code: code ?? '' })}
        </Text>
        <Text variant="muted">{t('invite.signedOutHint')}</Text>
        <Button
          label={t('invite.signUp')}
          onPress={() => router.push({ pathname: '/signup', params: referralParams })}
        />
        <Button
          variant="outline"
          label={t('invite.signIn')}
          onPress={() => router.push({ pathname: '/login', params: referralParams })}
        />
      </CardContent>
    </Card>
  )
}

function ErrorCard({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  const colors = useColors()
  return (
    <Card>
      <CardContent className="gap-3">
        <View className="flex-row items-center gap-2">
          <CircleAlert color={colors.destructive} size={20} />
          <Text variant="h3">{t('invite.errorTitle')}</Text>
        </View>
        <Text variant="muted">{errorBody(reason)}</Text>
        {reason === 'no_organization' ? (
          // The code is still open server-side — set up an org, come back, try again.
          <>
            <Button
              label={t('invite.setupOrganization', { tenant: APP_CONFIG.tenant.singular })}
              onPress={() => router.push('/team')}
            />
            <Button variant="outline" label={t('invite.retry')} onPress={onRetry} />
          </>
        ) : reason === 'unknown' ? (
          // Transient (network / 5xx) — retrying is the likely fix.
          <>
            <Button label={t('invite.retry')} onPress={onRetry} />
            <Button
              variant="outline"
              label={t('invite.goHome')}
              onPress={() => router.replace('/')}
            />
          </>
        ) : (
          // Terminal states (used / own code / already claimed) — nothing to retry.
          <Button label={t('invite.goHome')} onPress={() => router.replace('/')} />
        )}
      </CardContent>
    </Card>
  )
}
