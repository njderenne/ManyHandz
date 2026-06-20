import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { format } from 'date-fns'
import { CalendarDays, CalendarPlus, ChevronRight, Plus, SearchX } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Button } from '@/components/ui/button'
import { List, ListItem } from '@/components/ui/list'
import { SearchBar } from '@/components/ui/search-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Skeleton, SkeletonCircle } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { FAB } from '@/components/ui/fab'
import { useColors } from '@/lib/config/theme'
import { authClient, useSession } from '@/lib/auth/client'
import { useEvents } from '@/lib/query/hooks/useEvents'
import { t } from '@/lib/i18n'
import type { CalendarEvent } from '@/lib/db/schema'

/**
 * Events list — THE searchable-list worked example (pairs with worker/routes/events.ts and
 * useEvents.ts; the detail/create screens live next door). Copy this screen for any product
 * list: debounced SearchBar → server-side filter, filter chips → query params, skeleton
 * loading, distinct "no data" vs "no results" empty states, cursor-paginated load-more, and a
 * FAB for the primary action. Signed-out visitors get a sign-in prompt (same as notifications).
 */

/**
 * Debounce a fast-changing value: re-renders with the trailing value once input pauses for
 * `delayMs`. The INPUT stays live (the TextInput re-renders per keystroke); only the QUERY
 * lags — so the network sees one request per pause, not one per keystroke.
 *
 * Local to this screen for now. When a second screen needs it, EXTRACT it to
 * src/lib/hooks/useDebouncedValue.ts — never copy-paste a third one.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/** The three list lenses. 'upcoming' is the default — the calendar question is "what's next?" */
type EventLens = 'upcoming' | 'past' | 'all'

/**
 * All-day rows store startsAt at UTC midnight (schema.ts convention) — read the calendar day in
 * UTC so the label never drifts a day in negative-offset timezones.
 */
function allDayDate(value: CalendarEvent['startsAt']): Date {
  const d = new Date(value)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** One-line row subtitle: when (+ where, if set). */
function eventSubtitle(event: CalendarEvent): string {
  const starts = new Date(event.startsAt)
  if (Number.isNaN(starts.getTime())) return event.location ?? ''
  const when = event.allDay
    ? `${format(allDayDate(event.startsAt), 'EEE, MMM d, yyyy')} · ${t('events.allDay')}`
    : format(starts, 'EEE, MMM d · h:mm a')
  return event.location ? `${when} · ${event.location}` : when
}

/** Skeleton rows shaped like the real list — layout doesn't jump when data lands. */
function EventListSkeleton() {
  return (
    <View className="gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} className="flex-row items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5">
          <SkeletonCircle size={36} />
          <View className="flex-1 gap-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-28" />
          </View>
        </View>
      ))}
    </View>
  )
}

function EventRow({ item }: { item: CalendarEvent }) {
  const colors = useColors()
  return (
    <ListItem
      title={item.title}
      subtitle={eventSubtitle(item)}
      left={
        <View className="size-9 items-center justify-center rounded-full bg-accent">
          <CalendarDays color={colors.brand} size={18} />
        </View>
      }
      right={<ChevronRight color={colors.mutedForeground} size={18} />}
      onPress={() => router.push({ pathname: '/events/[id]', params: { id: item.id } })}
    />
  )
}

export default function EventsScreen() {
  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''

  // Search: the INPUT is live, the QUERY is debounced (see useDebouncedValue above) — the
  // debounce belongs to the screen, not the hook, so cache keys stay one-per-server-query.
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput, 300)

  // Lens chips. `anchor` ("now") is STATE, refreshed only when the lens changes — recomputing
  // it per render would put a new timestamp in the query key every time and refetch forever.
  const [lens, setLens] = useState<EventLens>('upcoming')
  const [anchor, setAnchor] = useState(() => new Date().toISOString())
  const switchLens = (value: string) => {
    setLens(value as EventLens)
    setAnchor(new Date().toISOString())
  }

  const query = useEvents(orgId, {
    search: debouncedSearch.trim() || undefined,
    // The Worker filters on startsAt: 'upcoming' = from now on, 'past' = up to now, 'all' = no
    // range. Note the list is always soonest-first (asc) — for a newest-first Past tab, add
    // ?order=desc on the Worker (the upgrade path is documented in worker/routes/events.ts).
    from: lens === 'upcoming' ? anchor : undefined,
    to: lens === 'past' ? anchor : undefined,
  })
  const rows = query.data?.pages.flat() ?? []
  const searching = debouncedSearch.trim().length > 0

  return (
    <View className="flex-1">
      <Stack.Screen options={{ headerShown: true, title: t('events.title') }} />
      {/* pb-28 keeps the last row tappable above the FAB. */}
      <PageWrapper className="pb-28" onRefresh={() => query.refetch()}>
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={CalendarDays}
            title={t('events.signedOutTitle')}
            description={t('events.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : (
          <>
            <SearchBar
              value={searchInput}
              onChangeText={setSearchInput}
              placeholder={t('events.searchPlaceholder')}
            />
            <SegmentedControl
              value={lens}
              onValueChange={switchLens}
              options={[
                { label: t('events.filterUpcoming'), value: 'upcoming' },
                { label: t('events.filterPast'), value: 'past' },
                { label: t('events.filterAll'), value: 'all' },
              ]}
            />
            <AsyncBoundary
              query={query}
              isEmpty={rows.length === 0}
              loading={<EventListSkeleton />}
              empty={
                searching ? (
                  // No RESULTS (a search found nothing) reads differently than no DATA.
                  <EmptyState
                    icon={SearchX}
                    title={t('events.noResultsTitle')}
                    description={t('events.noResultsBody')}
                  />
                ) : (
                  <EmptyState
                    icon={CalendarPlus}
                    title={t('events.emptyTitle')}
                    description={t('events.emptyBody')}
                    action={
                      <Button label={t('events.emptyCta')} onPress={() => router.push('/events/new')} />
                    }
                  />
                )
              }
            >
              <List>
                {rows.map((event) => (
                  <EventRow key={event.id} item={event} />
                ))}
              </List>
              {query.hasNextPage ? (
                <Button
                  variant="outline"
                  label={t('events.loadMore')}
                  loading={query.isFetchingNextPage}
                  onPress={() => query.fetchNextPage()}
                  className="self-center"
                />
              ) : null}
            </AsyncBoundary>
          </>
        )}
      </PageWrapper>
      {/* FAB sits OUTSIDE the scroll view (sibling of PageWrapper) so it stays pinned.
          accessibilityLabel is required — the icon is its only content. */}
      {session ? (
        <FAB
          icon={Plus}
          accessibilityLabel={t('events.newEventA11y')}
          onPress={() => router.push('/events/new')}
        />
      ) : null}
    </View>
  )
}
