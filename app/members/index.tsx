import { View, Pressable, Share } from 'react-native'
import { router, Stack } from 'expo-router'
import { Users, Share2, Plane } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Section } from '@/components/gallery/kit'
import { QRCode } from '@/components/native/qr-code'
import { useColors } from '@/lib/config/theme'
import { accentHex } from '@/lib/manyhandz/accents'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHouseholdMembers, type HouseholdMember } from '@/lib/query/hooks/useHousehold'

/**
 * Members (`/members`) — the household roster. A mode-aware grid of member cards (accent-ringed
 * avatar, role badge, and level/points/streak when the mode is gamified, plus an Away badge), and
 * an Invite card surfacing the household invite code + a scannable QR. Tapping a card opens the
 * member profile at /members/[id]. Reads useHouseholdMembers; gates the gamification row on
 * features.gamification (hidden in roommate/office) — never on a raw mode string.
 */

/** Friendly role label for the badge (the stored householdRole key, title-cased). */
function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

/** Role pill tone — admins (parent) read as the primary badge, everyone else secondary. */
function roleVariant(role: string): 'default' | 'secondary' {
  return role === 'parent' || role === 'manager' ? 'default' : 'secondary'
}

/** True while the member is on away/vacation (away_until is today or in the future). */
function isAway(member: HouseholdMember): boolean {
  if (!member.awayUntil) return false
  const today = new Date().toISOString().slice(0, 10)
  return member.awayUntil >= today
}

/** One tappable member card with an accent-ringed avatar + optional gamification stats. */
function MemberCard({ member, gamified }: { member: HouseholdMember; gamified: boolean }) {
  const ring = accentHex(member.favoriteColor)
  const away = isAway(member)
  return (
    <Pressable
      onPress={() => router.push(`/members/${member.memberId}`)}
      accessibilityRole="button"
      accessibilityLabel={member.displayName}
      className="flex-1 active:opacity-80"
      style={{ minWidth: 150 }}
    >
      <Card>
        <CardContent className="items-center gap-2 p-4">
          <View className="rounded-full p-0.5" style={{ borderWidth: 2, borderColor: ring }}>
            <Avatar uri={member.avatarUrl ?? undefined} name={member.displayName} size={56} />
          </View>
          <Text variant="label" numberOfLines={1} className="text-center">
            {member.displayName}
          </Text>
          <View className="flex-row flex-wrap items-center justify-center gap-1">
            <Badge variant={roleVariant(member.householdRole)} label={roleLabel(member.householdRole)} />
            {away ? <Badge variant="warning" label="Away" /> : null}
          </View>
          {gamified ? (
            <View className="flex-row items-center gap-3">
              <Text variant="caption">Lv {member.level}</Text>
              <Text variant="caption">{member.pointsBalance} pts</Text>
              {member.currentStreak > 0 ? (
                <Text variant="caption">{member.currentStreak}d streak</Text>
              ) : null}
            </View>
          ) : (
            <Text variant="caption">{member.pointsBalance} pts</Text>
          )}
        </CardContent>
      </Card>
    </Pressable>
  )
}

/** Invite card — the household invite code, a shareable hint, and a scannable QR. */
function InviteCard({ code, householdName }: { code: string; householdName: string }) {
  const colors = useColors()

  // Open the native share sheet (the established invite pattern — see app/household-settings.tsx).
  // Best-effort: dismissing the sheet rejects, which we swallow rather than surface as an error.
  const onShare = async () => {
    try {
      await Share.share({ message: `Join ${householdName} on ManyHandz with invite code ${code}.` })
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  }

  return (
    <Card>
      <CardContent className="gap-4">
        <View className="flex-row items-start gap-3">
          <View className="size-10 items-center justify-center rounded-xl bg-brand-500/10">
            <Users color={colors.brand} size={22} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text variant="label">Invite someone</Text>
            <Text variant="muted">Share this code — they enter it on the Join screen. Long-press to copy.</Text>
          </View>
        </View>

        <View className="items-center gap-3 rounded-lg border border-border bg-background p-4">
          <Text variant="caption" className="uppercase tracking-wider">
            Invite code
          </Text>
          <Text variant="h2" className="tracking-widest" selectable>
            {code}
          </Text>
          <QRCode value={code} size={160} />
        </View>

        <Button icon={Share2} label="Share invite" onPress={onShare} />
      </CardContent>
    </Card>
  )
}

export default function MembersScreen() {
  const { orgId, ready, isLoading, features, household } = useHouseholdMode()
  const membersQuery = useHouseholdMembers(orgId ?? '')
  const gamified = features?.gamification ?? false

  const members = membersQuery.data ?? []
  // Pair members into rows of two so the grid reads as a responsive 2-up on phones.
  const rows: HouseholdMember[][] = []
  for (let i = 0; i < members.length; i += 2) rows.push(members.slice(i, i + 2))

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Members' }} />
      <PageWrapper className="gap-6 pb-24" onRefresh={() => membersQuery.refetch()}>
        {!ready && isLoading ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !orgId ? (
          <EmptyState
            icon={Users}
            title="No household yet"
            description="Create or join a household to see its members."
            action={<Button label="Get started" onPress={() => router.push('/onboarding')} />}
          />
        ) : (
          <>
            <Section title="Household">
              {membersQuery.isLoading ? (
                <View className="items-center py-12">
                  <Spinner />
                </View>
              ) : membersQuery.isError ? (
                <EmptyState
                  icon={Users}
                  title="Couldn't load members"
                  description="Pull to refresh, or try again in a moment."
                  action={<Button variant="outline" label="Retry" onPress={() => membersQuery.refetch()} />}
                />
              ) : members.length === 0 ? (
                <EmptyState
                  icon={Plane}
                  title="No members yet"
                  description="Invite people with the code below to start sharing chores."
                />
              ) : (
                <View className="gap-3">
                  {rows.map((row, idx) => (
                    <View key={idx} className="flex-row gap-3">
                      {row.map((m) => (
                        <MemberCard key={m.memberId} member={m} gamified={gamified} />
                      ))}
                      {row.length === 1 ? <View className="flex-1" style={{ minWidth: 150 }} /> : null}
                    </View>
                  ))}
                </View>
              )}
            </Section>

            <Section title="Invite">
              {household?.inviteCode ? (
                <InviteCard code={household.inviteCode} householdName={household.name} />
              ) : (
                <EmptyState
                  icon={Users}
                  title="Invite code unavailable"
                  description="Generate an invite code from Household settings to add members."
                />
              )}
            </Section>
          </>
        )}
      </PageWrapper>
    </>
  )
}
