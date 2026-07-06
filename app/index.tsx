import { useCallback } from 'react'
import { View, Pressable } from 'react-native'
import { Link, Stack, router, type Href } from 'expo-router'
import {
  Plus, Check, ClipboardCheck, Flame, Award, CheckCircle2, Activity as ActivityIcon,
  ListChecks, Users, Wallet, ShoppingCart, BarChart3, Settings, Home, Sparkles, ChevronRight,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { Separator } from '@/components/ui/separator'
import { CircularProgress } from '@/components/ui/circular-progress'
import { FAB } from '@/components/ui/fab'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { iconFor } from '@/lib/manyhandz/icons'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHousehold, useHouseholdMembers } from '@/lib/query/hooks/useHousehold'
import { useAssignments, useCompleteAssignment, useApprovalQueue, type AssignmentWithChore } from '@/lib/query/hooks/useAssignments'
import { useGoals } from '@/lib/query/hooks/useGoals'
import { useFairness } from '@/lib/query/hooks/useFairness'
import { useActivityFeed, type ActivityFeedEntry } from '@/lib/query/hooks/useActivity'

/** Local YYYY-MM-DD for the device day — assignments filter is keyed on this. */
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function greetingPrefix(playful: boolean): string {
  const h = new Date().getHours()
  const base = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  if (!playful) return base
  return h < 12 ? 'Rise and shine' : h < 18 ? 'Hey there' : 'Evening, superstar'
}

/** Compact relative timestamp for the feed. */
function timeAgo(value: string | Date): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString()
}

/**
 * Activity actions (`{entity}.{verb}`, sometimes `{entity}_{verb}`) → a plain-English line. Known
 * actions get a hand-written phrase; anything else falls back to "{Verb} a {noun}" (proper case, no
 * leftover dots/underscores) so the feed never reads like "Chore.created chore".
 */
const ACTIVITY_PHRASES: Record<string, string> = {
  'chore.created': 'Added a chore',
  'chore.updated': 'Updated a chore',
  'chore.deleted': 'Removed a chore',
  'category.created': 'Added a category',
  'assignment.created': 'Assigned a chore',
  'assignment.updated': 'Updated an assignment',
  chore_completed: 'Completed a chore',
  'completion.approved': 'Approved a chore',
  'completion.rejected': 'Sent a chore back',
  'rotation.created': 'Set up a rotation',
  'rotation.stopped': 'Stopped a rotation',
  'reward.created': 'Added a reward',
  'reward.updated': 'Updated a reward',
  'reward.deleted': 'Removed a reward',
  'reward_redemption.created': 'Redeemed a reward',
  'reward_redemption.approved': 'Fulfilled a reward',
  'goal.created': 'Created a goal',
  'goal.completed': 'Reached a goal',
  'gift.created': 'Gifted points',
  'settlement.created': 'Logged a payback',
  'competition.created': 'Started a competition',
  'competition.accepted': 'Accepted a challenge',
  'challenge.created': 'Started a challenge',
  'poll.created': 'Started a poll',
  'announcement.created': 'Posted an announcement',
  'badge.awarded': 'Earned a badge',
}

function activityLabel(e: ActivityFeedEntry): string {
  const mapped = ACTIVITY_PHRASES[e.action]
  if (mapped) return mapped
  // Fallback: "{entity}.{verb}" / "{entity}_{verb}" → "{Verb} a {noun}". entityType is the cleaner noun.
  const parts = e.action.split(/[._-]+/).filter(Boolean)
  const verb = parts[parts.length - 1] ?? e.action
  const noun = e.entityType.replace(/[_-]+/g, ' ').trim() || parts[0] || 'item'
  const article = /^[aeiou]/i.test(noun) ? 'an' : 'a'
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${article} ${noun}`
}

export default function Dashboard() {
  const { toast } = useToast()
  const { orgId, ready, isLoading, features, ui, can } = useHouseholdMode()
  const today = todayIso()

  const household = useHousehold(orgId ?? '')
  const members = useHouseholdMembers(orgId ?? '')
  const dueToday = useAssignments(orgId ?? '', { from: today, to: today })
  const overdue = useAssignments(orgId ?? '', { status: 'overdue' })
  const approvals = useApprovalQueue(orgId ?? '')
  const goals = useGoals(orgId ?? '')
  const fairness = useFairness(orgId ?? '', 'this_week')
  const activity = useActivityFeed(orgId ?? '')
  const complete = useCompleteAssignment(orgId ?? '')

  const onRefresh = useCallback(async () => {
    await Promise.all([
      members.refetch(), dueToday.refetch(), overdue.refetch(),
      approvals.refetch(), goals.refetch(), fairness.refetch(), activity.refetch(),
    ])
  }, [members, dueToday, overdue, approvals, goals, fairness, activity])

  // Not in a household yet, or mode unknown — keep the screen graceful while it resolves.
  if (isLoading || !ready || !features || !ui) {
    return (
      <PageWrapper width="wide">
        <Stack.Screen options={{ title: 'Home', headerShown: false }} />
        <View className="flex-1 items-center justify-center py-24">
          <Spinner size="large" />
        </View>
      </PageWrapper>
    )
  }

  // Resolve the signed-in member: the household payload carries the caller's memberId; the members
  // list carries the display name + derived level/streak/points the kid hero renders.
  const myMemberId = household.data?.me.memberId
  const meMember = members.data?.find((m) => m.memberId === myMemberId) ?? null
  const displayName = meMember?.displayName ?? ''

  // The three home variants are derived from CAPABILITIES, never raw mode/role strings:
  //  - admin view = can approve completions (the family parent): approval queue + FAB.
  //  - kid view   = gamification on but no admin powers (restricted family member): level hero + goals.
  //  - peer view  = no gamification (roommate/office): fairness mini-widget + clean cards.
  const isAdminView = can('completion:approve')
  const isKidView = features.gamification && !isAdminView && !can('chore:create')
  const showPoints = features.gamification

  const dueList = (dueToday.data ?? []).filter((a) => a.status !== 'completed' && a.status !== 'approved')
  const completedToday = (dueToday.data ?? []).filter((a) => a.status === 'completed' || a.status === 'approved').length
  const overdueList = overdue.data ?? []
  const streak = computeStreak(members.data)
  const points = computePoints(members.data)

  const onDone = (a: AssignmentWithChore) => {
    if (!can('completion:mark_own')) {
      toast({ title: "You can't complete chores", variant: 'error' })
      return
    }
    complete.mutate(
      { assignmentId: a.id },
      {
        onSuccess: (res) =>
          toast({
            title: res.needsApproval ? 'Sent for approval' : 'Nice work!',
            description: res.needsApproval ? 'A parent will verify it.' : `+${res.breakdown.total} pts`,
            variant: 'success',
          }),
        onError: (e) => toast({ title: "Couldn't complete", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  return (
    <>
      <PageWrapper width="wide" onRefresh={onRefresh} className="pb-28">
      <Stack.Screen options={{ title: 'Home', headerShown: false }} />

      {/* Greeting */}
      <View className="gap-1">
        <Text variant="h1">
          {greetingPrefix(ui.tonePlayful)}
          {displayName ? `, ${displayName}` : ''}
          {ui.tonePlayful ? ' 👋' : ''}
        </Text>
        <Text variant="muted">
          {ui.tonePlayful
            ? dueList.length
              ? `You have ${dueList.length} ${dueList.length === 1 ? 'chore' : 'chores'} today. Let's go!`
              : "You're all caught up — nice!"
            : new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
      </View>

      {/* KID hero — Level / Streak / XP */}
      {isKidView ? <KidHero member={meMember} /> : null}

      {/* PEER (roommate) fairness mini-widget — shown to non-gamified, non-admin members */}
      {!isKidView && !isAdminView && features.fairnessScoring ? (
        <FairnessWidget
          loading={fairness.isLoading}
          score={fairness.data?.fairness.householdScore ?? null}
          label={fairness.data?.fairness.label ?? null}
        />
      ) : null}

      {/* Quick stats */}
      <View className="flex-row flex-wrap gap-3">
        <StatCard icon={ClipboardCheck} tint="primary" label="Due today" value={dueList.length} />
        <StatCard icon={CheckCircle2} tint="success" label="Completed" value={completedToday} />
        <StatCard icon={Flame} tint="warning" label="Day streak" value={streak} />
        {showPoints ? <StatCard icon={Award} tint="brand" label="Points" value={points} /> : null}
      </View>

      {/* PARENT approval queue card */}
      {isAdminView && features.approvalWorkflow ? (
        <ApprovalCard loading={approvals.isLoading} count={approvals.data?.length ?? 0} />
      ) : null}

      {/* KID goals — horizontal progress rings */}
      {isKidView && features.goals ? (
        <GoalRings loading={goals.isLoading} goals={(goals.data ?? []).filter((g) => g.status === 'active').slice(0, 6)} />
      ) : null}

      {/* Today's assignments */}
      <Section title="Today's chores">
        {dueToday.isLoading ? (
          <CenterSpinner />
        ) : dueList.length === 0 ? (
          <Card>
            <EmptyState
              icon={Sparkles}
              title="Nothing due today"
              description={ui.tonePlayful ? 'Go play — you earned it!' : 'No chores scheduled for today.'}
            />
          </Card>
        ) : (
          <View className="gap-2">
            {dueList.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                stars={ui.difficultyDisplay === 'stars'}
                canComplete={can('completion:mark_own')}
                completing={complete.isPending}
                onDone={() => onDone(a)}
              />
            ))}
          </View>
        )}
      </Section>

      {/* Overdue */}
      {overdueList.length > 0 ? (
        <Section title="Overdue" accent="destructive">
          <View className="gap-2">
            {overdueList.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                overdue
                stars={ui.difficultyDisplay === 'stars'}
                canComplete={can('completion:mark_own')}
                completing={complete.isPending}
                onDone={() => onDone(a)}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {/* Quick links to deep screens */}
      <QuickLinks
        showSettleUp={features.paymentHandles}
        showReports={features.weeklyReportCard}
        canSettings={can('org:settings')}
      />

      {/* Activity feed */}
      <Section title="Recent activity">
        {activity.isLoading ? (
          <CenterSpinner />
        ) : (
          <ActivityFeed entries={(activity.data ?? []).slice(0, 10)} />
        )}
      </Section>

      {/* Dev-only gallery link */}
      {__DEV__ ? (
        <Link href="/components" asChild>
          <Pressable accessibilityRole="link" className="items-center py-2 active:opacity-70">
            <Text variant="caption" className="text-brand-500 dark:text-brand-400">View component gallery →</Text>
          </Pressable>
        </Link>
      ) : null}

      </PageWrapper>

      {/* PARENT / ROOMMATE FAB → new chore. Sibling of PageWrapper (OUTSIDE the page's ScrollView)
          so it pins to the screen's bottom-right instead of scrolling away with the content. */}
      {can('chore:create') ? (
        <FAB icon={Plus} accessibilityLabel="New chore" onPress={() => router.push('/chores/new' as Href)} />
      ) : null}
    </>
  )
}

// ---------- local helpers that read member rows ----------

type Member = NonNullable<ReturnType<typeof useHouseholdMembers>['data']>[number]

/** The household sum-of-streaks is misleading; the dashboard "day streak" is the best current streak. */
function computeStreak(members: Member[] | undefined): number {
  if (!members || members.length === 0) return 0
  return members.reduce((max, m) => Math.max(max, m.currentStreak), 0)
}
function computePoints(members: Member[] | undefined): number {
  if (!members) return 0
  return members.reduce((sum, m) => sum + m.pointsBalance, 0)
}
// ---------- presentational sub-components ----------

function ActivityFeed({ entries }: { entries: ActivityFeedEntry[] }) {
  const colors = useColors()
  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState icon={ActivityIcon} title="No activity yet" description="Completed chores and updates show up here." />
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="gap-0 py-1">
        {entries.map((e, i) => (
          <View key={e.id}>
            <View className="flex-row items-center gap-3 py-2.5">
              <View className="size-8 items-center justify-center rounded-full bg-accent">
                <ActivityIcon color={colors.mutedForeground} size={16} />
              </View>
              <View className="flex-1">
                <Text variant="label" numberOfLines={1}>{activityLabel(e)}</Text>
              </View>
              <Text variant="caption">{timeAgo(e.createdAt)}</Text>
            </View>
            {i < entries.length - 1 ? <Separator /> : null}
          </View>
        ))}
      </CardContent>
    </Card>
  )
}

function Section({ title, accent, children }: { title: string; accent?: 'destructive'; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text variant="h3" className={cn(accent === 'destructive' && 'text-destructive')}>{title}</Text>
      {children}
    </View>
  )
}

function CenterSpinner() {
  return (
    <View className="items-center py-6">
      <Spinner />
    </View>
  )
}

const TINTS: Record<'primary' | 'success' | 'warning' | 'brand', keyof ReturnType<typeof useColors>> = {
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  brand: 'brand',
}

function StatCard({ icon: Icon, tint, label, value }: { icon: LucideIcon; tint: keyof typeof TINTS; label: string; value: number }) {
  const colors = useColors()
  const tintColor = colors[TINTS[tint]]
  const color = Array.isArray(tintColor) ? tintColor[0] : tintColor
  return (
    <Card className="min-w-[44%] flex-1">
      <CardContent className="gap-1 py-3">
        <View className="flex-row items-center gap-2">
          <Icon color={color} size={18} />
          <Text variant="caption">{label}</Text>
        </View>
        <Text variant="h2" style={{ color }}>{value}</Text>
      </CardContent>
    </Card>
  )
}

function KidHero({ member }: { member: Member | null }) {
  const colors = useColors()
  if (!member) {
    return (
      <Card>
        <CardContent className="py-5">
          <Text variant="muted">Loading your stats…</Text>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card className="border-brand-500/40">
      <CardContent className="flex-row items-center gap-4 py-5">
        <View className="size-16 items-center justify-center rounded-2xl bg-brand-500/10">
          <Award color={colors.brand} size={30} />
        </View>
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text variant="h2">Level {member.level}</Text>
            <Badge variant="secondary" label={member.title} />
          </View>
          <Text variant="muted">{member.totalXp} XP</Text>
        </View>
        <View className="items-center">
          <View className="flex-row items-center gap-1">
            <Flame color={colors.warning} size={18} />
            <Text variant="h3">{member.currentStreak}</Text>
          </View>
          <Text variant="caption">day streak</Text>
        </View>
      </CardContent>
    </Card>
  )
}

function FairnessWidget({ loading, score, label }: { loading: boolean; score: number | null; label: string | null }) {
  const colors = useColors()
  if (loading) {
    return (
      <Card>
        <CardContent className="py-5">
          <CenterSpinner />
        </CardContent>
      </Card>
    )
  }
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/fairness' as Href)} className="active:opacity-90">
      <Card>
        <CardContent className="flex-row items-center gap-4 py-4">
          <CircularProgress value={score ?? 0} size={72} strokeWidth={7} />
          <View className="flex-1 gap-0.5">
            <Text variant="caption">Household fairness · this week</Text>
            <Text variant="h3">{label ?? 'No data yet'}</Text>
            <Text variant="muted">Tap to see the breakdown</Text>
          </View>
          <ChevronRight color={colors.mutedForeground} size={20} />
        </CardContent>
      </Card>
    </Pressable>
  )
}

function ApprovalCard({ loading, count }: { loading: boolean; count: number }) {
  const colors = useColors()
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/approvals' as Href)} className="active:opacity-90">
      <Card className={cn(count > 0 && 'border-warning/50')}>
        <CardContent className="flex-row items-center gap-3 py-4">
          <View className="size-11 items-center justify-center rounded-xl bg-warning/10">
            <ClipboardCheck color={colors.warning} size={22} />
          </View>
          <View className="flex-1">
            <Text variant="label">Approval queue</Text>
            <Text variant="muted">
              {loading ? 'Checking…' : count === 0 ? 'Nothing waiting — all caught up' : `${count} ${count === 1 ? 'completion' : 'completions'} need verifying`}
            </Text>
          </View>
          {count > 0 ? <Badge variant="warning" label={String(count)} /> : null}
          <ChevronRight color={colors.mutedForeground} size={20} />
        </CardContent>
      </Card>
    </Pressable>
  )
}

type Goal = NonNullable<ReturnType<typeof useGoals>['data']>[number]

function GoalRings({ loading, goals }: { loading: boolean; goals: Goal[] }) {
  if (loading) return <Card><CardContent className="py-5"><CenterSpinner /></CardContent></Card>
  if (goals.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={iconFor('target')}
          title="No goals yet"
          description="Pick something to save up for!"
          action={<Button size="sm" variant="outline" label="Add a goal" onPress={() => router.push('/goals' as Href)} />}
        />
      </Card>
    )
  }
  return (
    <Section title="Your goals">
      <View className="flex-row flex-wrap gap-4">
        {goals.map((g) => {
          const pct = g.targetPoints > 0 ? Math.round((g.currentPoints / g.targetPoints) * 100) : 0
          return (
            <Pressable
              key={g.id}
              accessibilityRole="button"
              onPress={() => router.push(`/goals/${g.id}` as Href)}
              className="w-24 items-center gap-1 active:opacity-80"
            >
              <CircularProgress value={pct} size={72} strokeWidth={7} />
              <Text variant="caption" numberOfLines={1} className="text-center">{g.title}</Text>
            </Pressable>
          )
        })}
      </View>
    </Section>
  )
}

function AssignmentCard({
  assignment, overdue, stars, canComplete, completing, onDone,
}: {
  assignment: AssignmentWithChore
  overdue?: boolean
  stars: boolean
  canComplete: boolean
  completing: boolean
  onDone: () => void
}) {
  const colors = useColors()
  const Icon = iconFor(assignment.choreIcon)
  const difficulty = stars
    ? '★'.repeat(Math.max(1, Math.min(5, assignment.difficulty)))
    : assignment.difficulty <= 2 ? 'Easy' : assignment.difficulty <= 3 ? 'Medium' : 'Hard'
  return (
    <Card className={cn(overdue && 'border-destructive/40')}>
      <CardContent className="flex-row items-center gap-3 py-3">
        <View className={cn('size-10 items-center justify-center rounded-xl', overdue ? 'bg-destructive/10' : 'bg-accent')}>
          <Icon color={overdue ? colors.destructive : colors.foreground} size={20} />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/assignments/${assignment.id}` as Href)}
          className="flex-1 active:opacity-80"
        >
          <Text variant="label" numberOfLines={1}>{assignment.choreName}</Text>
          <View className="flex-row items-center gap-2">
            <Text variant="caption">{difficulty}</Text>
            <Text variant="caption">· {assignment.estimatedMinutes} min</Text>
            {overdue ? (
              <Badge variant="destructive" label="Overdue" />
            ) : null}
          </View>
        </Pressable>
        {canComplete ? (
          <Button
            size="sm"
            variant={overdue ? 'destructive' : 'default'}
            label="Done"
            disabled={completing}
            onPress={onDone}
            accessibilityLabel={`Mark ${assignment.choreName} done`}
          />
        ) : (
          <Check color={colors.mutedForeground} size={18} />
        )}
      </CardContent>
    </Card>
  )
}

function QuickLinks({
  showSettleUp, showReports, canSettings,
}: {
  showSettleUp: boolean
  showReports: boolean
  canSettings: boolean
}) {
  const links: { icon: LucideIcon; label: string; href: Href }[] = [
    { icon: ListChecks, label: 'Chores', href: '/chores' as Href },
    { icon: Users, label: 'Members', href: '/members' as Href },
    ...(showSettleUp ? [{ icon: Wallet, label: 'Settle Up', href: '/settle-up' as Href }] : []),
    { icon: ShoppingCart, label: 'Shopping', href: '/shopping' as Href },
    { icon: ClipboardCheck, label: 'Tasks', href: '/tasks' as Href },
    ...(showReports ? [{ icon: BarChart3, label: 'Reports', href: '/reports' as Href }] : []),
    { icon: Settings, label: 'Settings', href: '/settings' as Href },
    ...(canSettings ? [{ icon: Home, label: 'Household', href: '/household-settings' as Href }] : []),
  ]
  return (
    <Section title="Jump to">
      <View className="flex-row flex-wrap gap-3">
        {links.map((l) => (
          <QuickLink key={l.label} icon={l.icon} label={l.label} href={l.href} />
        ))}
      </View>
    </Section>
  )
}

function QuickLink({ icon: Icon, label, href }: { icon: LucideIcon; label: string; href: Href }) {
  const colors = useColors()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      className="min-w-[28%] flex-1 active:opacity-80"
    >
      <Card>
        <CardContent className="items-center gap-1.5 py-4">
          <Icon color={colors.brand} size={22} />
          <Text variant="caption">{label}</Text>
        </CardContent>
      </Card>
    </Pressable>
  )
}
