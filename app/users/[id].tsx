import { useState } from 'react'
import { View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { Flag, UserCheck, UserRound, UserX } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Spinner } from '@/components/ui/spinner'
import { ReportSheet, useBlockUser } from '@/components/moderation/report-block'
import { useBlocks } from '@/lib/query/hooks/useModeration'
import { usePublicProfile } from '@/lib/query/hooks/usePublicProfile'
import { ApiError } from '@/lib/api/client'
import { authClient, useSession } from '@/lib/auth/client'
import { t } from '@/lib/i18n'

/**
 * Public user profile — THE worked example of mounting the moderation seam on a content surface:
 * <ReportSheet> opened from a Report button, useBlockUser's confirm-dialog flow behind a Block
 * button, and the blocked state rendered inline with an Unblock action (useBlocks). Every screen
 * that shows another user's content copies this wiring (App Store Guideline 1.2).
 *
 * Reached by id (e.g. from a chat header or member list): router.push(`/users/${userId}`).
 * Signed-out visitors get a sign-in prompt; a deleted user is a "not found" state, not an error.
 */

/** 'YYYY-MM' (the Worker's month-granularity privacy contract) → a localized "June 2026". */
function memberSinceLabel(memberSince: string): string {
  const [year, month] = memberSince.split('-').map(Number)
  if (!year || !month) return memberSince
  // Local-time construction on purpose: a UTC midnight here would render as the PREVIOUS month
  // for users west of Greenwich.
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
  })
}

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const userId = typeof id === 'string' ? id : ''

  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''

  const profileQuery = usePublicProfile(userId)
  const { isBlocked, unblock, isLoading: blocksLoading } = useBlocks(orgId)
  const { confirmBlock, blockDialog } = useBlockUser(orgId)
  const [reportOpen, setReportOpen] = useState(false)

  const profile = profileQuery.data
  const isSelf = Boolean(session && profile && session.user.id === profile.id)

  /**
   * Blocked state, two sources: the LIVE block list once it has loaded (it updates optimistically
   * on unblock and re-syncs after a confirmed block), falling back to the profile's fetch-time
   * `blocked` snapshot until then. This is why no manual invalidation of the profile key is
   * needed after block/unblock — the derived value tracks the moderation cache.
   */
  const blocked = orgId && !blocksLoading ? isBlocked(userId) : (profile?.blocked ?? false)

  // A deleted/unknown user is product state, not a failure — special-case the 404 into its own
  // empty state instead of AsyncBoundary's generic retry (retrying a 404 just repeats it).
  const notFound = profileQuery.error instanceof ApiError && profileQuery.error.status === 404

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('publicProfile.title') }} />
      <PageWrapper className="gap-6 pb-24" onRefresh={() => profileQuery.refetch()}>
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={UserRound}
            title={t('publicProfile.signedOutTitle')}
            description={t('publicProfile.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : notFound ? (
          <EmptyState
            icon={UserX}
            title={t('publicProfile.notFoundTitle')}
            description={t('publicProfile.notFoundBody')}
            action={
              <Button
                variant="outline"
                label={t('common.back')}
                // Deep links (stale profile link) have no history — fall back home.
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              />
            }
          />
        ) : (
          <AsyncBoundary query={profileQuery}>
            {profile ? (
              <>
                <View className="items-center gap-3 py-6">
                  <Avatar uri={profile.image ?? undefined} name={profile.name} size={96} />
                  <Text variant="h2">{profile.name}</Text>
                  <Text variant="muted">
                    {t('publicProfile.memberSince', { date: memberSinceLabel(profile.memberSince) })}
                  </Text>
                </View>

                {isSelf ? (
                  <Text variant="muted" className="text-center">
                    {t('publicProfile.thisIsYou')}
                  </Text>
                ) : blocked ? (
                  <Card>
                    <CardContent className="items-center gap-3">
                      <Text variant="h3">{t('publicProfile.blockedTitle')}</Text>
                      <Text variant="muted" className="text-center">
                        {t('publicProfile.blockedBody')}
                      </Text>
                      {/* Optimistic with rollback (useBlocks.unblock) — the blocked card flips
                          instantly and flips back if the server rejects, so no toast is needed. */}
                      <Button
                        variant="outline"
                        icon={UserCheck}
                        label={t('publicProfile.unblock')}
                        onPress={() => unblock(profile.id)}
                      />
                    </CardContent>
                  </Card>
                ) : orgId ? (
                  // The moderation seam: both actions need the active org (the report lands in its
                  // moderation queue; requireOrg gates the endpoints) — no org, no actions.
                  <View className="flex-row justify-center gap-3">
                    <Button
                      variant="outline"
                      icon={Flag}
                      label={t('publicProfile.report')}
                      onPress={() => setReportOpen(true)}
                    />
                    <Button
                      variant="outline"
                      icon={UserX}
                      label={t('publicProfile.block')}
                      onPress={() => confirmBlock(profile.id, profile.name)}
                    />
                  </View>
                ) : null}
              </>
            ) : null}
          </AsyncBoundary>
        )}

        {/* Mounted once at the screen root, per report-block.tsx's contract: the sheet is
            re-pointed via props (here there's a single target — the profile's user), and
            blockDialog is the element returned by useBlockUser. */}
        {profile && orgId ? (
          <ReportSheet
            visible={reportOpen}
            onClose={() => setReportOpen(false)}
            orgId={orgId}
            entityType="user"
            entityId={profile.id}
            reportedUserId={profile.id}
          />
        ) : null}
        {blockDialog}
      </PageWrapper>
    </>
  )
}
