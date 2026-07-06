import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { ChevronRight, ListChecks, Plus, SearchX, Sparkles } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { List, ListItem } from '@/components/ui/list'
import { SearchBar } from '@/components/ui/search-bar'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Skeleton, SkeletonCircle } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { FAB } from '@/components/ui/fab'
import { useColors } from '@/lib/config/theme'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useSession } from '@/lib/auth/client'
import { useChores, useChoreCategories } from '@/lib/query/hooks/useChores'
import { iconFor } from '@/lib/manyhandz/icons'
import { accentHex } from '@/lib/manyhandz/accents'
import type { Chore, ChoreCategory } from '@/lib/db/schema'

/**
 * Chore Library — the searchable/filterable list of a household's chore templates (pairs with
 * app/chores/new.tsx + app/chores/[id].tsx and useChores.ts). Mode-aware: reads are open to every
 * member, but the create affordance (FAB + empty-state CTA) is gated on can('chore:create') so kids
 * see a read-only library. Filter by category, search by name; tap a row for the detail screen.
 */

const ALL = '__all__'

/** Render difficulty per the mode's UI tone: ★×n for family, Easy/Medium/Hard text for roommate. */
function difficultyLabel(difficulty: number, display: 'stars' | 'text'): string {
  if (display === 'stars') return '★'.repeat(Math.max(1, Math.min(5, difficulty)))
  if (difficulty <= 2) return 'Easy'
  if (difficulty <= 3) return 'Medium'
  return 'Hard'
}

/** One-line row subtitle: category · difficulty · time. */
function choreSubtitle(chore: Chore, category: ChoreCategory | undefined, display: 'stars' | 'text'): string {
  const parts = [
    category?.name,
    difficultyLabel(chore.difficulty, display),
    `${chore.estimatedMinutes} min`,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** Skeleton rows shaped like the real list — layout doesn't jump when data lands. */
function ChoreListSkeleton() {
  return (
    <View className="gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={i} className="flex-row items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5">
          <SkeletonCircle size={36} />
          <View className="flex-1 gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </View>
        </View>
      ))}
    </View>
  )
}

function ChoreRow({
  item,
  category,
  display,
}: {
  item: Chore
  category: ChoreCategory | undefined
  display: 'stars' | 'text'
}) {
  const colors = useColors()
  const Icon = iconFor(item.icon)
  return (
    <ListItem
      title={item.name}
      subtitle={choreSubtitle(item, category, display)}
      left={
        <View
          className="size-9 items-center justify-center rounded-full"
          style={{ backgroundColor: `${accentHex(category?.color)}22` }}
        >
          <Icon color={accentHex(category?.color)} size={18} />
        </View>
      }
      right={<ChevronRight color={colors.mutedForeground} size={18} />}
      onPress={() => router.push({ pathname: '/chores/[id]', params: { id: item.id } })}
    />
  )
}

export default function ChoresScreen() {
  const { data: session, isPending: sessionPending } = useSession()
  const { orgId, ui, can } = useHouseholdMode()
  const display = ui?.difficultyDisplay ?? 'text'
  const canCreate = can('chore:create')

  const query = useChores(orgId ?? '')
  const categoriesQuery = useChoreCategories(orgId ?? '')

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string>(ALL)

  const categories = categoriesQuery.data ?? []
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  )

  const chores = query.data ?? []
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return chores.filter((c) => {
      if (categoryId !== ALL && c.categoryId !== categoryId) return false
      if (term && !c.name.toLowerCase().includes(term)) return false
      return true
    })
  }, [chores, search, categoryId])

  const searching = search.trim().length > 0 || categoryId !== ALL

  return (
    <View className="flex-1">
      <Stack.Screen options={{ headerShown: true, title: 'Chores' }} />
      {/* pb-28 keeps the last row tappable above the FAB. */}
      <PageWrapper className="pb-28" onRefresh={() => query.refetch()}>
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={ListChecks}
            title="You're signed out"
            description="Sign in to see your household's chore library."
            action={<Button label="Sign in" onPress={() => router.push('/login')} />}
          />
        ) : (
          <>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search chores" />

            {/* Category chips — a horizontal lens row; "All" plus one chip per category. */}
            <View className="flex-row flex-wrap gap-2">
              <CategoryChip label="All" active={categoryId === ALL} onPress={() => setCategoryId(ALL)} />
              {categories.map((c) => (
                <CategoryChip
                  key={c.id}
                  label={c.name}
                  color={accentHex(c.color)}
                  active={categoryId === c.id}
                  onPress={() => setCategoryId(c.id)}
                />
              ))}
            </View>

            <AsyncBoundary
              query={query}
              isEmpty={filtered.length === 0}
              loading={<ChoreListSkeleton />}
              empty={
                searching ? (
                  <EmptyState
                    icon={SearchX}
                    title="No chores match"
                    description="Try a different search or category filter."
                  />
                ) : (
                  <EmptyState
                    icon={Sparkles}
                    title="No chores yet"
                    description={
                      canCreate
                        ? 'Add your first chore to start building the household library.'
                        : 'Your household admin hasn’t added any chores yet.'
                    }
                    action={
                      canCreate ? (
                        <Button label="Add a chore" onPress={() => router.push('/chores/new')} />
                      ) : undefined
                    }
                  />
                )
              }
            >
              <List>
                {filtered.map((chore) => (
                  <ChoreRow
                    key={chore.id}
                    item={chore}
                    category={chore.categoryId ? categoryById.get(chore.categoryId) : undefined}
                    display={display}
                  />
                ))}
              </List>
            </AsyncBoundary>
          </>
        )}
      </PageWrapper>
      {/* FAB pinned outside the scroll view — only for members who can author chores. */}
      {session && canCreate ? (
        <FAB icon={Plus} accessibilityLabel="New chore" onPress={() => router.push('/chores/new')} />
      ) : null}
    </View>
  )
}

/** Filter chip — a small pressable pill; the active one fills with its category accent. */
function CategoryChip({
  label,
  color,
  active,
  onPress,
}: {
  label: string
  color?: string
  active: boolean
  onPress: () => void
}) {
  if (active) {
    return (
      <Button size="sm" variant="default" label={label} onPress={onPress} className="rounded-full" />
    )
  }
  return (
    <Button size="sm" variant="outline" onPress={onPress} className="rounded-full">
      <View className="flex-row items-center gap-1.5">
        {color ? <View className="size-2 rounded-full" style={{ backgroundColor: color }} /> : null}
        <Text variant="label">{label}</Text>
      </View>
    </Button>
  )
}
