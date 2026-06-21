import { useState } from 'react'
import { View, Pressable, ScrollView } from 'react-native'
import { router, Stack } from 'expo-router'
import { Plus, X } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Rating } from '@/components/ui/rating'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useSession } from '@/lib/auth/client'
import { useCreateChore, useChoreCategories, type ChoreChecklistStep } from '@/lib/query/hooks/useChores'
import { CHORE_ICON_KEYS, iconFor } from '@/lib/manyhandz/icons'

/**
 * New chore — the create form (pairs with the list at app/chores/index.tsx and the detail/edit at
 * app/chores/[id].tsx). A FORM route: the last path segment is `new`, so the product nav auto-hides
 * (isNavHidden). Gated on can('createChores') — a member without the permission gets a friendly
 * block instead of the form. Difficulty renders as stars or Easy/Medium/Hard per ui.difficultyDisplay,
 * the AI-verification toggle only shows when features.aiVerification is on. The same field block is
 * reused by the detail screen's edit mode; extract a shared <ChoreForm> at the third usage.
 */

const NONE = '__none__'

export default function NewChoreScreen() {
  const { toast } = useToast()
  const { data: session, isPending: sessionPending } = useSession()
  const { orgId, ui, features, can } = useHouseholdMode()
  const createChore = useCreateChore(orgId ?? '')
  const categoriesQuery = useChoreCategories(orgId ?? '')

  const canCreate = can('createChores')
  const showStars = ui?.difficultyDisplay === 'stars'
  const showAi = features?.aiVerification ?? false

  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const [categoryId, setCategoryId] = useState<string>(NONE)
  const [difficulty, setDifficulty] = useState(3)
  const [minutes, setMinutes] = useState(15)
  const [icon, setIcon] = useState<string>('sparkles')
  const [checklist, setChecklist] = useState<ChoreChecklistStep[]>([])
  const [requiresApproval, setRequiresApproval] = useState(true)
  const [aiVerification, setAiVerification] = useState(false)

  const categoryOptions = [
    { label: 'No category', value: NONE },
    ...(categoriesQuery.data ?? []).map((c) => ({ label: c.name, value: c.id })),
  ]

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Give the chore a name.')
      return
    }
    createChore.mutate(
      {
        name: trimmed,
        categoryId: categoryId === NONE ? null : categoryId,
        difficulty,
        estimatedMinutes: minutes,
        icon,
        checklist: checklist.filter((s) => s.label.trim().length > 0),
        requiresApproval,
        aiVerificationEnabled: showAi ? aiVerification : false,
      },
      {
        onSuccess: (row) => {
          toast({ title: 'Chore created', variant: 'success' })
          // replace, not push — Back from the new detail should skip this spent form.
          router.replace({ pathname: '/chores/[id]', params: { id: row.id } })
        },
        onError: () => toast({ title: "Couldn't create chore", variant: 'error' }),
      },
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'New chore' }} />
      <PageWrapper width="form" className="gap-5 pb-16">
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            title="You're signed out"
            description="Sign in to add a chore."
            action={<Button label="Sign in" onPress={() => router.push('/login')} />}
          />
        ) : !canCreate ? (
          <EmptyState
            title="Only admins can add chores"
            description="Ask a parent or household admin to create new chores."
            action={
              <Button
                variant="outline"
                label="Back"
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/chores'))}
              />
            }
          />
        ) : (
          <>
            <Card>
              <CardContent className="gap-5">
                <Input
                  label="Name"
                  placeholder="Take out the trash"
                  value={name}
                  onChangeText={(text) => {
                    setName(text)
                    if (nameError) setNameError(undefined)
                  }}
                  error={nameError}
                  maxLength={120}
                  autoFocus
                />

                <Select
                  label="Category"
                  placeholder="No category"
                  options={categoryOptions}
                  value={categoryId}
                  onValueChange={setCategoryId}
                />

                {/* Difficulty — stars for the playful family tone, Easy/Medium/Hard for roommate. */}
                <DifficultyField value={difficulty} onChange={setDifficulty} showStars={showStars} />

                {/* Estimated minutes — a 5–120 slider, stepped by 5; powers fairness weighting. */}
                <View className="gap-1.5">
                  <View className="flex-row items-center justify-between">
                    <Text variant="label">Estimated time</Text>
                    <Text variant="muted">{minutes} min</Text>
                  </View>
                  <Slider
                    value={minutes}
                    onValueChange={setMinutes}
                    min={5}
                    max={120}
                    step={5}
                    accessibilityLabel="Estimated minutes"
                  />
                </View>

                <IconPicker value={icon} onChange={setIcon} />
              </CardContent>
            </Card>

            <ChecklistEditor steps={checklist} onChange={setChecklist} />

            <Card>
              <CardContent className="gap-4">
                <ToggleRow
                  label="Requires approval"
                  hint="Completions need an admin's sign-off before points are awarded."
                  value={requiresApproval}
                  onValueChange={setRequiresApproval}
                />
                {showAi ? (
                  <ToggleRow
                    label="AI photo verification"
                    hint="Check before/after photos automatically when this chore is completed."
                    value={aiVerification}
                    onValueChange={setAiVerification}
                  />
                ) : null}
              </CardContent>
            </Card>

            <Button label="Create chore" loading={createChore.isPending} onPress={submit} />
            <Button
              variant="outline"
              label="Cancel"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/chores'))}
            />
          </>
        )}
      </PageWrapper>
    </>
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
  // Map the 1-5 scale onto three text buckets (Easy=2, Medium=3, Hard=5).
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
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text variant="label">Checklist</Text>
            <Text variant="caption">Break the chore into steps. Mark any that must be done.</Text>
          </View>
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
