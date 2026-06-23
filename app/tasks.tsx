import { useMemo, useState } from 'react'
import { View, Pressable } from 'react-native'
import { Stack } from 'expo-router'
import { Check, ListChecks, Plus, Trash2, User } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Select } from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Tabs } from '@/components/ui/tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { accentHex } from '@/lib/manyhandz/accents'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHousehold, useHouseholdMembers } from '@/lib/query/hooks/useHousehold'
import {
  useQuickTasks,
  useCreateQuickTask,
  useCompleteQuickTask,
  useReopenQuickTask,
  useDeleteQuickTask,
} from '@/lib/query/hooks/useQuickTasks'
import type { QuickTask } from '@/lib/db/schema'

/**
 * Quick Tasks — lightweight one-off to-dos for the household: a plain checklist with NO points or
 * gamification chrome. Inline quick-add (title + optional assignee + due date), single-tap complete,
 * and four filter tabs (All / Mine / Open / Done). Any member may add or complete a task — the hook
 * deliberately doesn't gate writes by the permission matrix (the Worker scopes everything by org),
 * and quick tasks exist in every household mode, so there's no feature flag to branch on here.
 */

type Filter = 'all' | 'mine' | 'open' | 'done'

const FILTER_TABS = [
  { label: 'All', value: 'all' },
  { label: 'Mine', value: 'mine' },
  { label: 'Open', value: 'open' },
  { label: 'Done', value: 'done' },
]

type MemberLite = { displayName: string; favoriteColor: string; avatarUrl: string | null }

/** YYYY-MM-DD in the device's local zone (matches the Worker's plain-date column). */
function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** "2026-06-21" → "Sat, Jun 21" — friendly, locale-aware, no time component. */
function formatDue(dateKey: string | null): string | null {
  if (!dateKey) return null
  const d = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function QuickTasksScreen() {
  const { orgId, ready, isLoading: modeLoading } = useHouseholdMode()
  const safeOrgId = orgId ?? ''

  // `me.memberId` drives the "Mine" filter; members feed the assignee picker + row avatars.
  const { data: household } = useHousehold(safeOrgId)
  const meId = household?.me.memberId
  const { data: members } = useHouseholdMembers(safeOrgId)

  const tasksQuery = useQuickTasks(safeOrgId)
  const create = useCreateQuickTask(safeOrgId)
  const complete = useCompleteQuickTask(safeOrgId)
  const reopen = useReopenQuickTask(safeOrgId)
  const remove = useDeleteQuickTask(safeOrgId)
  const { toast } = useToast()

  const [filter, setFilter] = useState<Filter>('all')
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState<Date | undefined>()

  const memberOptions = useMemo(
    () => [
      { label: 'Anyone', value: '' },
      ...(members ?? []).map((m) => ({ label: m.displayName, value: m.memberId })),
    ],
    [members],
  )
  const memberById = useMemo(() => {
    const map = new Map<string, MemberLite>()
    for (const m of members ?? []) {
      map.set(m.memberId, { displayName: m.displayName, favoriteColor: m.favoriteColor, avatarUrl: m.avatarUrl })
    }
    return map
  }, [members])

  const tasks = tasksQuery.data ?? []
  const filtered = useMemo(() => {
    switch (filter) {
      case 'mine':
        return tasks.filter((t) => t.assignedToMemberId != null && t.assignedToMemberId === meId)
      case 'open':
        return tasks.filter((t) => !t.isCompleted)
      case 'done':
        return tasks.filter((t) => t.isCompleted)
      default:
        return tasks
    }
  }, [tasks, filter, meId])

  const onAdd = () => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast({ title: 'Add a task title first', variant: 'error' })
      return
    }
    create.mutate(
      { title: trimmed, assignedToMemberId: assignee || null, dueDate: due ? toDateKey(due) : null },
      {
        onSuccess: () => {
          setTitle('')
          setAssignee('')
          setDue(undefined)
        },
        onError: (e) =>
          toast({ title: "Couldn't add task", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const onToggle = (task: QuickTask) => {
    const mutation = task.isCompleted ? reopen : complete
    mutation.mutate(task.id, {
      onError: (e) =>
        toast({ title: "Couldn't update task", description: (e as Error).message, variant: 'error' }),
    })
  }

  const onDelete = (task: QuickTask) => {
    remove.mutate(task.id, {
      onError: (e) =>
        toast({ title: "Couldn't delete task", description: (e as Error).message, variant: 'error' }),
    })
  }

  // Not in a household yet (or session still resolving) — keep it friendly, don't fire on an empty orgId.
  if (!ready) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Quick Tasks' }} />
        <PageWrapper>
          {modeLoading ? (
            <View className="items-center py-24">
              <Spinner size="large" />
            </View>
          ) : (
            <EmptyState
              icon={ListChecks}
              title="No household yet"
              description="Join or create a household to start a shared task list."
            />
          )}
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Quick Tasks' }} />
      <PageWrapper className="pb-24" onRefresh={() => tasksQuery.refetch()}>
        <QuickAdd
          title={title}
          onTitleChange={setTitle}
          assignee={assignee}
          onAssigneeChange={setAssignee}
          memberOptions={memberOptions}
          due={due}
          onDueChange={setDue}
          onAdd={onAdd}
          adding={create.isPending}
        />

        <Tabs tabs={FILTER_TABS} value={filter} onValueChange={(v) => setFilter(v as Filter)} />

        {tasksQuery.isLoading ? (
          <View className="items-center py-16">
            <Spinner size="large" />
          </View>
        ) : tasksQuery.isError ? (
          <EmptyState
            icon={ListChecks}
            title="Couldn't load tasks"
            description="Pull to refresh or try again in a moment."
            action={<Button label="Retry" onPress={() => tasksQuery.refetch()} />}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={filter === 'done' ? 'Nothing finished yet' : 'No tasks here'}
            description={
              filter === 'mine'
                ? 'Tasks assigned to you will show up here.'
                : 'Add a quick to-do above to get started.'
            }
          />
        ) : (
          <View className="gap-2">
            {filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                assignee={task.assignedToMemberId ? memberById.get(task.assignedToMemberId) : undefined}
                busy={complete.isPending || reopen.isPending || remove.isPending}
                onToggle={() => onToggle(task)}
                onDelete={() => onDelete(task)}
              />
            ))}
          </View>
        )}
      </PageWrapper>
    </>
  )
}

/** Inline quick-add row: title (required) + optional assignee + optional due date. */
function QuickAdd({
  title,
  onTitleChange,
  assignee,
  onAssigneeChange,
  memberOptions,
  due,
  onDueChange,
  onAdd,
  adding,
}: {
  title: string
  onTitleChange: (v: string) => void
  assignee: string
  onAssigneeChange: (v: string) => void
  memberOptions: { label: string; value: string }[]
  due: Date | undefined
  onDueChange: (d: Date) => void
  onAdd: () => void
  adding: boolean
}) {
  return (
    <Card>
      <CardContent className="gap-3">
        <Form onSubmit={onAdd} className="gap-3">
          <Input
            placeholder="Add a quick task…"
            value={title}
            onChangeText={onTitleChange}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={onAdd}
          />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Select
                value={assignee}
                onValueChange={onAssigneeChange}
                placeholder="Assign to"
                options={memberOptions}
              />
            </View>
            <View className="flex-1">
              <DateTimePicker mode="date" value={due} onValueChange={onDueChange} placeholder="Due date" />
            </View>
          </View>
          <Button label="Add task" icon={Plus} loading={adding} disabled={!title.trim()} onPress={onAdd} />
        </Form>
      </CardContent>
    </Card>
  )
}

/** A single task row: tap the circle to complete/reopen (single-tap), with a quiet delete affordance. */
function TaskRow({
  task,
  assignee,
  busy,
  onToggle,
  onDelete,
}: {
  task: QuickTask
  assignee: MemberLite | undefined
  busy: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const colors = useColors()
  const due = formatDue(task.dueDate)

  return (
    <Card>
      <CardContent className="flex-row items-center gap-3 py-3">
        <Pressable
          onPress={onToggle}
          disabled={busy}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.isCompleted }}
          accessibilityLabel={task.isCompleted ? 'Mark task open' : 'Complete task'}
          hitSlop={8}
          className="active:opacity-60"
        >
          <View
            className="size-7 items-center justify-center rounded-full border-2"
            style={{
              borderColor: task.isCompleted ? colors.success : colors.border,
              backgroundColor: task.isCompleted ? colors.success : 'transparent',
            }}
          >
            {task.isCompleted ? <Check color={colors.onPrimary} size={16} /> : null}
          </View>
        </Pressable>

        <View className="flex-1">
          <Text
            variant="label"
            className={task.isCompleted ? 'text-muted-foreground line-through' : undefined}
            numberOfLines={2}
          >
            {task.title}
          </Text>
          <View className="mt-0.5 flex-row items-center gap-3">
            {assignee ? (
              <View className="flex-row items-center gap-1.5">
                <Avatar uri={assignee.avatarUrl ?? undefined} name={assignee.displayName} size={18} />
                <Text variant="caption" style={{ color: accentHex(assignee.favoriteColor) }}>
                  {assignee.displayName}
                </Text>
              </View>
            ) : (
              <View className="flex-row items-center gap-1.5">
                <User color={colors.mutedForeground} size={13} />
                <Text variant="caption">Anyone</Text>
              </View>
            )}
            {due ? (
              <Text variant="caption" style={{ color: accentHex('amber') }}>
                {due}
              </Text>
            ) : null}
          </View>
        </View>

        <Pressable
          onPress={onDelete}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Delete task"
          hitSlop={8}
          className="active:opacity-60"
        >
          <Trash2 color={colors.mutedForeground} size={18} />
        </Pressable>
      </CardContent>
    </Card>
  )
}
