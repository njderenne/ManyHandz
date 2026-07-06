import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { Trophy, Zap, ListChecks, ShieldCheck, Sparkles, Plus, Clock } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Stepper } from '@/components/ui/stepper'
import { Progress } from '@/components/ui/progress'
import { Dialog } from '@/components/ui/dialog'
import { FAB } from '@/components/ui/fab'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { cn } from '@/lib/utils'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import {
  useChallenges,
  usePastChallenges,
  useCreateChallenge,
  type ChallengeType,
  type ChallengeInput,
} from '@/lib/query/hooks/useChallenges'
import type { BonusChallenge } from '@/lib/db/schema'

/**
 * Challenges — time-boxed bonus challenges (Active / Past). Available only where
 * `features.bonusChallenges` is on (off in roommate mode → friendly empty state). Active cards show
 * a live countdown to `endsAt`, a type badge (Double Points surfaces the multiplier = pointsMultiplier
 * /10), and progress. Creating is gated on `can('challenge:create')` — a Dialog form picks the type,
 * a duration preset, and the multiplier/bonus. The cron resolves + pays out; these hooks only read +
 * create. Pushed route; the create form lives in an in-screen Dialog (single-file route).
 */

type TypeMeta = { label: string; icon: LucideIcon; blurb: string }
const TYPE_META: Record<ChallengeType, TypeMeta> = {
  double_points: { label: 'Double Points', icon: Zap, blurb: 'Multiply points earned during the window.' },
  complete_count: { label: 'Completion Count', icon: ListChecks, blurb: 'Hit a target number of completions for a bonus.' },
  no_overdue: { label: 'No Overdue', icon: ShieldCheck, blurb: 'Keep the whole household overdue-free for a bonus.' },
  custom: { label: 'Custom', icon: Sparkles, blurb: 'A free-form goal you describe yourself.' },
}

const TYPE_OPTIONS = (Object.keys(TYPE_META) as ChallengeType[]).map((value) => ({
  value,
  label: TYPE_META[value].label,
}))

/** Duration presets → hours from now. */
const DURATION_PRESETS: { label: string; hours: number }[] = [
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  { label: '2 weeks', hours: 336 },
]

/** "15" (×10 fixed-point) → "1.5×" for display. */
function multiplierLabel(x10: number): string {
  const v = x10 / 10
  return `${Number.isInteger(v) ? v.toString() : v.toFixed(1)}×`
}

/** ms remaining → "2d 4h" / "3h 12m" / "0:45" (mm:ss under an hour, live) / "Ended". */
function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Ended'
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Live "now" tick — per-second so sub-hour countdowns animate, fine elsewhere too. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

const PAST_STATUS_BADGE: Record<string, BadgeProps['variant']> = {
  completed: 'success',
  failed: 'destructive',
  expired: 'outline',
}

function ActiveChallengeCard({ challenge, now }: { challenge: BonusChallenge; now: number }) {
  const colors = useColors()
  const meta = TYPE_META[(challenge.challengeType as ChallengeType)] ?? TYPE_META.custom
  const Icon = meta.icon
  const endsAt = new Date(challenge.endsAt).getTime()
  const startsAt = new Date(challenge.startsAt).getTime()
  const remaining = endsAt - now
  const span = Math.max(1, endsAt - startsAt)
  const elapsedPct = Math.max(0, Math.min(100, ((now - startsAt) / span) * 100))
  const urgent = remaining > 0 && remaining < 3_600_000

  return (
    <Card>
      <CardContent className="gap-3">
        <View className="flex-row items-start gap-3">
          <View className="size-10 items-center justify-center rounded-xl bg-brand-500/10">
            <Icon size={20} color={colors.brand} />
          </View>
          <View className="flex-1 gap-1">
            <Text variant="label" numberOfLines={1}>{challenge.title}</Text>
            {challenge.description ? (
              <Text variant="caption" numberOfLines={2}>{challenge.description}</Text>
            ) : null}
          </View>
          {challenge.challengeType === 'double_points' ? (
            <Badge variant="warning" label={multiplierLabel(challenge.pointsMultiplier)} />
          ) : (
            <Badge variant="secondary" label={meta.label} />
          )}
        </View>

        <View className="gap-1.5">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <Clock size={14} color={urgent ? colors.destructive : colors.mutedForeground} />
              <Text variant="caption" className={cn('tabular-nums', urgent && 'text-destructive')}>
                {formatRemaining(remaining)} left
              </Text>
            </View>
            {challenge.challengeType === 'complete_count' && challenge.targetValue ? (
              <Text variant="caption">Target {challenge.targetValue}</Text>
            ) : challenge.bonusPoints > 0 ? (
              <Text variant="caption">+{challenge.bonusPoints} bonus</Text>
            ) : null}
          </View>
          <Progress value={elapsedPct} />
        </View>
      </CardContent>
    </Card>
  )
}

function PastChallengeCard({ challenge }: { challenge: BonusChallenge }) {
  const meta = TYPE_META[(challenge.challengeType as ChallengeType)] ?? TYPE_META.custom
  const ended = new Date(challenge.endsAt)
  const endedLabel = Number.isNaN(ended.getTime()) ? '' : ended.toLocaleDateString()
  return (
    <Card>
      <CardContent className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="label" numberOfLines={1}>{challenge.title}</Text>
          <Text variant="caption">
            {meta.label}
            {endedLabel ? ` · ended ${endedLabel}` : ''}
          </Text>
        </View>
        <Badge
          variant={PAST_STATUS_BADGE[challenge.status] ?? 'outline'}
          label={challenge.status}
        />
      </CardContent>
    </Card>
  )
}

/** The create-challenge Dialog form. Rendered only when `can('challenge:create')`. */
function CreateChallengeDialog({
  orgId,
  visible,
  onClose,
}: {
  orgId: string
  visible: boolean
  onClose: () => void
}) {
  const { toast } = useToast()
  const create = useCreateChallenge(orgId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<ChallengeType>('double_points')
  const [durationHours, setDurationHours] = useState(72)
  const [multiplierX10, setMultiplierX10] = useState(20) // 2.0×
  const [targetValue, setTargetValue] = useState(5)
  const [bonusPoints, setBonusPoints] = useState(50)

  const reset = () => {
    setTitle('')
    setDescription('')
    setType('double_points')
    setDurationHours(72)
    setMultiplierX10(20)
    setTargetValue(5)
    setBonusPoints(50)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = () => {
    if (!title.trim()) {
      toast({ title: 'Give your challenge a title', variant: 'error' })
      return
    }
    const endsAt = new Date(Date.now() + durationHours * 3_600_000).toISOString()
    const input: ChallengeInput = {
      title: title.trim(),
      description: description.trim() || null,
      challengeType: type,
      endsAt,
      bonusPoints: type === 'double_points' ? 0 : bonusPoints,
      pointsMultiplier: type === 'double_points' ? multiplierX10 : undefined,
      targetValue: type === 'complete_count' || type === 'custom' ? targetValue : null,
    }
    create.mutate(input, {
      onSuccess: () => {
        toast({ title: 'Challenge started', variant: 'success' })
        close()
      },
      onError: (e) =>
        toast({ title: "Couldn't start challenge", description: (e as Error).message, variant: 'error' }),
    })
  }

  return (
    <Dialog visible={visible} onClose={close} title="New challenge" className="max-w-md">
      <Form onSubmit={submit} className="gap-4">
        <Input label="Title" placeholder="Weekend Sprint" value={title} onChangeText={setTitle} />
        <Textarea
          label="Description"
          placeholder="What's the goal? (optional)"
          rows={2}
          value={description}
          onChangeText={setDescription}
        />
        <Select label="Type" options={TYPE_OPTIONS} value={type} onValueChange={(v) => setType(v as ChallengeType)} />
        <Text variant="caption">{TYPE_META[type].blurb}</Text>

        <View className="gap-1.5">
          <Text variant="label">Duration</Text>
          <SegmentedControl
            value={String(durationHours)}
            onValueChange={(v) => setDurationHours(Number(v))}
            options={DURATION_PRESETS.map((p) => ({ label: p.label, value: String(p.hours) }))}
          />
        </View>

        {type === 'double_points' ? (
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text variant="label">Multiplier</Text>
              <Text variant="caption">{multiplierLabel(multiplierX10)} points while active</Text>
            </View>
            <Stepper value={multiplierX10} onValueChange={setMultiplierX10} min={11} max={30} step={1} />
          </View>
        ) : (
          <>
            {type === 'complete_count' || type === 'custom' ? (
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1">
                  <Text variant="label">Target</Text>
                  <Text variant="caption">Completions needed to win</Text>
                </View>
                <Stepper value={targetValue} onValueChange={setTargetValue} min={1} max={50} step={1} />
              </View>
            ) : null}
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1">
                <Text variant="label">Bonus points</Text>
                <Text variant="caption">Paid out on success</Text>
              </View>
              <Stepper value={bonusPoints} onValueChange={setBonusPoints} min={5} max={500} step={5} />
            </View>
          </>
        )}

        <Button label="Start challenge" loading={create.isPending} onPress={submit} />
      </Form>
    </Dialog>
  )
}

export default function ChallengesScreen() {
  const colors = useColors()
  const { orgId, ready, isLoading, features, can } = useHouseholdMode()
  const now = useNow()
  const [tab, setTab] = useState<'active' | 'past'>('active')
  const [createOpen, setCreateOpen] = useState(false)

  const activeQuery = useChallenges(orgId ?? '')
  const pastQuery = usePastChallenges(orgId ?? '')
  const query = tab === 'active' ? activeQuery : pastQuery

  // No active household → nudge to onboarding (mirrors the signed-out shape elsewhere).
  if (!orgId && !isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Challenges' }} />
        <PageWrapper className="pb-24">
          <EmptyState
            icon={Trophy}
            title="No household yet"
            description="Create or join a household to run bonus challenges."
            action={<Button label="Get started" onPress={() => router.push('/onboarding')} />}
          />
        </PageWrapper>
      </>
    )
  }

  // Mode-gated: roommate mode (and any mode) with bonusChallenges off gets a friendly empty state.
  if (ready && features && !features.bonusChallenges) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Challenges' }} />
        <PageWrapper className="pb-24">
          <EmptyState
            icon={Trophy}
            title="Challenges aren't available"
            description="Bonus challenges aren't part of this household's setup."
          />
        </PageWrapper>
      </>
    )
  }

  const canCreate = can('challenge:create')

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Challenges' }} />
      <PageWrapper className="pb-24" onRefresh={() => query.refetch()}>
        {!ready ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : (
          <>
            <View className="gap-1">
              <View className="flex-row items-center gap-2">
                <Trophy size={22} color={colors.brand} />
                <Text variant="h1">Challenges</Text>
              </View>
              <Text variant="muted">Time-boxed sprints that boost points across the household.</Text>
            </View>

            <SegmentedControl
              value={tab}
              onValueChange={(v) => setTab(v as 'active' | 'past')}
              options={[
                { label: 'Active', value: 'active' },
                { label: 'Past', value: 'past' },
              ]}
            />

            <AsyncBoundary
              query={query}
              isEmpty={(query.data?.length ?? 0) === 0}
              empty={
                <EmptyState
                  icon={tab === 'active' ? Zap : Clock}
                  title={tab === 'active' ? 'No active challenges' : 'No past challenges'}
                  description={
                    tab === 'active'
                      ? canCreate
                        ? 'Start one to give everyone a points boost.'
                        : 'Check back when a household admin starts one.'
                      : 'Finished challenges will show up here.'
                  }
                  action={
                    tab === 'active' && canCreate ? (
                      <Button label="New challenge" icon={Plus} onPress={() => setCreateOpen(true)} />
                    ) : undefined
                  }
                />
              }
            >
              <View className="gap-3">
                {(query.data ?? []).map((challenge) =>
                  tab === 'active' ? (
                    <ActiveChallengeCard key={challenge.id} challenge={challenge} now={now} />
                  ) : (
                    <PastChallengeCard key={challenge.id} challenge={challenge} />
                  ),
                )}
              </View>
            </AsyncBoundary>
          </>
        )}
      </PageWrapper>

      {ready && canCreate ? <FAB icon={Plus} onPress={() => setCreateOpen(true)} accessibilityLabel="New challenge" /> : null}

      {orgId && canCreate ? (
        <CreateChallengeDialog orgId={orgId} visible={createOpen} onClose={() => setCreateOpen(false)} />
      ) : null}
    </>
  )
}
