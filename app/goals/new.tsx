import { useMemo, useState } from 'react'
import { View, Pressable } from 'react-native'
import { router, Stack } from 'expo-router'
import { Lock, Sparkles, Check } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHousehold, useHouseholdMembers } from '@/lib/query/hooks/useHousehold'
import { useCreateGoal, type GoalInput } from '@/lib/query/hooks/useGoals'
import { iconFor } from '@/lib/manyhandz/icons'

/**
 * New goal — the goals create form (pairs with app/goals/index.tsx). Family-only. A parent
 * (createGoalsForAnyone) may target any member; a kid creates only for themselves and the Worker
 * marks it pending_approval until a parent approves. Suggestions seed common goals in one tap.
 */

/** A short, kid-friendly icon set for goals (a subset of the shared icon keys). */
const GOAL_ICON_KEYS = ['target', 'game', 'gift', 'star', 'trophy', 'heart', 'book', 'car', 'sun', 'shopping-cart'] as const

/** Goal suggestions from the spec — points (and an optional dollar value, in cents). */
const SUGGESTIONS: { title: string; icon: string; targetPoints: number; monetaryValueCents?: number }[] = [
  { title: 'New Video Game', icon: 'game', targetPoints: 500, monetaryValueCents: 6000 },
  { title: 'Pizza Night', icon: 'gift', targetPoints: 300 },
  { title: 'Extra Screen Time', icon: 'star', targetPoints: 100 },
  { title: '$25 Cash', icon: 'target', targetPoints: 400, monetaryValueCents: 2500 },
  { title: 'Movie Outing', icon: 'heart', targetPoints: 250 },
]

/** "$12.50" → 1250 cents; empty/invalid → null. Tolerant of a leading $ and stray commas. */
function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export default function NewGoalScreen() {
  const { toast } = useToast()
  const colors = useColors()
  const { orgId, isLoading: modeLoading, features, can } = useHouseholdMode()
  const householdQuery = useHousehold(orgId ?? '')
  const membersQuery = useHouseholdMembers(orgId ?? '')
  const createGoal = useCreateGoal(orgId ?? '')

  const canTargetAnyone = can('createGoalsForAnyone')
  const meMemberId = householdQuery.data?.me.memberId

  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string | undefined>(undefined)
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string>('target')
  const [targetPoints, setTargetPoints] = useState('')
  const [pointsError, setPointsError] = useState<string | undefined>(undefined)
  const [monetary, setMonetary] = useState('')
  // Parents pick a target member; kids implicitly target themselves (left undefined).
  const [assignedTo, setAssignedTo] = useState('')

  const memberOptions = useMemo(
    () => (membersQuery.data ?? []).filter((m) => m.isActive).map((m) => ({ label: m.displayName, value: m.memberId })),
    [membersQuery.data],
  )

  const applySuggestion = (s: (typeof SUGGESTIONS)[number]) => {
    setTitle(s.title)
    setIcon(s.icon)
    setTargetPoints(String(s.targetPoints))
    setMonetary(s.monetaryValueCents != null ? (s.monetaryValueCents / 100).toFixed(2) : '')
    setTitleError(undefined)
    setPointsError(undefined)
  }

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setTitleError('Give your goal a name.')
      return
    }
    const points = Number(targetPoints)
    if (!Number.isInteger(points) || points <= 0) {
      setPointsError('Enter a target above zero.')
      return
    }
    const input: GoalInput = {
      title: trimmed,
      description: description.trim() || null,
      icon,
      targetPoints: points,
      monetaryValueCents: dollarsToCents(monetary),
    }
    // Only parents may target another member; for a kid this stays undefined → own goal (pending).
    if (canTargetAnyone && assignedTo && assignedTo !== meMemberId) input.memberId = assignedTo

    createGoal.mutate(input, {
      onSuccess: (row) => {
        const pending = row.status === 'pending_approval'
        toast({
          title: pending ? 'Goal sent for approval' : 'Goal created',
          description: pending ? 'A parent needs to approve it before it goes live.' : undefined,
          variant: 'success',
        })
        router.replace('/goals')
      },
      onError: (e) => toast({ title: "Couldn't create goal", description: (e as Error).message, variant: 'error' }),
    })
  }

  // Resolve the mode/feature flags before rendering the form.
  if (modeLoading && !features) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'New goal' }} />
        <PageWrapper width="form">
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        </PageWrapper>
      </>
    )
  }

  // Mode gate — goals are family-only; nobody should reach this form otherwise.
  if (features && !features.goals) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'New goal' }} />
        <PageWrapper width="form">
          <EmptyState
            icon={Lock}
            title="Goals aren't available here"
            description="Point-savings goals are a family feature."
            action={<Button label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
          />
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'New goal' }} />
      <PageWrapper width="form" className="gap-5 pb-16">
        <Card>
          <CardContent className="gap-4">
            <Input
              label="Title"
              placeholder="New bike, Disney trip…"
              value={title}
              onChangeText={(text) => {
                setTitle(text)
                if (titleError) setTitleError(undefined)
              }}
              error={titleError}
              maxLength={120}
              autoFocus
            />
            <Textarea
              label="Description"
              placeholder="What's this goal about? (optional)"
              rows={3}
              value={description}
              onChangeText={setDescription}
              maxLength={1000}
            />

            <View className="gap-2">
              <Text variant="label">Icon</Text>
              <View className="flex-row flex-wrap gap-2">
                {GOAL_ICON_KEYS.map((key) => {
                  const Icon = iconFor(key)
                  const selected = icon === key
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setIcon(key)}
                      accessibilityRole="button"
                      accessibilityLabel={`Icon ${key}`}
                      className={cn(
                        'size-12 items-center justify-center rounded-xl border active:opacity-80',
                        selected ? 'border-primary bg-accent' : 'border-border bg-card',
                      )}
                    >
                      <Icon color={selected ? colors.brand : colors.mutedForeground} size={22} />
                    </Pressable>
                  )
                })}
              </View>
            </View>

            <Input
              label="Target points"
              placeholder="500"
              keyboardType="number-pad"
              value={targetPoints}
              onChangeText={(text) => {
                setTargetPoints(text.replace(/[^0-9]/g, ''))
                if (pointsError) setPointsError(undefined)
              }}
              error={pointsError}
              maxLength={7}
            />
            <Input
              label="Monetary value (optional)"
              placeholder="25.00"
              keyboardType="decimal-pad"
              value={monetary}
              onChangeText={setMonetary}
              helper="What it's worth in dollars, if it's a cash-out or purchase goal."
              maxLength={12}
            />

            {/* Parents can target any member; kids only ever create for themselves. */}
            {canTargetAnyone ? (
              <Select
                label="Assign to"
                value={assignedTo}
                onValueChange={setAssignedTo}
                placeholder="Choose a member"
                options={memberOptions}
              />
            ) : (
              <View className="flex-row items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5">
                <Lock color={colors.mutedForeground} size={16} />
                <Text variant="caption" className="flex-1">
                  This goal is for you — a parent will approve it before it goes live.
                </Text>
              </View>
            )}
          </CardContent>
        </Card>

        <View className="gap-2">
          <Text variant="label">Suggestions</Text>
          <Text variant="caption">Tap one to prefill the form, then tweak.</Text>
          <View className="gap-2">
            {SUGGESTIONS.map((s) => {
              const Icon = iconFor(s.icon)
              return (
                <Pressable key={s.title} onPress={() => applySuggestion(s)} className="active:opacity-80">
                  <Card>
                    <CardContent className="flex-row items-center gap-3 py-3">
                      <View className="size-9 items-center justify-center rounded-lg bg-accent">
                        <Icon color={colors.brand} size={18} />
                      </View>
                      <View className="flex-1">
                        <Text variant="label">{s.title}</Text>
                        <Text variant="caption">
                          {s.targetPoints} pts{s.monetaryValueCents != null ? ` · $${(s.monetaryValueCents / 100).toFixed(0)}` : ''}
                        </Text>
                      </View>
                      {title === s.title ? <Check color={colors.brand} size={18} /> : <Sparkles color={colors.mutedForeground} size={16} />}
                    </CardContent>
                  </Card>
                </Pressable>
              )
            })}
          </View>
        </View>

        <Button label="Create goal" loading={createGoal.isPending} onPress={submit} />
        <Button
          variant="outline"
          label="Cancel"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/goals'))}
        />
      </PageWrapper>
    </>
  )
}
