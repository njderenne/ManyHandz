import { useMemo, useState } from 'react'
import { View, Pressable, ScrollView } from 'react-native'
import { Stack } from 'expo-router'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  X,
  ShoppingCart,
  UtensilsCrossed,
} from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import {
  MEAL_TYPES,
  useMealPlan,
  useCreateMealEntry,
  useUpdateMealEntry,
  useDeleteMealEntry,
  useGenerateGroceryList,
  type MealType,
  type MealIngredient,
  type MealEntryInput,
} from '@/lib/query/hooks/useMeals'
import { useShoppingLists } from '@/lib/query/hooks/useShopping'
import type { MealPlanEntry } from '@/lib/db/schema'

/**
 * Meals — the household's weekly meal calendar (PROMOTED feature; mirrors Shopping). A 7-day grid
 * crossed with the four meal types: every member reads AND writes the plan (the Worker gates writes
 * on membership, so there's no feature flag or permission gate — only the universal "signed-in + has
 * a household" gate). Add/edit an entry (title, meal type, notes, recipe URL, ingredients), then
 * "Generate grocery list" pushes the week's ingredients into a chosen shopping list.
 */

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Monday (YYYY-MM-DD) of the week containing `base` — the plan is keyed by week start. */
function mondayOf(base: Date): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const dow = (d.getDay() + 6) % 7 // 0 = Monday
  d.setDate(d.getDate() - dow)
  return toYmd(d)
}

function toYmd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** The seven YYYY-MM-DD dates of the week starting Monday `weekStart`. */
function weekDates(weekStart: string): string[] {
  const start = parseYmd(weekStart)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return toYmd(d)
  })
}

function addWeeks(weekStart: string, delta: number): string {
  const d = parseYmd(weekStart)
  d.setDate(d.getDate() + delta * 7)
  return toYmd(d)
}

function weekLabel(weekStart: string): string {
  const start = parseYmd(weekStart)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

export default function MealsScreen() {
  const { orgId, ready, isLoading } = useHouseholdMode()

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Meal Plan' }} />
      <PageWrapper className="gap-5 pb-28">
        {isLoading ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !orgId || !ready ? (
          <EmptyState
            icon={UtensilsCrossed}
            title="Join a household first"
            description="The weekly meal plan lives in a household. Create or join one to start planning."
          />
        ) : (
          <MealBoard orgId={orgId} />
        )}
      </PageWrapper>
    </>
  )
}

/** The live calendar once we know the household: week navigator + grid + the two dialogs. */
function MealBoard({ orgId }: { orgId: string }) {
  const colors = useColors()
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const plan = useMealPlan(orgId, weekStart)
  const deleteEntry = useDeleteMealEntry(orgId, weekStart)

  const [editing, setEditing] = useState<{ date: string; entry: MealPlanEntry | null } | null>(null)
  const [groceryOpen, setGroceryOpen] = useState(false)

  const thisWeek = mondayOf(new Date())
  const dates = useMemo(() => weekDates(weekStart), [weekStart])

  const byDate = useMemo(() => {
    const map = new Map<string, MealPlanEntry[]>()
    for (const e of plan.data ?? []) {
      const bucket = map.get(e.date) ?? []
      bucket.push(e)
      map.set(e.date, bucket)
    }
    return map
  }, [plan.data])

  const entryCount = plan.data?.length ?? 0

  return (
    <View className="gap-5">
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => setWeekStart((w) => addWeeks(w, -1))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          className="size-9 items-center justify-center rounded-full active:bg-accent"
        >
          <ChevronLeft color={colors.foreground} size={22} />
        </Pressable>
        <Pressable
          onPress={() => setWeekStart(thisWeek)}
          accessibilityRole="button"
          accessibilityLabel="Jump to this week"
          className="items-center px-2 active:opacity-70"
        >
          <Text variant="label">{weekLabel(weekStart)}</Text>
          {weekStart !== thisWeek ? <Text variant="caption">Tap for this week</Text> : null}
        </Pressable>
        <Pressable
          onPress={() => setWeekStart((w) => addWeeks(w, 1))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next week"
          className="size-9 items-center justify-center rounded-full active:bg-accent"
        >
          <ChevronRight color={colors.foreground} size={22} />
        </Pressable>
      </View>

      <Button
        variant="outline"
        icon={ShoppingCart}
        label="Generate grocery list"
        disabled={entryCount === 0}
        onPress={() => setGroceryOpen(true)}
      />

      {plan.isLoading ? (
        <View className="items-center py-16">
          <Spinner size="large" />
        </View>
      ) : plan.isError ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="Couldn't load the plan"
          description="Check your connection and try again."
          action={<Button size="sm" variant="outline" label="Retry" onPress={() => plan.refetch()} />}
        />
      ) : (
        <View className="gap-4">
          {dates.map((date, i) => (
            <DayCard
              key={date}
              weekdayLabel={WEEKDAYS[i] ?? ''}
              date={date}
              isToday={date === toYmd(new Date())}
              entries={byDate.get(date) ?? []}
              onAdd={() => setEditing({ date, entry: null })}
              onEdit={(entry) => setEditing({ date, entry })}
            />
          ))}
        </View>
      )}

      {editing ? (
        <EntryDialog
          orgId={orgId}
          weekStart={weekStart}
          date={editing.date}
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onDelete={(id) => {
            deleteEntry.mutate(id)
            setEditing(null)
          }}
        />
      ) : null}

      <GroceryDialog
        orgId={orgId}
        weekStart={weekStart}
        visible={groceryOpen}
        onClose={() => setGroceryOpen(false)}
      />
    </View>
  )
}

/** One day's row: weekday header + its meal entries (grouped by type) + an add affordance. */
function DayCard({
  weekdayLabel,
  date,
  isToday,
  entries,
  onAdd,
  onEdit,
}: {
  weekdayLabel: string
  date: string
  isToday: boolean
  entries: MealPlanEntry[]
  onAdd: () => void
  onEdit: (entry: MealPlanEntry) => void
}) {
  const colors = useColors()
  const dayNum = parseYmd(date).getDate()
  return (
    <Card>
      <CardContent className="gap-2 p-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Text variant="label">{weekdayLabel}</Text>
            <Text variant="muted">{dayNum}</Text>
            {isToday ? <Badge variant="secondary" label="Today" /> : null}
          </View>
          <Pressable
            onPress={onAdd}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Add meal for ${weekdayLabel}`}
            className="size-8 items-center justify-center rounded-full active:bg-accent"
          >
            <Plus color={colors.primary} size={20} />
          </Pressable>
        </View>

        {entries.length === 0 ? (
          <Pressable onPress={onAdd} accessibilityRole="button" className="py-1 active:opacity-70">
            <Text variant="muted">No meals planned — tap + to add one.</Text>
          </Pressable>
        ) : (
          <View className="gap-1.5">
            {MEAL_TYPES.filter((t) => entries.some((e) => e.mealType === t)).map((type) => (
              <View key={type} className="gap-1.5">
                {entries
                  .filter((e) => e.mealType === type)
                  .map((entry) => (
                    <MealRow key={entry.id} entry={entry} onPress={() => onEdit(entry)} />
                  ))}
              </View>
            ))}
          </View>
        )}
      </CardContent>
    </Card>
  )
}

/** A single meal entry, tappable to edit; shows its type, title and ingredient count. */
function MealRow({ entry, onPress }: { entry: MealPlanEntry; onPress: () => void }) {
  const ingredients = entry.ingredients ?? []
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${MEAL_LABELS[entry.mealType as MealType]}: ${entry.title}`}
      className="flex-row items-center gap-3 rounded-md bg-muted px-3 py-2 active:opacity-80"
    >
      <Badge variant="outline" label={MEAL_LABELS[entry.mealType as MealType] ?? entry.mealType} />
      <View className="flex-1">
        <Text variant="body">{entry.title}</Text>
        {ingredients.length > 0 ? (
          <Text variant="caption">
            {ingredients.length} {ingredients.length === 1 ? 'ingredient' : 'ingredients'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

/** Create/edit a meal entry: title, meal type, notes, recipe URL, and an ingredients editor. */
function EntryDialog({
  orgId,
  weekStart,
  date,
  entry,
  onClose,
  onDelete,
}: {
  orgId: string
  weekStart: string
  date: string
  entry: MealPlanEntry | null
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const { toast } = useToast()
  const colors = useColors()
  const create = useCreateMealEntry(orgId, weekStart)
  const update = useUpdateMealEntry(orgId, weekStart)

  const [title, setTitle] = useState(entry?.title ?? '')
  const [mealType, setMealType] = useState<MealType>((entry?.mealType as MealType) ?? 'dinner')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [recipeUrl, setRecipeUrl] = useState(entry?.recipeUrl ?? '')
  const [ingredients, setIngredients] = useState<MealIngredient[]>(entry?.ingredients ?? [])
  const [draftIngredient, setDraftIngredient] = useState('')

  const isEdit = Boolean(entry)
  const pending = create.isPending || update.isPending

  const addIngredient = () => {
    const name = draftIngredient.trim()
    if (!name) return
    setIngredients((list) => [...list, { name }])
    setDraftIngredient('')
  }

  const removeIngredient = (index: number) => {
    setIngredients((list) => list.filter((_, i) => i !== index))
  }

  const onSave = () => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast({ title: 'Name the meal first', variant: 'error' })
      return
    }
    const input: MealEntryInput = {
      date,
      mealType,
      title: trimmed,
      notes: notes.trim() || null,
      recipeUrl: recipeUrl.trim() || null,
      ingredients,
    }
    const onError = (e: unknown) =>
      toast({ title: "Couldn't save meal", description: (e as Error).message, variant: 'error' })
    if (entry) {
      update.mutate({ entryId: entry.id, input }, { onSuccess: onClose, onError })
    } else {
      create.mutate(input, { onSuccess: onClose, onError })
    }
  }

  return (
    <Dialog
      visible
      onClose={onClose}
      title={isEdit ? 'Edit meal' : 'Add meal'}
      description={parseYmd(date).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })}
    >
      <ScrollView className="max-h-[26rem]" keyboardShouldPersistTaps="handled">
        <Form onSubmit={onSave} className="gap-3 pb-1">
          <Input
            label="Title"
            placeholder="Spaghetti Bolognese"
            value={title}
            onChangeText={setTitle}
            autoFocus={!isEdit}
            autoCapitalize="sentences"
          />

          <View className="gap-1.5">
            <Text variant="label">Meal type</Text>
            <SegmentedControl
              value={mealType}
              onValueChange={(v) => setMealType(v as MealType)}
              options={MEAL_TYPES.map((t) => ({ label: MEAL_LABELS[t], value: t }))}
            />
          </View>

          <Input
            label="Recipe URL"
            placeholder="https://…"
            value={recipeUrl}
            onChangeText={setRecipeUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Textarea
            label="Notes"
            placeholder="Prep ahead, who's cooking, allergies…"
            value={notes}
            onChangeText={setNotes}
            rows={3}
          />

          <View className="gap-2">
            <Text variant="label">Ingredients</Text>
            {ingredients.length > 0 ? (
              <View className="gap-1.5">
                {ingredients.map((ing, i) => (
                  <View
                    key={`${ing.name}-${i}`}
                    className="flex-row items-center gap-2 rounded-md bg-muted px-3 py-2"
                  >
                    <Text variant="body" className="flex-1">
                      {ing.name}
                      {ing.quantity ? <Text variant="muted">{`  ${ing.quantity}`}</Text> : null}
                    </Text>
                    <Pressable
                      onPress={() => removeIngredient(i)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${ing.name}`}
                      className="size-7 items-center justify-center rounded-full active:bg-accent"
                    >
                      <X color={colors.mutedForeground} size={16} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text variant="muted">Add ingredients to push into a grocery list later.</Text>
            )}
            <Form onSubmit={addIngredient} className="flex-row items-end gap-2">
              <Input
                containerClassName="flex-1"
                placeholder="Add an ingredient…"
                value={draftIngredient}
                onChangeText={setDraftIngredient}
                onSubmitEditing={addIngredient}
                returnKeyType="done"
                autoCapitalize="none"
              />
              <Button
                size="sm"
                variant="outline"
                label="Add"
                disabled={!draftIngredient.trim()}
                onPress={addIngredient}
              />
            </Form>
          </View>

          <View className="mt-1 flex-row items-center justify-between gap-2">
            {entry ? (
              <Button
                variant="ghost"
                icon={Trash2}
                label="Delete"
                onPress={() => onDelete(entry.id)}
              />
            ) : (
              <View />
            )}
            <View className="flex-row gap-2">
              <Button variant="ghost" label="Cancel" onPress={onClose} />
              <Button label="Save" loading={pending} onPress={onSave} />
            </View>
          </View>
        </Form>
      </ScrollView>
    </Dialog>
  )
}

/** Pick a shopping list, then push the whole week's ingredients into it (de-duped server-side). */
function GroceryDialog({
  orgId,
  weekStart,
  visible,
  onClose,
}: {
  orgId: string
  weekStart: string
  visible: boolean
  onClose: () => void
}) {
  const { toast } = useToast()
  const lists = useShoppingLists(orgId)
  const generate = useGenerateGroceryList(orgId)
  const [listId, setListId] = useState<string>('')

  const options = useMemo(
    () =>
      (lists.data ?? [])
        .filter((l) => !l.isArchived)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((l) => ({ label: l.name, value: l.id })),
    [lists.data],
  )

  const onGenerate = () => {
    if (!listId) {
      toast({ title: 'Pick a list first', variant: 'error' })
      return
    }
    generate.mutate(
      { weekStart, listId },
      {
        onSuccess: (res) => {
          toast({
            title: res.itemsAdded > 0 ? `Added ${res.itemsAdded} items` : 'Nothing new to add',
            variant: 'success',
          })
          onClose()
        },
        onError: (e) =>
          toast({ title: "Couldn't generate list", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title="Generate grocery list"
      description="Push every ingredient from this week's meals into a shopping list."
    >
      <View className="mt-1 gap-3">
        {lists.isLoading ? (
          <View className="items-center py-6">
            <Spinner />
          </View>
        ) : options.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No shopping lists yet"
            description="Create a list on the Shopping screen first, then come back to fill it."
          />
        ) : (
          <Select
            label="Shopping list"
            placeholder="Choose a list…"
            value={listId}
            onValueChange={setListId}
            options={options}
          />
        )}
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" label="Cancel" onPress={onClose} />
          <Button
            label="Generate"
            loading={generate.isPending}
            disabled={options.length === 0 || !listId}
            onPress={onGenerate}
          />
        </View>
      </View>
    </Dialog>
  )
}
