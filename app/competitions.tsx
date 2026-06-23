import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { Swords, Lock, Trophy, Plus, Check, X } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Stepper } from '@/components/ui/stepper'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { FAB } from '@/components/ui/fab'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { accentHex } from '@/lib/manyhandz/accents'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHousehold, useHouseholdMembers, type HouseholdMember } from '@/lib/query/hooks/useHousehold'
import {
  useCompetitions,
  useCreateCompetition,
  useAcceptCompetition,
  useDeclineCompetition,
  type CompetitionStatusFilter,
  type CompetitionType,
  type CompetitionInput,
} from '@/lib/query/hooks/useCompetitions'
import type { Competition } from '@/lib/db/schema'

/**
 * Competitions — head-to-head challenges. Active / Pending / Past tabs, a "VS" card per matchup
 * (two avatars, live challenger-vs-opponent scores, a countdown), and a gated create flow. The
 * whole screen is behind the `headToHead` feature flag; creating is additionally gated on
 * `can('createCompetitions')` (kids also need the household toggle + a stakes cap). The opponent of
 * a pending challenge can accept or decline it.
 */

const TYPE_OPTIONS: { label: string; value: CompetitionType }[] = [
  { label: 'Most points', value: 'most_points' },
  { label: 'Most completions', value: 'most_completions' },
  { label: 'First to target', value: 'first_to_target' },
  { label: 'Chore race', value: 'specific_chore_race' },
]
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]))
const DURATION_OPTIONS = [
  { label: '1 day', value: '1' },
  { label: '3 days', value: '3' },
  { label: '1 week', value: '7' },
  { label: '2 weeks', value: '14' },
]

/** "2d 4h left" / "12h left" / "Ended" from an ISO end timestamp. */
function countdown(endsAt: string | Date): string {
  const ms = new Date(endsAt).getTime() - Date.now()
  if (ms <= 0) return 'Ended'
  const h = Math.floor(ms / 3_600_000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`
  if (h >= 1) return `${h}h left`
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`
}

function memberOf(members: HouseholdMember[] | undefined, id: string): HouseholdMember | undefined {
  return members?.find((m) => m.memberId === id)
}

function Side({ member, score, won }: { member?: HouseholdMember; score: number; won: boolean }) {
  return (
    <View className="flex-1 items-center gap-2">
      <View className="rounded-full p-0.5" style={{ borderWidth: 2, borderColor: accentHex(member?.favoriteColor) }}>
        <Avatar uri={member?.avatarUrl ?? undefined} name={member?.displayName} size={56} />
      </View>
      <Text variant="label" numberOfLines={1} className="max-w-24 text-center">
        {member?.displayName ?? 'Member'}
      </Text>
      <Text variant="h2" style={won ? { color: accentHex(member?.favoriteColor) } : undefined}>
        {score}
      </Text>
    </View>
  )
}

function VsCard({
  comp,
  members,
  viewerId,
  onAccept,
  onDecline,
  busy,
}: {
  comp: Competition
  members: HouseholdMember[] | undefined
  viewerId: string | undefined
  onAccept?: () => void
  onDecline?: () => void
  busy?: boolean
}) {
  const colors = useColors()
  const challenger = memberOf(members, comp.challengerMemberId)
  const opponent = memberOf(members, comp.opponentMemberId)
  const ended = comp.status === 'completed' || comp.status === 'expired' || comp.status === 'declined'
  const cScore = comp.challengerProgress
  const oScore = comp.opponentProgress
  const viewerIsOpponent = viewerId === comp.opponentMemberId
  const pendingForViewer = comp.status === 'pending' && viewerIsOpponent

  const statusBadge =
    comp.status === 'active' ? (
      <Badge variant="success" label="Active" />
    ) : comp.status === 'pending' ? (
      <Badge variant="warning" label="Pending" />
    ) : comp.status === 'declined' ? (
      <Badge variant="outline" label="Declined" />
    ) : comp.status === 'expired' ? (
      <Badge variant="outline" label="Expired" />
    ) : (
      <Badge variant="secondary" label="Finished" />
    )

  return (
    <Card>
      <CardContent className="gap-4">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-0.5">
            <Text variant="label">{comp.title}</Text>
            <Text variant="caption">{TYPE_LABEL[comp.competitionType] ?? comp.competitionType}</Text>
          </View>
          {statusBadge}
        </View>

        <View className="flex-row items-center">
          <Side member={challenger} score={cScore} won={ended && comp.winnerMemberId === comp.challengerMemberId} />
          <View className="items-center gap-1 px-2">
            <Swords color={colors.mutedForeground} size={22} />
            <Text variant="caption">VS</Text>
          </View>
          <Side member={opponent} score={oScore} won={ended && comp.winnerMemberId === comp.opponentMemberId} />
        </View>

        <View className="flex-row items-center justify-center gap-2">
          {comp.stakesPoints > 0 ? <Badge variant="outline" label={`${comp.stakesPoints} pts`} /> : null}
          <Text variant="caption">
            {ended ? (comp.status === 'completed' ? 'Final' : statusLabel(comp.status)) : countdown(comp.endsAt)}
          </Text>
        </View>

        {comp.stakesDescription ? (
          <View className="rounded-md bg-accent px-3 py-2">
            <Text variant="caption">Prize: {comp.stakesDescription}</Text>
          </View>
        ) : null}

        {pendingForViewer ? (
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              variant="outline"
              icon={X}
              label="Decline"
              disabled={busy}
              onPress={onDecline}
            />
            <Button className="flex-1" icon={Check} label="Accept" loading={busy} onPress={onAccept} />
          </View>
        ) : comp.status === 'pending' ? (
          <Text variant="caption" className="text-center">
            Waiting for {opponent?.displayName ?? 'opponent'} to respond
          </Text>
        ) : null}
      </CardContent>
    </Card>
  )
}

function statusLabel(status: string): string {
  if (status === 'declined') return 'Declined'
  if (status === 'expired') return 'Expired'
  return status
}

function CreateDialog({
  visible,
  onClose,
  orgId,
  viewerId,
  members,
  maxStakes,
}: {
  visible: boolean
  onClose: () => void
  orgId: string
  viewerId: string | undefined
  members: HouseholdMember[] | undefined
  /** Effective stakes ceiling for THIS member (kids capped by the household, adults uncapped). */
  maxStakes: number
}) {
  const { toast } = useToast()
  const create = useCreateCompetition(orgId)
  const [opponentId, setOpponentId] = useState('')
  const [type, setType] = useState<CompetitionType>('most_points')
  const [duration, setDuration] = useState('7')
  const [target, setTarget] = useState('')
  const [stakes, setStakes] = useState(0)
  const [note, setNote] = useState('')

  const opponentOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.memberId !== viewerId && m.isActive)
        .map((m) => ({ label: m.displayName, value: m.memberId })),
    [members, viewerId],
  )
  const needsTarget = type === 'first_to_target'
  const effectiveMax = maxStakes

  const reset = () => {
    setOpponentId('')
    setType('most_points')
    setDuration('7')
    setTarget('')
    setStakes(0)
    setNote('')
  }

  const submit = () => {
    if (!opponentId) {
      toast({ title: 'Pick an opponent', variant: 'error' })
      return
    }
    if (needsTarget && (!target || Number(target) <= 0)) {
      toast({ title: 'Set a target to race to', variant: 'error' })
      return
    }
    const days = Number(duration)
    const input: CompetitionInput = {
      opponentMemberId: opponentId,
      title: `${TYPE_LABEL[type]} challenge`,
      competitionType: type,
      targetValue: needsTarget ? Number(target) : null,
      stakesPoints: Math.min(stakes, effectiveMax),
      stakesDescription: note.trim() || null,
      endsAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    }
    create.mutate(input, {
      onSuccess: () => {
        toast({ title: 'Challenge sent', variant: 'success' })
        reset()
        onClose()
      },
      onError: (e) =>
        toast({ title: "Couldn't create challenge", description: (e as Error).message, variant: 'error' }),
    })
  }

  return (
    <Dialog visible={visible} onClose={onClose} title="New challenge" className="max-w-md gap-4">
      <Form onSubmit={submit} className="gap-4">
        <Select
          label="Opponent"
          placeholder="Choose who to challenge"
          options={opponentOptions}
          value={opponentId}
          onValueChange={setOpponentId}
          searchable={opponentOptions.length > 8}
        />

        <View className="gap-1.5">
          <Text variant="label">Type</Text>
          <Select options={TYPE_OPTIONS} value={type} onValueChange={(v) => setType(v as CompetitionType)} />
        </View>

        {needsTarget ? (
          <Input
            label="Target"
            placeholder="e.g. 20"
            keyboardType="number-pad"
            value={target}
            onChangeText={setTarget}
          />
        ) : null}

        <View className="gap-1.5">
          <Text variant="label">Duration</Text>
          <SegmentedControl options={DURATION_OPTIONS} value={duration} onValueChange={setDuration} />
        </View>

        <View className="gap-1.5">
          <Text variant="label">Point stakes</Text>
          <View className="flex-row items-center justify-between gap-3">
            <Stepper value={stakes} onValueChange={setStakes} min={0} max={effectiveMax} step={5} />
            <Text variant="caption" className="flex-1">
              {effectiveMax === 0 ? 'No stakes available' : `Up to ${effectiveMax} pts wagered`}
            </Text>
          </View>
        </View>

        <Textarea
          label="Real-world prize (optional)"
          placeholder="Loser does the dishes for a week"
          rows={2}
          value={note}
          onChangeText={setNote}
        />

        <Button label="Send challenge" loading={create.isPending} onPress={submit} />
      </Form>
    </Dialog>
  )
}

export default function CompetitionsScreen() {
  const { orgId, ready, mode, role, features, can } = useHouseholdMode()
  const household = useHousehold(orgId ?? '')
  const viewerId = household.data?.me.memberId
  const members = useHouseholdMembers(orgId ?? '')

  const [tab, setTab] = useState<CompetitionStatusFilter>('active')
  const [createOpen, setCreateOpen] = useState(false)
  const comps = useCompetitions(orgId ?? '', tab)
  const accept = useAcceptCompetition(orgId ?? '')
  const decline = useDeclineCompetition(orgId ?? '')

  const featureOff = ready && !features?.headToHead
  const canCreate = can('createCompetitions')
  // Kids are capped by the household policy; everyone else can wager up to their own balance.
  const viewerPoints = members.data?.find((m) => m.memberId === viewerId)?.pointsBalance ?? 0
  const isKid = mode === 'family' && role === 'kid'
  const kidCap = household.data?.household.maxKidCompetitionStakes ?? 0
  const maxStakes = isKid ? Math.min(kidCap, viewerPoints || kidCap) : viewerPoints

  const header = <Stack.Screen options={{ headerShown: true, title: 'Competitions' }} />

  if (!ready || household.isLoading) {
    return (
      <>
        {header}
        <PageWrapper>
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        </PageWrapper>
      </>
    )
  }

  if (featureOff) {
    return (
      <>
        {header}
        <PageWrapper>
          <EmptyState
            icon={Lock}
            title="Competitions are off"
            description="Head-to-head challenges aren't part of this household's setup."
          />
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      {header}
      <PageWrapper className="pb-24" onRefresh={() => comps.refetch()}>
        <SegmentedControl
          value={tab}
          onValueChange={(v) => setTab(v as CompetitionStatusFilter)}
          options={[
            { label: 'Active', value: 'active' },
            { label: 'Pending', value: 'pending' },
            { label: 'Past', value: 'past' },
          ]}
        />

        {comps.isLoading ? (
          <View className="items-center py-16">
            <Spinner size="large" />
          </View>
        ) : comps.isError ? (
          <EmptyState
            icon={Swords}
            title="Couldn't load competitions"
            description="Something went wrong. Pull to refresh to try again."
            action={<Button label="Retry" onPress={() => comps.refetch()} />}
          />
        ) : !comps.data || comps.data.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title={
              tab === 'active' ? 'No active competitions' : tab === 'pending' ? 'Nothing pending' : 'No past competitions'
            }
            description={
              canCreate && tab === 'active'
                ? 'Challenge a housemate to a head-to-head and put some points on the line.'
                : 'Competitions will show up here once they get going.'
            }
            action={
              canCreate && tab === 'active' ? (
                <Button icon={Plus} label="New challenge" onPress={() => setCreateOpen(true)} />
              ) : undefined
            }
          />
        ) : (
          <View className="gap-3">
            {comps.data.map((comp) => {
              const isPendingTarget = comp.status === 'pending' && comp.opponentMemberId === viewerId
              return (
                <VsCard
                  key={comp.id}
                  comp={comp}
                  members={members.data}
                  viewerId={viewerId}
                  busy={isPendingTarget && (accept.isPending || decline.isPending)}
                  onAccept={() => accept.mutate(comp.id)}
                  onDecline={() => decline.mutate(comp.id)}
                />
              )
            })}
          </View>
        )}
      </PageWrapper>

      {canCreate ? (
        <FAB icon={Plus} accessibilityLabel="New challenge" onPress={() => setCreateOpen(true)} />
      ) : null}

      {canCreate && orgId ? (
        <CreateDialog
          visible={createOpen}
          onClose={() => setCreateOpen(false)}
          orgId={orgId}
          viewerId={viewerId}
          members={members.data}
          maxStakes={maxStakes}
        />
      ) : null}
    </>
  )
}
