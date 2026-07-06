import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { Gift, Lock, Crown, Medal, Flame, Sparkles } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Tabs } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { List, ListItem } from '@/components/ui/list'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Spinner } from '@/components/ui/spinner'
import { TierGate } from '@/components/ui/tier-gate'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/auth/client'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHouseholdMembers, type HouseholdMember } from '@/lib/query/hooks/useHousehold'
import {
  useRewards,
  useRewardRedemptions,
  useRedeemReward,
  useApproveRedemption,
  useRejectRedemption,
  type RedemptionWithReward,
} from '@/lib/query/hooks/useRewards'
import { useBadges } from '@/lib/query/hooks/useBadges'
import { useAchievements } from '@/lib/query/hooks/useAchievements'
import { ACHIEVEMENT_LIST } from '@/lib/achievements'
import { iconFor } from '@/lib/manyhandz/icons'
import { accentHex } from '@/lib/manyhandz/accents'
import type { Reward } from '@/lib/db/schema'
import { t } from '@/lib/i18n'

/**
 * Rewards — the family-mode engagement screen (MANYHANDZ_SPEC §10). FAMILY ONLY: when the active
 * household's mode doesn't enable the rewards feature (roommate/office), we render a friendly
 * EmptyState rather than the store. Three in-page tabs — Rewards (a point-priced catalog kids
 * redeem against their balance), Achievements (the code-defined catalog + the household's badge
 * library), and an optional Leaderboard (members ranked by XP, only when the feature is on AND the
 * household has it visible). Parents (can('completion:approve')) also get a pending-redemptions
 * approve/reject queue above the catalog. Every write affordance is gated by can(); the Worker
 * enforces — this only mirrors it for UI.
 */

type TabKey = 'rewards' | 'achievements' | 'leaderboard'

export default function RewardsScreen() {
  const { orgId, ready, isLoading, features, household, can } = useHouseholdMode()
  const { data: session } = useSession()

  const showLeaderboard = Boolean(features?.leaderboard && household?.leaderboardVisible)
  const [tab, setTab] = useState<TabKey>('rewards')

  if (isLoading || !ready) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Rewards' }} />
        <PageWrapper>
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        </PageWrapper>
      </>
    )
  }

  // FAMILY-ONLY gate — rewards is a family-mode feature; other modes get a friendly explainer.
  if (!features?.rewards) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Rewards' }} />
        <PageWrapper>
          <EmptyState
            icon={Gift}
            title="Rewards are a family feature"
            description="Switch your household to Family mode to let members earn points and redeem them for rewards."
          />
        </PageWrapper>
      </>
    )
  }

  const tabs = [
    { label: 'Rewards', value: 'rewards' as const },
    { label: 'Achievements', value: 'achievements' as const },
    ...(showLeaderboard ? [{ label: 'Leaderboard', value: 'leaderboard' as const }] : []),
  ]

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Rewards' }} />
      <PageWrapper className="pb-24">
        <StatsHeader orgId={orgId ?? ''} userId={session?.user.id} />

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} tabs={tabs} />

        {tab === 'rewards' ? (
          // Paid (Premium): the rewards/allowance/points economy. TierGate only decorates — the
          // Worker (worker/routes/rewards.ts) is the real gate. Achievements/Leaderboard stay free.
          <TierGate min="STANDARD">
            <RewardsTab orgId={orgId ?? ''} userId={session?.user.id} canRedeem={can('reward:redeem')} canManage={can('reward:create')} canApprove={can('completion:approve')} />
          </TierGate>
        ) : tab === 'achievements' ? (
          <AchievementsTab orgId={orgId ?? ''} />
        ) : (
          <LeaderboardTab orgId={orgId ?? ''} userId={session?.user.id} />
        )}
      </PageWrapper>
    </>
  )
}

/** Resolve the caller's own member row (by matching the session user id) — drives the points header + redeem affordances. */
function useMe(orgId: string, userId: string | undefined) {
  const query = useHouseholdMembers(orgId)
  const me = useMemo(
    () => (query.data ?? []).find((m) => m.userId && m.userId === userId),
    [query.data, userId],
  )
  return { ...query, me }
}

/** Points / level / streak banner for the current member. */
function StatsHeader({ orgId, userId }: { orgId: string; userId: string | undefined }) {
  const colors = useColors()
  const { me, isLoading } = useMe(orgId, userId)
  if (isLoading || !me) return null
  return (
    <Card>
      <CardContent className="gap-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <View className="size-10 items-center justify-center rounded-full bg-brand-500/10">
              <Sparkles size={20} color={colors.brand} />
            </View>
            <View>
              <Text variant="muted">Your balance</Text>
              <Text variant="h2">{me.pointsBalance} pts</Text>
            </View>
          </View>
          <View className="items-end gap-1">
            <Badge variant="secondary" label={`Lv ${me.level} · ${me.title}`} />
            <View className="flex-row items-center gap-1">
              <Flame size={14} color={colors.warning} />
              <Text variant="caption">{me.currentStreak}-day streak</Text>
            </View>
          </View>
        </View>
        <View className="gap-1">
          <Text variant="caption">{me.totalXp} XP</Text>
          <Progress value={me.level > 0 ? (me.totalXp % 100) : 0} />
        </View>
      </CardContent>
    </Card>
  )
}

/** Rewards tab — pending approvals (parents) + the redeemable catalog. */
function RewardsTab({
  orgId,
  userId,
  canRedeem,
  canManage,
  canApprove,
}: {
  orgId: string
  userId: string | undefined
  canRedeem: boolean
  canManage: boolean
  canApprove: boolean
}) {
  const { toast } = useToast()
  const { me } = useMe(orgId, userId)
  const rewards = useRewards(orgId)
  const redeem = useRedeemReward(orgId)
  const balance = me?.pointsBalance ?? 0
  const active = (rewards.data ?? []).filter((r) => r.isActive)

  const onRedeem = (reward: Reward) => {
    redeem.mutate(reward.id, {
      onSuccess: () => toast({ title: 'Redeemed!', description: `${reward.name} is pending approval.`, variant: 'success' }),
      onError: (e) => toast({ title: "Couldn't redeem", description: (e as Error).message, variant: 'error' }),
    })
  }

  return (
    <View className="gap-6">
      {canApprove ? <PendingRedemptions orgId={orgId} /> : null}

      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text variant="h3">Rewards store</Text>
          {canManage ? <Badge variant="outline" label="You manage these" /> : null}
        </View>
        <AsyncBoundary
          query={rewards}
          isEmpty={active.length === 0}
          empty={
            <Card>
              <EmptyState
                icon={Gift}
                title="No rewards yet"
                description={
                  canManage
                    ? 'Add rewards your household can redeem points for, like screen time or a treat.'
                    : 'Your household hasn’t set up any rewards to redeem yet.'
                }
              />
            </Card>
          }
        >
          <View className="flex-row flex-wrap justify-between">
            {active.map((reward) => (
              <RewardCard
                key={reward.id}
                reward={reward}
                balance={balance}
                canRedeem={canRedeem}
                pending={redeem.isPending}
                onRedeem={() => onRedeem(reward)}
              />
            ))}
          </View>
        </AsyncBoundary>
      </View>
    </View>
  )
}

/** A single point-priced reward; Redeem greys out when the member can't afford it (or lacks the perm). */
function RewardCard({
  reward,
  balance,
  canRedeem,
  pending,
  onRedeem,
}: {
  reward: Reward
  balance: number
  canRedeem: boolean
  pending: boolean
  onRedeem: () => void
}) {
  const colors = useColors()
  const Icon = iconFor(reward.icon)
  const affordable = balance >= reward.pointsCost
  return (
    <Card className="mb-3 w-[48%]">
      <CardContent className="items-center gap-2">
        <View className="size-12 items-center justify-center rounded-full bg-brand-500/10">
          <Icon size={24} color={colors.brand} />
        </View>
        <Text variant="label" numberOfLines={1} className="text-center">
          {reward.name}
        </Text>
        {reward.description ? (
          <Text variant="caption" numberOfLines={2} className="text-center">
            {reward.description}
          </Text>
        ) : null}
        <Badge variant={affordable ? 'success' : 'secondary'} label={`${reward.pointsCost} pts`} />
        {canRedeem ? (
          <Button
            size="sm"
            className="w-full"
            variant={affordable ? 'default' : 'outline'}
            disabled={!affordable || pending}
            loading={pending}
            label={affordable ? 'Redeem' : 'Not enough'}
            onPress={onRedeem}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Parent-only queue: approve or reject pending redemptions (reject refunds the points server-side). */
function PendingRedemptions({ orgId }: { orgId: string }) {
  const { toast } = useToast()
  const pending = useRewardRedemptions(orgId, 'pending')
  const approve = useApproveRedemption(orgId)
  const reject = useRejectRedemption(orgId)
  const rows = pending.data ?? []
  if (pending.isLoading) {
    return (
      <View className="items-center py-6">
        <Spinner />
      </View>
    )
  }
  if (rows.length === 0) return null

  const onApprove = (r: RedemptionWithReward) =>
    approve.mutate(r.id, {
      onSuccess: () => toast({ title: 'Approved', variant: 'success' }),
      onError: (e) => toast({ title: "Couldn't approve", description: (e as Error).message, variant: 'error' }),
    })
  const onReject = (r: RedemptionWithReward) =>
    reject.mutate(r.id, {
      onSuccess: () => toast({ title: 'Rejected — points refunded', variant: 'success' }),
      onError: (e) => toast({ title: "Couldn't reject", description: (e as Error).message, variant: 'error' }),
    })

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Text variant="h3">Pending redemptions</Text>
        <Badge variant="warning" label={String(rows.length)} />
      </View>
      <List>
        {rows.map((r) => (
          <ListItem
            key={r.id}
            title={r.rewardName}
            subtitle={`${r.memberName ?? 'Member'} · ${r.pointsSpent} pts`}
            left={<Avatar name={r.memberName ?? '?'} size={36} />}
            right={
              <View className="flex-row gap-2">
                <Button size="sm" variant="outline" label="Reject" disabled={reject.isPending} onPress={() => onReject(r)} />
                <Button size="sm" label="Approve" disabled={approve.isPending} onPress={() => onApprove(r)} />
              </View>
            }
          />
        ))}
      </List>
    </View>
  )
}

/** Achievements tab — the code-defined catalog (earned/locked) + the household badge library. */
function AchievementsTab({ orgId }: { orgId: string }) {
  const colors = useColors()
  const achievements = useAchievements(orgId)
  const badges = useBadges(orgId)

  const unlocked = ACHIEVEMENT_LIST.filter((d) => achievements.unlockedKeys.has(d.key)).length
  const total = ACHIEVEMENT_LIST.length

  return (
    <View className="gap-6">
      <AsyncBoundary query={achievements}>
        <View className="gap-2">
          <Text variant="label">{t('achievements.progress', { unlocked, total })}</Text>
          <Progress value={total === 0 ? 0 : (unlocked / total) * 100} />
        </View>
        <View className="flex-row flex-wrap justify-between">
          {ACHIEVEMENT_LIST.map((def) => {
            const earned = achievements.unlockedKeys.has(def.key)
            const Icon = def.icon
            return (
              <Card key={def.key} className="mb-3 w-[48%]">
                <View className={cn('items-center gap-2 p-4', !earned && 'opacity-50')}>
                  <View className={cn('size-12 items-center justify-center rounded-full', earned ? 'bg-brand-500/10' : 'bg-accent')}>
                    <Icon size={24} color={earned ? colors.brand : colors.mutedForeground} />
                  </View>
                  <Text variant="label" numberOfLines={1} className="text-center">
                    {t(def.titleKey)}
                  </Text>
                  <Text variant="caption" numberOfLines={2} className="text-center">
                    {t(def.descriptionKey)}
                  </Text>
                  {earned ? null : (
                    <View className="flex-row items-center gap-1">
                      <Lock size={12} color={colors.mutedForeground} />
                      <Text variant="caption">Locked</Text>
                    </View>
                  )}
                </View>
              </Card>
            )
          })}
        </View>
      </AsyncBoundary>

      <View className="gap-3">
        <Text variant="h3">Badges</Text>
        <AsyncBoundary
          query={badges}
          isEmpty={(badges.data?.system.length ?? 0) === 0 && (badges.data?.custom.length ?? 0) === 0}
          empty={<Card><EmptyState icon={Sparkles} title="No badges yet" description="Badges unlock as your household builds habits." /></Card>}
        >
          <View className="flex-row flex-wrap justify-between">
            {(badges.data?.custom ?? []).map((b) => (
              <BadgeTile key={b.id} icon={b.icon} color={b.color} name={b.name} description={b.description} />
            ))}
            {(badges.data?.system ?? []).map((b) => (
              <BadgeTile key={b.key} icon={b.icon} name={b.name} description={b.description} />
            ))}
          </View>
        </AsyncBoundary>
      </View>
    </View>
  )
}

/** A small badge swatch — resolves its stored icon key + (custom) accent color; never a raw hex. */
function BadgeTile({
  icon,
  color,
  name,
  description,
}: {
  icon: string
  color?: string
  name: string
  description: string
}) {
  const colors = useColors()
  const Icon = iconFor(icon)
  const tint = color ? accentHex(color) : colors.brand
  return (
    <Card className="mb-3 w-[48%]">
      <CardContent className="items-center gap-2">
        <View className="size-12 items-center justify-center rounded-full" style={{ backgroundColor: `${tint}1a` }}>
          <Icon size={24} color={tint} />
        </View>
        <Text variant="label" numberOfLines={1} className="text-center">
          {name}
        </Text>
        <Text variant="caption" numberOfLines={2} className="text-center">
          {description}
        </Text>
      </CardContent>
    </Card>
  )
}

/** Leaderboard tab — members ranked by total XP, with a crown/medals for the top three. */
function LeaderboardTab({ orgId, userId }: { orgId: string; userId: string | undefined }) {
  const members = useHouseholdMembers(orgId)
  const ranked = useMemo(
    () => [...(members.data ?? [])].filter((m) => m.isActive).sort((a, b) => b.totalXp - a.totalXp),
    [members.data],
  )
  return (
    <AsyncBoundary
      query={members}
      isEmpty={ranked.length === 0}
      empty={<Card><EmptyState icon={Crown} title="No rankings yet" description="As members earn XP, they’ll climb the leaderboard." /></Card>}
    >
      <List>
        {ranked.map((m, i) => (
          <LeaderboardRow key={m.memberId} member={m} rank={i} isMe={Boolean(m.userId && m.userId === userId)} />
        ))}
      </List>
    </AsyncBoundary>
  )
}

// Medal tints resolve through the accent palette (gold/silver/bronze) so they stay identity colors,
// never raw hex — same rule the theme-guard enforces. amber→gold, slate→silver, orange→bronze.
const MEDAL_ACCENT = ['amber', 'slate', 'orange'] as const

function LeaderboardRow({ member, rank, isMe }: { member: HouseholdMember; rank: number; isMe: boolean }) {
  const colors = useColors()
  const accent = accentHex(member.favoriteColor)
  const rankIcon =
    rank === 0 ? (
      <Crown size={20} color={accentHex(MEDAL_ACCENT[0])} />
    ) : rank <= 2 ? (
      <Medal size={20} color={accentHex(MEDAL_ACCENT[rank])} />
    ) : (
      <Text variant="muted" style={{ color: colors.mutedForeground }}>{`#${rank + 1}`}</Text>
    )
  return (
    <ListItem
      title={member.displayName}
      subtitle={`Level ${member.level} · ${member.title}`}
      left={
        <View className="flex-row items-center gap-2">
          <View className="w-6 items-center">{rankIcon}</View>
          <View className="rounded-full border-2" style={{ borderColor: accent }}>
            <Avatar name={member.displayName} uri={member.avatarUrl ?? undefined} size={36} />
          </View>
        </View>
      }
      right={
        <View className="items-end">
          <Text variant="label">{member.totalXp} XP</Text>
          {isMe ? <Badge variant="outline" label="You" /> : null}
        </View>
      }
    />
  )
}
