import { useMemo, useState } from 'react'
import { View, Pressable, ScrollView, useWindowDimensions } from 'react-native'
import { Stack } from 'expo-router'
import { CalendarDays, ChevronLeft, ChevronRight, Check, Plus, SkipForward } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Grid } from '@/components/ui/grid'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ActionSheet } from '@/components/ui/action-sheet'
import { Dialog } from '@/components/ui/dialog'
import { MemberPicker } from '@/components/ui/member-picker'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { cn } from '@/lib/utils'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHouseholdMembers, type HouseholdMember } from '@/lib/query/hooks/useHousehold'
import { useChoreCategories, useChores } from '@/lib/query/hooks/useChores'
import {
  useAssignments,
  useUpdateAssignment,
  useCreateAssignment,
  type AssignmentWithChore,
} from '@/lib/query/hooks/useAssignments'
import { accentHex } from '@/lib/manyhandz/accents'
import { iconFor } from '@/lib/manyhandz/icons'

/** Local date helpers — assignments store dueDate as a plain `YYYY-MM-DD`, so we stay in local time
 * (never toISOString, which shifts the day across the UTC boundary for many users). */
const ISO = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const addDays = (d: Date, n: number) => {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}
/** Monday-start: shift Sunday (0) back to the previous Monday. */
function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  return addDays(d, diff)
}
function startOfMonthGrid(d: Date): Date {
  return startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1))
}
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type CalendarView = 'week' | 'month'
const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'To do', value: 'pending' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Skipped', value: 'skipped' },
]

/** A done/completed-family status renders muted; everything else is "open". */
const isDone = (s: string) => s === 'completed' || s === 'pending_review'
const isSkipped = (s: string) => s === 'skipped'

function statusBadge(status: string): { variant: 'success' | 'warning' | 'destructive' | 'outline' | 'secondary'; label: string } {
  if (isDone(status)) return { variant: 'success', label: 'Done' }
  if (isSkipped(status)) return { variant: 'secondary', label: 'Skipped' }
  if (status === 'overdue') return { variant: 'destructive', label: 'Overdue' }
  if (status === 'in_progress') return { variant: 'warning', label: 'In progress' }
  return { variant: 'outline', label: 'To do' }
}

export default function ScheduleScreen() {
  const { orgId, ready, can, features } = useHouseholdMode()
  const colors = useColors()
  const { toast } = useToast()

  const [view, setView] = useState<CalendarView>('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [memberFilter, setMemberFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [openDay, setOpenDay] = useState<string | null>(null)
  // Quick-assign from a calendar day: pick a chore + member; due date = the tapped day.
  const [quickAssignDate, setQuickAssignDate] = useState<string | null>(null)
  const [qaChore, setQaChore] = useState<string | null>(null)
  const [qaMember, setQaMember] = useState<string | null>(null)

  // The visible range: 7 days for week, the full 6-row month grid for month.
  const rangeStart = useMemo(
    () => (view === 'week' ? startOfWeek(anchor) : startOfMonthGrid(anchor)),
    [view, anchor],
  )
  const days = view === 'week' ? 7 : 42
  const from = ISO(rangeStart)
  const to = ISO(addDays(rangeStart, days - 1))

  const members = useHouseholdMembers(orgId ?? '')
  const categories = useChoreCategories(orgId ?? '')
  const assignments = useAssignments(orgId ?? '', {
    from,
    to,
    ...(memberFilter ? { assignedToMemberId: memberFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
  })
  const update = useUpdateAssignment(orgId ?? '')
  const chores = useChores(orgId ?? '')
  const createAssignment = useCreateAssignment(orgId ?? '')
  const canAssign = can('chore:assign')

  const memberById = useMemo(() => {
    const map = new Map<string, HouseholdMember>()
    for (const m of members.data ?? []) map.set(m.memberId, m)
    return map
  }, [members.data])

  // Category is filtered client-side (the assignments endpoint filters member/status only).
  const visible = useMemo(() => {
    const rows = assignments.data ?? []
    return categoryFilter ? rows.filter((r) => r.categoryId === categoryFilter) : rows
  }, [assignments.data, categoryFilter])

  const byDay = useMemo(() => {
    const map = new Map<string, AssignmentWithChore[]>()
    for (const a of visible) {
      const list = map.get(a.dueDate) ?? []
      list.push(a)
      map.set(a.dueDate, list)
    }
    return map
  }, [visible])

  const canMarkOthers = can('completion:approve') || can('chore:assign')

  const onDone = (a: AssignmentWithChore) => {
    update.mutate(
      { id: a.id, input: { status: 'completed' } },
      {
        onError: (e) => toast({ title: "Couldn't mark done", description: (e as Error).message, variant: 'error' }),
      },
    )
  }
  const onSkip = (a: AssignmentWithChore) => {
    update.mutate(
      { id: a.id, input: { status: 'skipped' } },
      {
        onError: (e) => toast({ title: "Couldn't skip", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const shift = (dir: -1 | 1) => setAnchor((d) => addDays(d, dir * (view === 'week' ? 7 : 30)))

  // Whole-screen guards.
  if (!ready) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Schedule' }} />
        <PageWrapper>
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        </PageWrapper>
      </>
    )
  }

  const periodLabel =
    view === 'week'
      ? `${rangeStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(rangeStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const memberOptions = [
    { label: 'Everyone', value: '' },
    ...(members.data ?? []).map((m) => ({ label: m.displayName, value: m.memberId })),
  ]
  const categoryOptions = [
    { label: 'All categories', value: '' },
    ...(categories.data ?? []).map((c) => ({ label: c.name, value: c.id })),
  ]

  const openDayItems = openDay ? (byDay.get(openDay) ?? []) : []

  const choreOptions = (chores.data ?? []).map((c) => ({ label: c.name, value: c.id }))
  const submitQuickAssign = () => {
    if (!quickAssignDate || !qaChore || !qaMember) return
    createAssignment.mutate(
      { choreId: qaChore, assignedToMemberId: qaMember, dueDate: quickAssignDate },
      {
        onSuccess: () => {
          setQuickAssignDate(null)
          setQaChore(null)
          setQaMember(null)
          toast({ title: 'Chore assigned', variant: 'success' })
        },
        onError: (e) => toast({ title: "Couldn't assign", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Schedule' }} />
      <PageWrapper width="wide" className="gap-4 pb-24">
        <SegmentedControl
          value={view}
          onValueChange={(v) => setView(v as CalendarView)}
          options={[
            { label: 'Week', value: 'week' },
            { label: 'Month', value: 'month' },
          ]}
        />

        {/* Period nav */}
        <View className="flex-row items-center justify-between">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onPress={() => shift(-1)} accessibilityLabel="Previous" />
          <Pressable onPress={() => setAnchor(new Date())} accessibilityRole="button" className="active:opacity-70">
            <Text variant="label">{periodLabel}</Text>
          </Pressable>
          <Button variant="ghost" size="sm" icon={ChevronRight} onPress={() => shift(1)} accessibilityLabel="Next" />
        </View>

        {/* Filters */}
        <View className="flex-row gap-2">
          <Select className="flex-1" value={memberFilter} onValueChange={setMemberFilter} options={memberOptions} placeholder="Everyone" />
          <Select className="flex-1" value={categoryFilter} onValueChange={setCategoryFilter} options={categoryOptions} placeholder="All categories" />
          <Select className="flex-1" value={statusFilter} onValueChange={setStatusFilter} options={STATUS_OPTIONS} placeholder="All statuses" />
        </View>

        {/* Member legend */}
        {features?.accentColors && (members.data?.length ?? 0) > 0 ? (
          <View className="flex-row flex-wrap gap-x-4 gap-y-1.5">
            {(members.data ?? []).map((m) => (
              <View key={m.memberId} className="flex-row items-center gap-1.5">
                <View className="size-2.5 rounded-full" style={{ backgroundColor: accentHex(m.favoriteColor) }} />
                <Text variant="caption">{m.displayName}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Grid / error / loading */}
        {assignments.isError ? (
          <EmptyState
            icon={CalendarDays}
            title="Couldn't load the schedule"
            description="Check your connection and pull to refresh."
            action={<Button label="Retry" onPress={() => assignments.refetch()} />}
          />
        ) : assignments.isLoading ? (
          <View className="items-center py-16">
            <Spinner size="large" />
          </View>
        ) : view === 'week' ? (
          <WeekGrid
            start={rangeStart}
            byDay={byDay}
            memberById={memberById}
            useAccent={features?.accentColors ?? false}
            onSelectDay={setOpenDay}
            colors={colors}
          />
        ) : (
          <MonthGrid
            start={rangeStart}
            month={anchor.getMonth()}
            byDay={byDay}
            memberById={memberById}
            useAccent={features?.accentColors ?? false}
            onSelectDay={setOpenDay}
            colors={colors}
          />
        )}
      </PageWrapper>

      {/* Day detail */}
      <ActionSheet
        visible={openDay !== null}
        onClose={() => setOpenDay(null)}
        title={openDay ? new Date(`${openDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : undefined}
      >
        {canAssign ? (
          <Button
            variant="outline"
            icon={Plus}
            label="Assign a chore to this day"
            className="mb-3"
            onPress={() => {
              const day = openDay
              setOpenDay(null) // close the sheet first, then open the assign dialog (avoid stacked modals)
              setQuickAssignDate(day)
            }}
          />
        ) : null}
        {openDayItems.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nothing scheduled" description="No chores fall on this day." />
        ) : (
          <ScrollView className="max-h-96">
            <View className="gap-2">
              {openDayItems.map((a) => (
                <DayRow
                  key={a.id}
                  assignment={a}
                  member={memberById.get(a.assignedToMemberId)}
                  useAccent={features?.accentColors ?? false}
                  canMark={can('completion:mark_own') || canMarkOthers}
                  pending={update.isPending}
                  onDone={() => onDone(a)}
                  onSkip={() => onSkip(a)}
                  colors={colors}
                />
              ))}
            </View>
          </ScrollView>
        )}
      </ActionSheet>

      {/* Quick-assign — pick a chore + member; the tapped day is the due date. */}
      <Dialog
        visible={quickAssignDate !== null}
        onClose={() => setQuickAssignDate(null)}
        title="Assign a chore"
        description={
          quickAssignDate
            ? `Due ${new Date(`${quickAssignDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.`
            : undefined
        }
      >
        <View className="gap-4 pt-1">
          <Select
            label="Chore"
            placeholder="Pick a chore"
            options={choreOptions}
            value={qaChore ?? undefined}
            onValueChange={setQaChore}
            searchable={choreOptions.length > 8}
          />
          <MemberPicker orgId={orgId ?? ''} label="Assign to" value={qaMember} onChange={setQaMember} />
          <View className="flex-row justify-end gap-3">
            <Button variant="outline" label="Cancel" onPress={() => setQuickAssignDate(null)} />
            <Button label="Assign" loading={createAssignment.isPending} disabled={!qaChore || !qaMember} onPress={submitQuickAssign} />
          </View>
        </View>
      </Dialog>
    </>
  )
}

type GridProps = {
  start: Date
  byDay: Map<string, AssignmentWithChore[]>
  memberById: Map<string, HouseholdMember>
  useAccent: boolean
  onSelectDay: (iso: string) => void
  colors: ReturnType<typeof useColors>
}

/** Resolve the color used for a member's dot/chip — accent when the mode enables it, else neutral border. */
function dotColor(member: HouseholdMember | undefined, useAccent: boolean, fallback: string): string {
  if (useAccent && member) return accentHex(member.favoriteColor)
  return fallback
}

function WeekGrid({ start, byDay, memberById, useAccent, onSelectDay, colors }: GridProps) {
  const todayIso = ISO(new Date())
  const { width } = useWindowDimensions()
  // Phone: 3 square cards per row (3+3+1) — far better than 7 tall, skinny columns. Wider screens
  // (tablet/web) get the full 7-day strip, where 7 cells are comfortably sized. The chassis <Grid>
  // handles the equal-width wrapping either way.
  const columns = width >= 640 ? 7 : 3
  return (
    <Grid columns={columns}>
      {Array.from({ length: 7 }, (_, i) => {
        const date = addDays(start, i)
        const iso = ISO(date)
        const items = byDay.get(iso) ?? []
        const isToday = iso === todayIso
        return (
          <Pressable key={iso} onPress={() => onSelectDay(iso)} className="active:opacity-70" accessibilityRole="button" accessibilityLabel={`${DOW[i]} ${date.getDate()}, ${items.length} chores`}>
            <View className={cn('aspect-square gap-1.5 rounded-xl border bg-card p-2.5', isToday ? 'border-primary' : 'border-border')}>
              <View className="flex-row items-baseline justify-between">
                <Text variant="caption">{DOW[i]}</Text>
                <Text variant="label" className={cn('text-base', isToday && 'text-primary')}>{date.getDate()}</Text>
              </View>
              <View className="flex-1 gap-1">
                {items.slice(0, 3).map((a) => {
                  const color = dotColor(memberById.get(a.assignedToMemberId), useAccent, colors.mutedForeground)
                  return (
                    <View key={a.id} className="flex-row items-center gap-1 rounded-md bg-accent/60 px-1.5 py-1">
                      <View className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
                      <Text variant="caption" numberOfLines={1} className={cn('flex-1', isDone(a.status) && 'line-through opacity-60')}>
                        {a.choreName}
                      </Text>
                    </View>
                  )
                })}
                {items.length > 3 ? <Text variant="caption" className="px-0.5">+{items.length - 3} more</Text> : null}
              </View>
            </View>
          </Pressable>
        )
      })}
    </Grid>
  )
}

function MonthGrid({ start, month, byDay, memberById, useAccent, onSelectDay, colors }: GridProps & { month: number }) {
  const todayIso = ISO(new Date())
  return (
    <View className="gap-1.5">
      <View className="flex-row">
        {DOW.map((d) => (
          <Text key={d} variant="caption" className="flex-1 text-center">{d}</Text>
        ))}
      </View>
      {Array.from({ length: 6 }, (_, week) => (
        <View key={week} className="flex-row gap-1.5">
          {Array.from({ length: 7 }, (_, i) => {
            const date = addDays(start, week * 7 + i)
            const iso = ISO(date)
            const items = byDay.get(iso) ?? []
            const inMonth = date.getMonth() === month
            const isToday = iso === todayIso
            // Up to three member dots summarize the day at a glance.
            const dots = items.slice(0, 3).map((a) => dotColor(memberById.get(a.assignedToMemberId), useAccent, colors.mutedForeground))
            return (
              <Pressable key={iso} onPress={() => onSelectDay(iso)} className="flex-1 active:opacity-70" accessibilityRole="button" accessibilityLabel={`${date.getDate()}, ${items.length} chores`}>
                <View className={cn('min-h-16 items-center gap-1 rounded-lg border bg-card p-1', isToday ? 'border-primary' : 'border-border', !inMonth && 'opacity-40')}>
                  <Text variant="caption" className={cn(isToday && 'text-primary')}>{date.getDate()}</Text>
                  <View className="h-2 flex-row gap-0.5">
                    {dots.map((c, idx) => (
                      <View key={idx} className="size-1.5 rounded-full" style={{ backgroundColor: c }} />
                    ))}
                    {items.length > 3 ? <Text variant="caption">+</Text> : null}
                  </View>
                </View>
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

type DayRowProps = {
  assignment: AssignmentWithChore
  member: HouseholdMember | undefined
  useAccent: boolean
  canMark: boolean
  pending: boolean
  onDone: () => void
  onSkip: () => void
  colors: ReturnType<typeof useColors>
}

function DayRow({ assignment, member, useAccent, canMark, pending, onDone, onSkip, colors }: DayRowProps) {
  const Icon = iconFor(assignment.choreIcon)
  const badge = statusBadge(assignment.status)
  const accent = dotColor(member, useAccent, colors.mutedForeground)
  const settled = isDone(assignment.status) || isSkipped(assignment.status)
  return (
    <Card>
      <CardContent className="gap-2 p-3">
        <View className="flex-row items-center gap-2">
          <View className="size-9 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}22` }}>
            <Icon color={accent} size={18} />
          </View>
          <View className="flex-1">
            <Text variant="label" numberOfLines={1}>{assignment.choreName}</Text>
            <Text variant="caption" numberOfLines={1}>
              {member?.displayName ?? 'Unassigned'}
              {assignment.dueTime ? ` · ${assignment.dueTime}` : ''}
            </Text>
          </View>
          <Badge variant={badge.variant} label={badge.label} />
        </View>
        {canMark && !settled ? (
          <View className="flex-row gap-2">
            <Button className="flex-1" size="sm" icon={Check} label="Done" loading={pending} onPress={onDone} />
            <Button className="flex-1" size="sm" variant="outline" icon={SkipForward} label="Skip" disabled={pending} onPress={onSkip} />
          </View>
        ) : null}
      </CardContent>
    </Card>
  )
}
