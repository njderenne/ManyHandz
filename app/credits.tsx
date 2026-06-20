import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { ArrowDownRight, ArrowUpRight, Coins } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { List } from '@/components/ui/list'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Spinner } from '@/components/ui/spinner'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { formatCredits } from '@/components/engagement/credit-balance'
import { useColors } from '@/lib/config/theme'
import { authClient, useSession } from '@/lib/auth/client'
import { useCreditBalance, useCreditHistory } from '@/lib/query/hooks/useCredits'
import { t } from '@/lib/i18n'
import type { CreditLedgerEntry } from '@/lib/db/schema'

/**
 * Credits — balance hero plus the caller's transaction history (the read surface over
 * worker/routes/credits.ts; all awarding/spending happens server-side in worker/credits.ts).
 * Cursor-paginated list with a load-more affordance, signed earn/spend rows, pull-to-refresh,
 * and a sign-in prompt for signed-out visitors — same conventions as app/notifications.tsx.
 */

/**
 * Compact feed timestamp — reuses the generic relative-time catalog entries that
 * notifications.tsx established ("now" → "{m}m" → "{h}h" → "{d}d" → locale date).
 */
function timeAgo(value: CreditLedgerEntry['createdAt']): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) return t('notifications.timeNow')
  if (minutes < 60) return t('notifications.timeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('notifications.timeHours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('notifications.timeDays', { count: days })
  return date.toLocaleDateString()
}

/** 'reward_points' → 'reward points' — kind vocab is per-app, so display it humanized, not mapped. */
function kindLabel(kind: string): string {
  return kind.replace(/[_-]+/g, ' ')
}

/** One ledger row: direction icon, reason (kind + relative date below), signed colored amount. */
function LedgerRow({ item }: { item: CreditLedgerEntry }) {
  const colors = useColors()
  const earned = item.delta >= 0
  const Icon = earned ? ArrowUpRight : ArrowDownRight
  const amount = `${earned ? '+' : '−'}${formatCredits(Math.abs(item.delta))}`
  const title =
    item.reason?.trim() || (earned ? t('credits.earnedFallback') : t('credits.spentFallback'))
  return (
    <View
      accessibilityLabel={`${title}, ${amount}`}
      className="flex-row items-center gap-3 border-b border-border px-4 py-3.5"
    >
      <View className="size-9 items-center justify-center rounded-full bg-accent">
        <Icon size={18} color={earned ? colors.success : colors.destructive} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="label" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {kindLabel(item.kind)} · {timeAgo(item.createdAt)}
        </Text>
      </View>
      {/* Signed + colored twice over (sign character AND token) — color alone isn't accessible. */}
      <Text variant="label" className={earned ? 'text-success' : 'text-destructive'}>
        {amount}
      </Text>
    </View>
  )
}

export default function CreditsScreen() {
  const colors = useColors()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''

  const balanceQuery = useCreditBalance(orgId)
  const historyQuery = useCreditHistory(orgId)
  const rows = historyQuery.data?.pages.flat() ?? []

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('credits.title') }} />
      <PageWrapper
        className="gap-6 pb-24"
        onRefresh={() => Promise.all([balanceQuery.refetch(), historyQuery.refetch()])}
      >
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={Coins}
            title={t('credits.signedOutTitle')}
            description={t('credits.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : (
          <>
            {/* Balance hero — counts up via AnimatedNumber; 0 while loading, eases in on arrival. */}
            <Card>
              <CardContent className="items-center gap-2 py-8">
                <View className="size-12 items-center justify-center rounded-full bg-accent">
                  <Coins size={24} color={colors.warning} />
                </View>
                {balanceQuery.isError ? (
                  // Don't show an authoritative-looking 0 when the balance fetch failed —
                  // pull-to-refresh retries both queries.
                  <>
                    <Text variant="h1" accessibilityLabel={t('credits.balanceUnavailable')}>
                      —
                    </Text>
                    <Text variant="muted">{t('credits.balanceUnavailable')}</Text>
                  </>
                ) : (
                  <>
                    <AnimatedNumber
                      value={balanceQuery.data ?? 0}
                      variant="h1"
                      format={formatCredits}
                      accessibilityLabel={t('credits.balanceA11y', {
                        count: formatCredits(balanceQuery.data ?? 0),
                      })}
                    />
                    <Text variant="muted">{t('credits.balanceLabel')}</Text>
                  </>
                )}
              </CardContent>
            </Card>

            <View className="gap-3">
              <Text variant="h3">{t('credits.historyTitle')}</Text>
              <AsyncBoundary
                query={historyQuery}
                isEmpty={rows.length === 0}
                empty={
                  <EmptyState
                    icon={Coins}
                    title={t('credits.emptyTitle')}
                    description={t('credits.emptyBody')}
                  />
                }
              >
                <List>
                  {rows.map((entry) => (
                    <LedgerRow key={entry.id} item={entry} />
                  ))}
                </List>
                {historyQuery.hasNextPage ? (
                  <Button
                    variant="outline"
                    label={t('credits.loadMore')}
                    loading={historyQuery.isFetchingNextPage}
                    onPress={() => historyQuery.fetchNextPage()}
                    className="self-center"
                  />
                ) : null}
              </AsyncBoundary>
            </View>
          </>
        )}
      </PageWrapper>
    </>
  )
}
