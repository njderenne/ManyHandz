import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { Plus, Target, Trophy, CheckCircle2, Coins, Lock } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CircularProgress } from '@/components/ui/circular-progress'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Dialog } from '@/components/ui/dialog'
import { Stepper } from '@/components/ui/stepper'
import { FAB } from '@/components/ui/fab'
import { Section } from '@/components/gallery/kit'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHousehold, useHouseholdMembers } from '@/lib/query/hooks/useHousehold'
import { useGoals, useContributeToGoal, useApproveGoal } from '@/lib/query/hooks/useGoals'
import { iconFor } from '@/lib/manyhandz/icons'
import { formatCents } from '@/lib/format/currency'
import type { Goal } from '@/lib/db/schema'

/**
 * Goals — point-savings goals (FAMILY mode only; hidden behind features.goals). Active goals show a
 * progress ring + points remaining + optional monetary value with a Contribute affordance, completed
 * goals fall into a celebration gallery, and parents (createGoalsForAnyone) get an approve action for
 * any kid-created goal sitting in pending_approval. Mirrors the events list pattern.
 */

function pct(goal: Goal): number {
  if (goal.targetPoints <= 0) return 0
  return Math.min(100, Math.round((goal.currentPoints / goal.targetPoints) * 100))
}

/** A single active goal card: ring, remaining points, monetary value, and a Contribute button. */
function ActiveGoalCard({
  goal,
  ownBalance,
  onContribute,
}: {
  goal: Goal
  ownBalance: number
  onContribute: (goal: Goal) => void
}) {
  const colors = useColors()
  const Icon = iconFor(goal.icon)
  const remaining = Math.max(0, goal.targetPoints - goal.currentPoints)
  const canContribute = ownBalance > 0 && remaining > 0
  return (
    <Card className="flex-1">
      <CardContent className="gap-3">
        <View className="flex-row items-center gap-3">
          <View className="size-10 items-center justify-center rounded-xl bg-accent">
            <Icon color={colors.brand} size={20} />
          </View>
          <View className="flex-1">
            <Text variant="label" numberOfLines={1}>{goal.title}</Text>
            {goal.monetaryValueCents != null ? (
              <Text variant="caption">Worth {formatCents(goal.monetaryValueCents)}</Text>
            ) : null}
          </View>
        </View>
        <View className="flex-row items-center gap-3">
          <CircularProgress value={pct(goal)} size={72} strokeWidth={7} />
          <View className="flex-1 gap-1">
            <Text variant="muted">
              {goal.currentPoints} / {goal.targetPoints} pts
            </Text>
            <Text variant="caption">{remaining} points to go</Text>
          </View>
        </View>
        <Button
          size="sm"
          icon={Coins}
          label="Contribute"
          disabled={!canContribute}
          onPress={() => onContribute(goal)}
        />
      </CardContent>
    </Card>
  )
}

/** A completed goal — a celebratory tile for the gallery. */
function CompletedGoalCard({ goal }: { goal: Goal }) {
  const colors = useColors()
  const Icon = iconFor(goal.icon)
  return (
    <Card className="flex-1">
      <CardContent className="items-center gap-2 py-4">
        <View className="size-12 items-center justify-center rounded-full bg-accent">
          <Icon color={colors.success} size={22} />
        </View>
        <Text variant="label" numberOfLines={1} className="text-center">{goal.title}</Text>
        <Badge variant="success" label={`${goal.targetPoints} pts`} />
        {goal.monetaryValueCents != null ? (
          <Text variant="caption">{formatCents(goal.monetaryValueCents)}</Text>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Lay a list of goals out two-per-row (a simple flex grid; cards flex to fill each row). */
function GoalGrid<T extends { id: string }>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2))
  return (
    <View className="gap-3">
      {rows.map((row) => (
        <View key={row[0]!.id} className="flex-row gap-3">
          {row.map((item) => render(item))}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  )
}

export default function GoalsScreen() {
  const { toast } = useToast()
  const colors = useColors()
  const { orgId, isLoading: modeLoading, features, can } = useHouseholdMode()
  const goalsQuery = useGoals(orgId ?? '')
  const householdQuery = useHousehold(orgId ?? '')
  const membersQuery = useHouseholdMembers(orgId ?? '')
  const contribute = useContributeToGoal(orgId ?? '')
  const approve = useApproveGoal(orgId ?? '')

  const meMemberId = householdQuery.data?.me.memberId
  const ownBalance = useMemo(
    () => membersQuery.data?.find((m) => m.memberId === meMemberId)?.pointsBalance ?? 0,
    [membersQuery.data, meMemberId],
  )
  const memberName = useMemo(() => {
    const byId = new Map((membersQuery.data ?? []).map((m) => [m.memberId, m.displayName]))
    return (id: string) => byId.get(id) ?? 'Member'
  }, [membersQuery.data])

  // Contribute dialog state.
  const [target, setTarget] = useState<Goal | null>(null)
  const [points, setPoints] = useState(0)

  const goals = goalsQuery.data ?? []
  const canApprove = can('createGoalsForAnyone')
  const active = goals.filter((g) => g.status === 'active')
  const completed = goals.filter((g) => g.status === 'completed')
  const pending = canApprove ? goals.filter((g) => g.status === 'pending_approval') : []

  const openContribute = (goal: Goal) => {
    const remaining = Math.max(0, goal.targetPoints - goal.currentPoints)
    setTarget(goal)
    setPoints(Math.min(ownBalance, remaining, 10) || Math.min(ownBalance, remaining))
  }

  const submitContribute = () => {
    if (!target || points <= 0) return
    contribute.mutate(
      { goalId: target.id, points },
      {
        onSuccess: (res) => {
          setTarget(null)
          toast({
            title: res.completed ? 'Goal reached!' : 'Points added',
            description: res.completed ? `${target.title} is fully funded.` : `+${res.contributed} pts toward ${target.title}.`,
            variant: 'success',
          })
        },
        onError: (e) => toast({ title: "Couldn't contribute", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const approveGoal = (goal: Goal) => {
    approve.mutate(goal.id, {
      onSuccess: () => toast({ title: 'Goal approved', description: `${goal.title} is now active.`, variant: 'success' }),
      onError: (e) => toast({ title: "Couldn't approve", description: (e as Error).message, variant: 'error' }),
    })
  }

  // Loading the mode/feature flags — wait before deciding whether goals even apply.
  if (modeLoading && !features) {
    return (
      <View className="flex-1">
        <Stack.Screen options={{ headerShown: true, title: 'Goals' }} />
        <PageWrapper>
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        </PageWrapper>
      </View>
    )
  }

  // Mode gate: goals are a family-only feature. Roommate/office get a friendly explainer.
  if (features && !features.goals) {
    return (
      <View className="flex-1">
        <Stack.Screen options={{ headerShown: true, title: 'Goals' }} />
        <PageWrapper>
          <EmptyState
            icon={Lock}
            title="Goals aren't available here"
            description="Point-savings goals are a family feature — switch a household to Family mode to set them up."
          />
        </PageWrapper>
      </View>
    )
  }

  const remainingForTarget = target ? Math.max(0, target.targetPoints - target.currentPoints) : 0
  const maxContribution = Math.max(0, Math.min(ownBalance, remainingForTarget))

  return (
    <View className="flex-1">
      <Stack.Screen options={{ headerShown: true, title: 'Goals' }} />
      <PageWrapper className="gap-6 pb-28" width="wide" onRefresh={() => goalsQuery.refetch()}>
        {goalsQuery.isLoading ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : goalsQuery.isError ? (
          <EmptyState
            icon={Target}
            title="Couldn't load goals"
            description="Something went wrong fetching your goals. Pull to refresh to try again."
            action={<Button label="Retry" onPress={() => goalsQuery.refetch()} />}
          />
        ) : goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No goals yet"
            description="Set a savings goal — a new game, a pizza night, some cash — and watch the points stack up."
            action={<Button label="Create a goal" icon={Plus} onPress={() => router.push('/goals/new')} />}
          />
        ) : (
          <>
            {pending.length > 0 ? (
              <Section title="Needs approval" description="Goals your kids created — approve to make them active.">
                {pending.map((goal) => {
                  const Icon = iconFor(goal.icon)
                  return (
                    <Card key={goal.id}>
                      <CardContent className="flex-row items-center gap-3">
                        <View className="size-10 items-center justify-center rounded-xl bg-accent">
                          <Icon color={colors.warning} size={20} />
                        </View>
                        <View className="flex-1">
                          <Text variant="label" numberOfLines={1}>{goal.title}</Text>
                          <Text variant="caption">
                            {memberName(goal.memberId)} · {goal.targetPoints} pts
                            {goal.monetaryValueCents != null ? ` · ${formatCents(goal.monetaryValueCents)}` : ''}
                          </Text>
                        </View>
                        <Button
                          size="sm"
                          label="Approve"
                          loading={approve.isPending && approve.variables === goal.id}
                          onPress={() => approveGoal(goal)}
                        />
                      </CardContent>
                    </Card>
                  )
                })}
              </Section>
            ) : null}

            <Section title="Active goals" description={active.length > 0 ? 'Chip away at them by contributing points.' : undefined}>
              {active.length > 0 ? (
                <GoalGrid
                  items={active}
                  render={(goal) => (
                    <ActiveGoalCard key={goal.id} goal={goal} ownBalance={ownBalance} onContribute={openContribute} />
                  )}
                />
              ) : (
                <Card>
                  <EmptyState
                    icon={Target}
                    title="No active goals"
                    description="Create a goal to start saving toward something."
                    action={<Button size="sm" variant="outline" label="New goal" icon={Plus} onPress={() => router.push('/goals/new')} />}
                  />
                </Card>
              )}
            </Section>

            {completed.length > 0 ? (
              <Section title="Completed" description="Goals you've fully funded.">
                <GoalGrid items={completed} render={(goal) => <CompletedGoalCard key={goal.id} goal={goal} />} />
              </Section>
            ) : null}
          </>
        )}
      </PageWrapper>

      <FAB icon={Plus} accessibilityLabel="Create a goal" onPress={() => router.push('/goals/new')} />

      <Dialog
        visible={target != null}
        onClose={() => setTarget(null)}
        title={target ? `Contribute to ${target.title}` : 'Contribute'}
        description={`You have ${ownBalance} points to give. They'll be deducted from your balance.`}
      >
        <View className="mt-2 gap-4">
          <View className="flex-row items-center justify-between">
            <Text variant="label">Points</Text>
            <Stepper value={points} onValueChange={setPoints} min={0} max={maxContribution} step={5} />
          </View>
          {target != null && pct({ ...target, currentPoints: target.currentPoints + points }) >= 100 ? (
            <View className="flex-row items-center gap-2">
              <Trophy color={colors.success} size={16} />
              <Text variant="caption">This contribution completes the goal.</Text>
            </View>
          ) : null}
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" label="Cancel" onPress={() => setTarget(null)} />
            <Button
              label="Contribute"
              icon={CheckCircle2}
              disabled={points <= 0}
              loading={contribute.isPending}
              onPress={submitContribute}
            />
          </View>
        </View>
      </Dialog>
    </View>
  )
}
