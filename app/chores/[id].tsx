import { useEffect, useState } from 'react'
import { View, Pressable, ScrollView } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { Clock, Gauge, ListChecks, Pencil, Plus, RefreshCw, Tag, Trash2, UserPlus, X } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Rating } from '@/components/ui/rating'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { ApiError } from '@/lib/api/client'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useSession } from '@/lib/auth/client'
import {
  useChore,
  useUpdateChore,
  useDeleteChore,
  useChoreCategories,
  type ChoreChecklistStep,
} from '@/lib/query/hooks/useChores'
import { CHORE_ICON_KEYS, iconFor } from '@/lib/manyhandz/icons'
import { accentHex } from '@/lib/manyhandz/accents'
import { MemberPicker } from '@/components/ui/member-picker'
import { useCreateAssignment } from '@/lib/query/hooks/useAssignments'
import { useCreateRotation } from '@/lib/query/hooks/useRotations'
import { shiftDate } from '@/lib/manyhandz/dates'
import type { RotationFrequency } from '@/lib/manyhandz/rotation'
import type { Chore } from '@/lib/db/schema'

/**
 * Chore detail — read the fields + checklist, edit inline (entered via ?edit, reusing the create
 * form's field block from app/chores/new.tsx), and soft-delete behind a confirm Dialog. Edit/Delete
 * affordances are gated on can('chore:create'); a member without the permission sees a read-only
 * view. Difficulty renders per ui.difficultyDisplay; the AI-verification toggle only appears when
 * features.aiVerification is on. When a minted app grows a third copy of the field block, extract a
 * shared <ChoreForm> into src/components/.
 */

const NONE = '__none__'

type Draft = {
  name: string
  categoryId: string
  difficulty: number
  minutes: number
  icon: string
  checklist: ChoreChecklistStep[]
  requiresApproval: boolean
  aiVerification: boolean
}

function draftFrom(chore: Chore): Draft {
  return {
    name: chore.name,
    categoryId: chore.categoryId ?? NONE,
    difficulty: chore.difficulty,
    minutes: chore.estimatedMinutes,
    icon: chore.icon,
    checklist: chore.checklist ?? [],
    requiresApproval: chore.requiresApproval,
    aiVerification: chore.aiVerificationEnabled,
  }
}

function difficultyLabel(difficulty: number, display: 'stars' | 'text'): string {
  if (display === 'stars') return '★'.repeat(Math.max(1, Math.min(5, difficulty)))
  if (difficulty <= 2) return 'Easy'
  if (difficulty <= 3) return 'Medium'
  return 'Hard'
}

/** Today as YYYY-MM-DD in the device's local zone — the household member's own day. */
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Labeled icon row for read mode — the standard "field" presentation on a detail screen. */
function MetaRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  const colors = useColors()
  return (
    <View className="flex-row items-start gap-3">
      <View className="size-9 items-center justify-center rounded-full bg-accent">
        <Icon color={colors.mutedForeground} size={18} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="caption">{label}</Text>
        <Text variant="body">{value}</Text>
      </View>
    </View>
  )
}

function DetailSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
      <SkeletonText lines={3} />
    </View>
  )
}

export default function ChoreDetailScreen() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>()
  const choreId = typeof id === 'string' ? id : ''
  const { toast } = useToast()
  const { data: session, isPending: sessionPending } = useSession()
  const { orgId, ui, features, can } = useHouseholdMode()

  const query = useChore(orgId ?? '', choreId)
  const updateChore = useUpdateChore(orgId ?? '')
  const deleteChore = useDeleteChore(orgId ?? '')
  const categoriesQuery = useChoreCategories(orgId ?? '')
  const chore = query.data

  const canEdit = can('chore:create')
  const display = ui?.difficultyDisplay ?? 'text'
  const showStars = display === 'stars'
  const showAi = features?.aiVerification ?? false

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const startEditing = () => {
    if (!chore || !canEdit) return
    setDraft(draftFrom(chore))
    setNameError(undefined)
    setEditing(true)
  }

  // ?edit deep-links straight into edit mode once the row has loaded (and the caller may edit).
  useEffect(() => {
    if (edit === '1' && chore && canEdit && !editing) startEditing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, chore, canEdit])

  const patchDraft = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const categoryOptions = [
    { label: 'No category', value: NONE },
    ...(categoriesQuery.data ?? []).map((c) => ({ label: c.name, value: c.id })),
  ]
  const category = chore?.categoryId
    ? categoriesQuery.data?.find((c) => c.id === chore.categoryId)
    : undefined

  const save = () => {
    if (!chore || !draft) return
    const trimmed = draft.name.trim()
    if (!trimmed) {
      setNameError('Give the chore a name.')
      return
    }
    updateChore.mutate(
      {
        choreId: chore.id,
        input: {
          name: trimmed,
          categoryId: draft.categoryId === NONE ? null : draft.categoryId,
          difficulty: draft.difficulty,
          estimatedMinutes: draft.minutes,
          icon: draft.icon,
          checklist: draft.checklist.filter((s) => s.label.trim().length > 0),
          requiresApproval: draft.requiresApproval,
          aiVerificationEnabled: showAi ? draft.aiVerification : false,
        },
      },
      {
        onSuccess: () => toast({ title: 'Chore saved', variant: 'success' }),
        onError: () => toast({ title: "Couldn't save chore", variant: 'error' }),
      },
    )
    setEditing(false)
  }

  const confirmDelete = () => {
    deleteChore.mutate(choreId, {
      onSuccess: () => {
        setConfirmingDelete(false)
        toast({ title: 'Chore removed', variant: 'success' })
        if (router.canGoBack()) router.back()
        else router.replace('/chores')
      },
      onError: () => {
        setConfirmingDelete(false)
        toast({ title: "Couldn't remove chore", variant: 'error' })
      },
    })
  }

  // --- Assign + rotation: the "hand this chore to someone" flows (gated on assignChores) ---
  const canAssign = can('chore:assign')
  const createAssignment = useCreateAssignment(orgId ?? '')
  const createRotation = useCreateRotation(orgId ?? '')
  const today = todayLocal()
  const dueOptions = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: shiftDate(today, 1) },
    { label: 'In 3 days', value: shiftDate(today, 3) },
    { label: 'Next week', value: shiftDate(today, 7) },
  ]
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignMember, setAssignMember] = useState<string | null>(null)
  const [assignDue, setAssignDue] = useState(today)
  const [rotationOpen, setRotationOpen] = useState(false)
  const [rotMembers, setRotMembers] = useState<string[]>([])
  const [rotFreq, setRotFreq] = useState<RotationFrequency>('weekly')
  const [rotType, setRotType] = useState<'round_robin' | 'fixed'>('round_robin')

  const submitAssign = () => {
    if (!chore || !assignMember) return
    createAssignment.mutate(
      { choreId: chore.id, assignedToMemberId: assignMember, dueDate: assignDue },
      {
        onSuccess: () => {
          setAssignOpen(false)
          setAssignMember(null)
          toast({ title: 'Chore assigned', variant: 'success' })
        },
        onError: () => toast({ title: "Couldn't assign the chore", variant: 'error' }),
      },
    )
  }

  const submitRotation = () => {
    if (!chore || rotMembers.length === 0) return
    createRotation.mutate(
      { choreId: chore.id, memberOrder: rotMembers, frequency: rotFreq, rotationType: rotType, startDate: today },
      {
        onSuccess: () => {
          setRotationOpen(false)
          setRotMembers([])
          toast({ title: 'Rotation started — first turn assigned', variant: 'success' })
        },
        onError: () => toast({ title: "Couldn't set up the rotation", variant: 'error' }),
      },
    )
  }

  const notFound = query.error instanceof ApiError && query.error.status === 404
  const notFoundState = (
    <EmptyState
      icon={ListChecks}
      title="Chore not found"
      description="This chore may have been removed."
      action={
        <Button
          variant="outline"
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/chores'))}
        />
      }
    />
  )

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: editing ? 'Edit chore' : 'Chore' }} />
      <PageWrapper className="gap-5 pb-24" onRefresh={() => query.refetch()}>
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            title="You're signed out"
            description="Sign in to view this chore."
            action={<Button label="Sign in" onPress={() => router.push('/login')} />}
          />
        ) : notFound ? (
          notFoundState
        ) : (
          <AsyncBoundary query={query} loading={<DetailSkeleton />} isEmpty={!chore} empty={notFoundState}>
            {chore && !editing ? (
              <ReadMode
                chore={chore}
                categoryName={category?.name}
                categoryColor={accentHex(category?.color)}
                difficulty={difficultyLabel(chore.difficulty, display)}
                showAi={showAi}
                canEdit={canEdit}
                canAssign={canAssign}
                onAssign={() => setAssignOpen(true)}
                onRotate={() => setRotationOpen(true)}
                onEdit={startEditing}
                onDelete={() => setConfirmingDelete(true)}
              />
            ) : chore && draft ? (
              <Form onSubmit={save} className="gap-5">
                <Card>
                  <CardContent className="gap-5">
                    <Input
                      label="Name"
                      placeholder="Take out the trash"
                      value={draft.name}
                      onChangeText={(text) => {
                        patchDraft({ name: text })
                        if (nameError) setNameError(undefined)
                      }}
                      error={nameError}
                      maxLength={120}
                    />

                    <Select
                      label="Category"
                      placeholder="No category"
                      options={categoryOptions}
                      value={draft.categoryId}
                      onValueChange={(v) => patchDraft({ categoryId: v })}
                    />

                    <DifficultyField
                      value={draft.difficulty}
                      onChange={(v) => patchDraft({ difficulty: v })}
                      showStars={showStars}
                    />

                    <View className="gap-1.5">
                      <View className="flex-row items-center justify-between">
                        <Text variant="label">Estimated time</Text>
                        <Text variant="muted">{draft.minutes} min</Text>
                      </View>
                      <Slider
                        value={draft.minutes}
                        onValueChange={(v) => patchDraft({ minutes: v })}
                        min={5}
                        max={120}
                        step={5}
                        accessibilityLabel="Estimated minutes"
                      />
                    </View>

                    <IconPicker value={draft.icon} onChange={(v) => patchDraft({ icon: v })} />
                  </CardContent>
                </Card>

                <ChecklistEditor
                  steps={draft.checklist}
                  onChange={(steps) => patchDraft({ checklist: steps })}
                />

                <Card>
                  <CardContent className="gap-4">
                    <ToggleRow
                      label="Requires approval"
                      hint="Completions need an admin's sign-off before points are awarded."
                      value={draft.requiresApproval}
                      onValueChange={(v) => patchDraft({ requiresApproval: v })}
                    />
                    {showAi ? (
                      <ToggleRow
                        label="AI photo verification"
                        hint="Check before/after photos automatically on completion."
                        value={draft.aiVerification}
                        onValueChange={(v) => patchDraft({ aiVerification: v })}
                      />
                    ) : null}
                  </CardContent>
                </Card>

                <Button label="Save" loading={updateChore.isPending} onPress={save} />
                <Button variant="outline" label="Cancel" onPress={() => setEditing(false)} />
              </Form>
            ) : null}
          </AsyncBoundary>
        )}
      </PageWrapper>

      <Dialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Remove this chore?"
        description="It will be archived and stop appearing in the library. Existing history is kept."
      >
        <View className="flex-row justify-end gap-3 pt-1">
          <Button variant="outline" label="Cancel" onPress={() => setConfirmingDelete(false)} />
          <Button
            variant="destructive"
            label="Remove"
            loading={deleteChore.isPending}
            onPress={confirmDelete}
          />
        </View>
      </Dialog>

      {/* Assign — pick a member + due date. The chassis MemberPicker sources the household roster. */}
      <Dialog
        visible={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Assign this chore"
        description="Choose who's doing it and when it's due."
      >
        <View className="gap-4 pt-1">
          <MemberPicker orgId={orgId ?? ''} label="Assign to" value={assignMember} onChange={setAssignMember} />
          <Select label="Due" options={dueOptions} value={assignDue} onValueChange={setAssignDue} />
          <View className="flex-row justify-end gap-3">
            <Button variant="outline" label="Cancel" onPress={() => setAssignOpen(false)} />
            <Button label="Assign" loading={createAssignment.isPending} disabled={!assignMember} onPress={submitAssign} />
          </View>
        </View>
      </Dialog>

      {/* Set up rotation — order the members + a cadence; the engine skips whoever's away. */}
      <Dialog
        visible={rotationOpen}
        onClose={() => setRotationOpen(false)}
        title="Set up a rotation"
        description="It rotates automatically each period and skips anyone who's away."
      >
        <View className="gap-4 pt-1">
          <MemberPicker
            orgId={orgId ?? ''}
            label="Members (in turn order)"
            placeholder="Pick who's in the rotation"
            multiple
            values={rotMembers}
            onValuesChange={setRotMembers}
          />
          <Select
            label="How often"
            options={[
              { label: 'Daily', value: 'daily' },
              { label: 'Weekly', value: 'weekly' },
              { label: 'Every 2 weeks', value: 'biweekly' },
              { label: 'Monthly', value: 'monthly' },
            ]}
            value={rotFreq}
            onValueChange={(v) => setRotFreq(v as RotationFrequency)}
          />
          <View className="gap-1.5">
            <Text variant="label">Style</Text>
            <SegmentedControl
              value={rotType}
              onValueChange={(v) => setRotType(v as 'round_robin' | 'fixed')}
              options={[
                { label: 'Take turns', value: 'round_robin' },
                { label: 'Always same', value: 'fixed' },
              ]}
            />
          </View>
          <View className="flex-row justify-end gap-3">
            <Button variant="outline" label="Cancel" onPress={() => setRotationOpen(false)} />
            <Button label="Start rotation" loading={createRotation.isPending} disabled={rotMembers.length === 0} onPress={submitRotation} />
          </View>
        </View>
      </Dialog>
    </>
  )
}

/** Read mode — the header, the meta rows, the checklist, and (for admins) the action row. */
function ReadMode({
  chore,
  categoryName,
  categoryColor,
  difficulty,
  showAi,
  canEdit,
  canAssign,
  onAssign,
  onRotate,
  onEdit,
  onDelete,
}: {
  chore: Chore
  categoryName: string | undefined
  categoryColor: string
  difficulty: string
  showAi: boolean
  canEdit: boolean
  canAssign: boolean
  onAssign: () => void
  onRotate: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const Icon = iconFor(chore.icon)
  return (
    <>
      <View className="flex-row items-center gap-3">
        <View
          className="size-12 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${categoryColor}22` }}
        >
          <Icon color={categoryColor} size={26} />
        </View>
        <Text variant="h2" className="flex-1">
          {chore.name}
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {chore.requiresApproval ? <Badge variant="secondary" label="Needs approval" /> : null}
        {showAi && chore.aiVerificationEnabled ? <Badge variant="default" label="AI verified" /> : null}
      </View>

      <Card>
        <CardContent className="gap-4">
          {categoryName ? <MetaRow icon={Tag} label="Category" value={categoryName} /> : null}
          <MetaRow icon={Gauge} label="Difficulty" value={difficulty} />
          <MetaRow icon={Clock} label="Estimated time" value={`${chore.estimatedMinutes} min`} />
        </CardContent>
      </Card>

      <ChecklistView steps={chore.checklist ?? []} />

      {canAssign ? (
        <Card>
          <CardContent className="gap-3">
            <View>
              <Text variant="label">Put it to work</Text>
              <Text variant="caption">Hand this chore to someone, or set it to rotate automatically.</Text>
            </View>
            <View className="flex-row flex-wrap gap-3">
              <Button variant="outline" icon={UserPlus} label="Assign" onPress={onAssign} />
              <Button variant="outline" icon={RefreshCw} label="Set up rotation" onPress={onRotate} />
            </View>
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <View className="flex-row flex-wrap gap-3">
          <Button variant="outline" icon={Pencil} label="Edit" onPress={onEdit} />
          <Button variant="destructive" icon={Trash2} label="Delete" onPress={onDelete} />
        </View>
      ) : null}
    </>
  )
}

/** Read-only checklist — numbered steps with a "required" tag. */
function ChecklistView({ steps }: { steps: ChoreChecklistStep[] }) {
  const colors = useColors()
  if (steps.length === 0) {
    return (
      <Card>
        <CardContent className="flex-row items-center gap-3">
          <ListChecks color={colors.mutedForeground} size={18} />
          <Text variant="muted">No checklist steps.</Text>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="gap-3">
        <Text variant="label">Checklist</Text>
        {steps.map((step, index) => (
          <View key={index} className="flex-row items-center gap-3">
            <View className="size-6 items-center justify-center rounded-full bg-accent">
              <Text variant="caption">{index + 1}</Text>
            </View>
            <Text variant="body" className="flex-1">
              {step.label}
            </Text>
            {step.required ? <Badge variant="outline" label="Required" /> : null}
          </View>
        ))}
      </CardContent>
    </Card>
  )
}

/** Difficulty selector — stars (family) or an Easy/Medium/Hard segmented control (roommate). */
function DifficultyField({
  value,
  onChange,
  showStars,
}: {
  value: number
  onChange: (value: number) => void
  showStars: boolean
}) {
  if (showStars) {
    return (
      <View className="gap-1.5">
        <Text variant="label">Difficulty</Text>
        <Rating value={value} onValueChange={onChange} max={5} size={28} />
      </View>
    )
  }
  const bucket = value <= 2 ? 'easy' : value <= 3 ? 'medium' : 'hard'
  return (
    <View className="gap-1.5">
      <Text variant="label">Difficulty</Text>
      <SegmentedControl
        value={bucket}
        onValueChange={(v) => onChange(v === 'easy' ? 2 : v === 'medium' ? 3 : 5)}
        options={[
          { label: 'Easy', value: 'easy' },
          { label: 'Medium', value: 'medium' },
          { label: 'Hard', value: 'hard' },
        ]}
      />
    </View>
  )
}

/** Icon picker — a horizontal swatch row of CHORE_ICON_KEYS; the selected key highlights. */
function IconPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const colors = useColors()
  return (
    <View className="gap-1.5">
      <Text variant="label">Icon</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 py-1"
        keyboardShouldPersistTaps="handled"
      >
        {CHORE_ICON_KEYS.map((key) => {
          const Icon = iconFor(key)
          const active = key === value
          return (
            <Pressable
              key={key}
              onPress={() => onChange(key)}
              accessibilityRole="button"
              accessibilityLabel={`Icon ${key}`}
              accessibilityState={{ selected: active }}
              className={
                active
                  ? 'size-11 items-center justify-center rounded-xl border-2 border-primary bg-primary/10'
                  : 'size-11 items-center justify-center rounded-xl border border-border bg-card active:bg-accent'
              }
            >
              <Icon color={active ? colors.primary : colors.mutedForeground} size={20} />
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

/** Inline checklist editor — add/remove steps, each with a label + a "required" toggle. */
function ChecklistEditor({
  steps,
  onChange,
}: {
  steps: ChoreChecklistStep[]
  onChange: (steps: ChoreChecklistStep[]) => void
}) {
  const colors = useColors()
  const add = () => onChange([...steps, { label: '', required: false }])
  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index))
  const patch = (index: number, patch: Partial<ChoreChecklistStep>) =>
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  return (
    <Card>
      <CardContent className="gap-4">
        <View>
          <Text variant="label">Checklist</Text>
          <Text variant="caption">Break the chore into steps. Mark any that must be done.</Text>
        </View>

        {steps.length === 0 ? (
          <Text variant="muted">No steps yet.</Text>
        ) : (
          <View className="gap-3">
            {steps.map((step, index) => (
              <View key={index} className="gap-2 rounded-lg border border-border bg-background p-3">
                <View className="flex-row items-center gap-2">
                  <Input
                    containerClassName="flex-1"
                    placeholder={`Step ${index + 1}`}
                    value={step.label}
                    onChangeText={(text) => patch(index, { label: text })}
                    maxLength={120}
                    // Enter adds another step rather than submitting the whole chore (an explicit
                    // onSubmitEditing wins over the enclosing <Form>'s web Enter-to-submit).
                    onSubmitEditing={add}
                  />
                  <Pressable
                    onPress={() => remove(index)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove step ${index + 1}`}
                    className="size-10 items-center justify-center rounded-md active:bg-accent"
                  >
                    <X color={colors.mutedForeground} size={18} />
                  </Pressable>
                </View>
                <View className="flex-row items-center justify-between">
                  <Text variant="caption">Required</Text>
                  <Switch
                    value={step.required}
                    onValueChange={(v) => patch(index, { required: v })}
                    accessibilityLabel={`Step ${index + 1} required`}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        <Button variant="outline" size="sm" icon={Plus} label="Add step" onPress={add} className="self-start" />
      </CardContent>
    </Card>
  )
}

/** A labeled left-aligned description + a right-aligned Switch — the canonical setting row. */
function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string
  hint: string
  value: boolean
  onValueChange: (value: boolean) => void
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1">
        <Text variant="label">{label}</Text>
        <Text variant="caption">{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label} />
    </View>
  )
}
