import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { CalendarEvent } from '@/lib/db/schema'

/**
 * useEvents — THE canonical PRODUCT-RESOURCE hook file, paired with the canonical resource route
 * (worker/routes/events.ts) and the worked-example screens (app/events/). When a minted app adds
 * its own resource, copy this file and rename. It demonstrates:
 *
 *   useEvents        — FILTERED infinite query: the filters live INSIDE the query key, so every
 *                      search/range combination is its own cache entry (back-navigation restores
 *                      instantly) while the org-scoped prefix still sweeps them all.
 *   useEvent         — the detail query, keyed by queryKeys.organizations.eventDetail.
 *   useCreateEvent   — create WITHOUT an optimistic insert (the id and sorted position are the
 *                      server's call) but WITH detail-cache seeding from the 201 body.
 *   useUpdateEvent   — the optimistic UPDATE across both cache shapes (every filtered list
 *                      variant + the detail row), with snapshot/rollback/settle re-sync.
 *   useDeleteEvent   — the optimistic REMOVE, plus removeQueries for the dead detail entry.
 *
 * Debouncing: the SCREEN debounces the search input (app/events/index.tsx) — this hook always
 * receives settled filters. Keeping the debounce out of the hook keeps the cache keys honest:
 * one key per server query, never per keystroke.
 */

/** List filters — mirror the Worker's query params (worker/routes/events.ts GET /events). */
export type EventFilters = {
  /** Case-insensitive substring match on title (the Worker caps it at 200 chars). */
  search?: string
  /** ISO timestamp — events starting at or after it. */
  from?: string
  /** ISO timestamp — events starting at or before it. */
  to?: string
}

/** POST body — `description` is the schema column the screens label "Notes". */
export type CreateEventInput = {
  title: string
  /** ISO timestamp. All-day events: midnight UTC of the chosen day (see schema.ts). */
  startsAt: string
  /** ISO timestamp after startsAt, or null for open-ended. */
  endsAt?: string | null
  allDay?: boolean
  location?: string | null
  description?: string | null
  kind?: string | null
}

/** PATCH body — every field optional; only what's present is updated. null clears nullables. */
export type UpdateEventInput = Partial<CreateEventInput>

/** Matches the Worker's `.limit(50)` — a short page means we've reached the end. */
const PAGE_SIZE = 50

/**
 * Drop empty filter values so `{}`, `{ search: '' }`, and `{ search: undefined }` all hash to
 * the SAME query key — without this, trivially-different filter objects fork the cache.
 */
function normalizeFilters(filters: EventFilters): EventFilters {
  return {
    search: filters.search?.trim() || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  }
}

/**
 * Cache-key prefix for every list variant. 'infinite' suffix: pages are a different cache shape
 * than a flat array (see useNotifications), and the suffix also keeps list keys from ever
 * colliding with detail keys (eventDetail appends the row id at the same depth). All list
 * variants — one per filter combination — live under this prefix, so a single prefix match
 * cancels, patches, or invalidates every one of them.
 */
const listPrefix = (orgId: string) => [...queryKeys.organizations.events(orgId), 'infinite'] as const

/** Full key for ONE filtered list — the normalized filters object is part of the key. */
const listKey = (orgId: string, filters: EventFilters) => [...listPrefix(orgId), filters] as const

/** Build the GET path — query params only for the filters actually set. */
function listPath(orgId: string, filters: EventFilters, cursor: string): string {
  const params: string[] = []
  if (filters.search) params.push(`search=${encodeURIComponent(filters.search)}`)
  if (filters.from) params.push(`from=${encodeURIComponent(filters.from)}`)
  if (filters.to) params.push(`to=${encodeURIComponent(filters.to)}`)
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`)
  return `/api/organizations/${orgId}/events${params.length ? `?${params.join('&')}` : ''}`
}

/**
 * The org's events, soonest first, cursor-paginated and filtered server-side.
 * Render with `data?.pages.flat()`.
 */
export function useEvents(orgId: string, filters: EventFilters = {}) {
  const normalized = normalizeFilters(filters)
  return useInfiniteQuery({
    queryKey: listKey(orgId, normalized),
    queryFn: ({ pageParam }) => apiFetch<CalendarEvent[]>(listPath(orgId, normalized, pageParam)),
    initialPageParam: '',
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.length < PAGE_SIZE) return undefined // short page = no more rows
      const last = lastPage[lastPage.length - 1]
      if (!last) return undefined
      // The Worker cursors by startsAt (`?cursor=<ISO>` → rows strictly after). Rows arrive
      // JSON-serialized, so startsAt is an ISO string at runtime even though the schema type
      // says Date — `new Date()` normalizes both.
      const at = new Date(last.startsAt)
      if (Number.isNaN(at.getTime())) return undefined
      const next = at.toISOString()
      // Stall guard for the ASCENDING list: each cursor must move strictly FORWARD (ISO strings
      // compare chronologically). A non-advancing cursor means the server ignored it, or a
      // same-millisecond tie straddles the page boundary — stop rather than loop. The upgrade
      // path is a composite (startsAt, id) cursor returned by the Worker, adopted together
      // with worker/routes/events.ts.
      if (lastPageParam && next <= lastPageParam) return undefined
      return next
    },
    enabled: Boolean(orgId),
  })
}

/** One event by id — seeded by useCreateEvent's 201 body, patched by useUpdateEvent. */
export function useEvent(orgId: string, eventId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.eventDetail(orgId, eventId),
    queryFn: () => apiFetch<CalendarEvent>(`/api/organizations/${orgId}/events/${eventId}`),
    enabled: Boolean(orgId && eventId),
  })
}

/* ------------------------------------------------------------------------------------------------
 * Mutations — optimistic across BOTH cache shapes (every filtered list variant + the detail row).
 * Hooks stay toast-free: screens own user feedback via per-call options
 * (`mutation.mutate(input, { onError: () => toast(…) })` — same contract as useUserSettings).
 * ---------------------------------------------------------------------------------------------- */

/** Every cached list variant for one org: [key, data] pairs, captured for rollback. */
type ListSnapshot = Array<[QueryKey, InfiniteData<CalendarEvent[], string> | undefined]>

function snapshotLists(queryClient: QueryClient, orgId: string): ListSnapshot {
  // Prefix filter — getQueriesData matches EVERY filter variant under the 'infinite' prefix.
  return queryClient.getQueriesData<InfiniteData<CalendarEvent[], string>>({
    queryKey: listPrefix(orgId),
  })
}

function restoreLists(queryClient: QueryClient, snapshot: ListSnapshot) {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data)
}

/** Apply `patchPage` to every page of every cached list variant for this org. */
function patchLists(
  queryClient: QueryClient,
  orgId: string,
  patchPage: (page: CalendarEvent[]) => CalendarEvent[],
) {
  queryClient.setQueriesData<InfiniteData<CalendarEvent[], string>>(
    { queryKey: listPrefix(orgId) },
    (data) => (data ? { ...data, pages: data.pages.map(patchPage) } : data),
  )
}

/** Mirror the Worker's merge semantics onto a cached row — what the server WILL return. */
function applyOptimistic(previous: CalendarEvent, input: UpdateEventInput): CalendarEvent {
  const next = { ...previous }
  if (input.title !== undefined) next.title = input.title.trim()
  if (input.startsAt !== undefined) next.startsAt = new Date(input.startsAt)
  if (input.endsAt !== undefined) next.endsAt = input.endsAt === null ? null : new Date(input.endsAt)
  if (input.allDay !== undefined) next.allDay = input.allDay
  if (input.location !== undefined) next.location = input.location
  if (input.description !== undefined) next.description = input.description
  if (input.kind !== undefined) next.kind = input.kind
  return next
}

/**
 * Create an event. Deliberately NO optimistic insert: the row's id and its sorted, filtered
 * position are the server's call, and a guessed placeholder that jumps on reconcile feels worse
 * than a spinner. Instead the 201 body seeds the detail cache (so navigating straight to the new
 * event renders instantly) and the list variants are invalidated to refetch in order.
 */
export function useCreateEvent(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateEventInput) =>
      apiFetch<CalendarEvent>(`/api/organizations/${orgId}/events`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (row) => {
      queryClient.setQueryData(queryKeys.organizations.eventDetail(orgId, row.id), row)
    },
    // List prefix only — the detail entry was just seeded fresh; don't mark it stale too.
    onSettled: () => queryClient.invalidateQueries({ queryKey: listPrefix(orgId) }),
  })
}

/**
 * Update an event — THE canonical optimistic update for a resource with list + detail caches:
 * cancel in-flight reads, snapshot both shapes, patch both immediately, roll back on error,
 * re-sync with the server on settle. Note the patch only REWRITES the row in place: a change
 * that moves the event across a filter/sort boundary (e.g. a new date) is corrected by the
 * settled invalidation, not re-derived client-side — don't reimplement the server's query.
 */
export function useUpdateEvent(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ eventId, input }: { eventId: string; input: UpdateEventInput }) =>
      apiFetch<CalendarEvent>(`/api/organizations/${orgId}/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onMutate: async ({ eventId, input }) => {
      // Prefix cancel covers every list variant AND the detail key (hierarchical keys).
      await queryClient.cancelQueries({ queryKey: queryKeys.organizations.events(orgId) })
      const lists = snapshotLists(queryClient, orgId)
      const detailKey = queryKeys.organizations.eventDetail(orgId, eventId)
      const detail = queryClient.getQueryData<CalendarEvent>(detailKey)
      patchLists(queryClient, orgId, (page) =>
        page.map((row) => (row.id === eventId ? applyOptimistic(row, input) : row)),
      )
      if (detail) queryClient.setQueryData(detailKey, applyOptimistic(detail, input))
      return { lists, detail }
    },
    onError: (_err, { eventId }, context) => {
      if (!context) return
      restoreLists(queryClient, context.lists)
      if (context.detail) {
        queryClient.setQueryData(queryKeys.organizations.eventDetail(orgId, eventId), context.detail)
      }
    },
    // Full events prefix: re-syncs the patched detail row AND re-sorts/re-filters the lists.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.events(orgId) }),
  })
}

/**
 * Delete an event — optimistic REMOVAL from every list variant, rollback on error, and
 * `removeQueries` (not invalidate) for the detail entry: a refetch of a deleted row is a
 * guaranteed 404, so the cache entry is dropped instead of marked stale.
 */
export function useDeleteEvent(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (eventId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/events/${eventId}`, {
        method: 'DELETE',
      }),
    onMutate: async (eventId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.organizations.events(orgId) })
      const lists = snapshotLists(queryClient, orgId)
      const detail = queryClient.getQueryData<CalendarEvent>(
        queryKeys.organizations.eventDetail(orgId, eventId),
      )
      patchLists(queryClient, orgId, (page) => page.filter((row) => row.id !== eventId))
      return { lists, detail }
    },
    onError: (_err, eventId, context) => {
      if (!context) return
      restoreLists(queryClient, context.lists)
      if (context.detail) {
        queryClient.setQueryData(queryKeys.organizations.eventDetail(orgId, eventId), context.detail)
      }
    },
    onSuccess: (_data, eventId) => {
      queryClient.removeQueries({ queryKey: queryKeys.organizations.eventDetail(orgId, eventId) })
    },
    // List prefix only — invalidating the (removed) detail key would refetch a 404.
    onSettled: () => queryClient.invalidateQueries({ queryKey: listPrefix(orgId) }),
  })
}
