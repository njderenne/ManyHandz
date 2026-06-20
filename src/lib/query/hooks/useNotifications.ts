import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Notification } from '@/lib/db/schema'

/**
 * useNotifications — the canonical resource hook. A typed TanStack Query against the Worker, keyed
 * by the org-scoped query key so invalidation is a prefix match. Copy this shape — one
 * `use<Resource>.ts` per resource — for the whole app (the Worker enforces org/user scoping).
 *
 * useInfiniteNotifications — the canonical PAGINATION pattern: same endpoint with `?cursor=` (the
 * createdAt of the last item of the previous page), pages stitched by useInfiniteQuery. Copy this
 * shape for any list that can outgrow one response.
 *
 * useMarkNotificationsRead / useMarkAllNotificationsRead — the canonical OPTIMISTIC MUTATION
 * pattern: snapshot both cache shapes, patch them immediately, roll back on error, and re-sync
 * with the server on settle. Copy this shape for any write whose result is predictable client-side.
 */
export function useNotifications(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.notifications(orgId),
    queryFn: () => apiFetch<Notification[]>(`/api/organizations/${orgId}/notifications`),
    enabled: Boolean(orgId),
  })
}

/** Matches the Worker's `.limit(50)` — a short page means we've reached the end. */
const PAGE_SIZE = 50

/**
 * Cache key for the paginated variant. 'infinite' suffix: pages are a different cache shape than
 * the flat list, but the org-scoped prefix still matches for invalidation/cancellation.
 */
const infiniteKey = (orgId: string) =>
  [...queryKeys.organizations.notifications(orgId), 'infinite'] as const

export function useInfiniteNotifications(orgId: string) {
  return useInfiniteQuery({
    queryKey: infiniteKey(orgId),
    queryFn: ({ pageParam }) =>
      apiFetch<Notification[]>(
        `/api/organizations/${orgId}/notifications${
          pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.length < PAGE_SIZE) return undefined // short page = no more rows
      const last = lastPage[lastPage.length - 1]
      if (!last) return undefined
      // The Worker cursors by createdAt (`?cursor=<ISO timestamp>` → strictly older rows). Rows
      // arrive JSON-serialized, so createdAt is an ISO string at runtime even though the schema
      // type says Date — `new Date()` normalizes both.
      const at = new Date(last.createdAt)
      if (Number.isNaN(at.getTime())) return undefined
      const next = at.toISOString()
      // Defensive: a repeated cursor means the server ignored it — stop paginating, don't loop.
      if (next === lastPageParam) return undefined
      return next
    },
    enabled: Boolean(orgId),
  })
}

/* ------------------------------------------------------------------------------------------------
 * Read-state mutations — optimistic across BOTH cache shapes (flat list + infinite pages).
 * ---------------------------------------------------------------------------------------------- */

/** Snapshot of every notification cache for one org, for rollback on mutation error. */
type NotificationCaches = {
  flat: Notification[] | undefined
  infinite: InfiniteData<Notification[], string> | undefined
}

function snapshotCaches(queryClient: QueryClient, orgId: string): NotificationCaches {
  return {
    flat: queryClient.getQueryData(queryKeys.organizations.notifications(orgId)),
    infinite: queryClient.getQueryData(infiniteKey(orgId)),
  }
}

function restoreCaches(queryClient: QueryClient, orgId: string, caches: NotificationCaches) {
  queryClient.setQueryData(queryKeys.organizations.notifications(orgId), caches.flat)
  queryClient.setQueryData(infiniteKey(orgId), caches.infinite)
}

/** Apply `patch` to every cached notification row (both shapes) for this org. */
function patchCaches(
  queryClient: QueryClient,
  orgId: string,
  patch: (n: Notification) => Notification,
) {
  queryClient.setQueryData<Notification[]>(queryKeys.organizations.notifications(orgId), (rows) =>
    rows?.map(patch),
  )
  queryClient.setQueryData<InfiniteData<Notification[], string>>(infiniteKey(orgId), (data) =>
    data ? { ...data, pages: data.pages.map((page) => page.map(patch)) } : data,
  )
}

/**
 * Mark specific notifications read (row tap). Optimistic: cached rows flip `isRead` immediately,
 * roll back if the Worker rejects, and a settled invalidation re-syncs either way.
 */
export function useMarkNotificationsRead(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/notifications/read`, {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    onMutate: async (ids) => {
      // Prefix cancel covers the flat AND 'infinite' keys (hierarchical keys, prefix match).
      await queryClient.cancelQueries({ queryKey: queryKeys.organizations.notifications(orgId) })
      const previous = snapshotCaches(queryClient, orgId)
      patchCaches(queryClient, orgId, (n) => (ids.includes(n.id) ? { ...n, isRead: true } : n))
      return previous
    },
    onError: (_err, _ids, previous) => {
      if (previous) restoreCaches(queryClient, orgId, previous)
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.notifications(orgId) }),
  })
}

/**
 * Mark EVERYTHING read (header action). Same optimistic shape as useMarkNotificationsRead, no
 * payload — the Worker scopes the sweep to the session user inside the active org.
 */
export function useMarkAllNotificationsRead(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/notifications/read-all`, {
        method: 'POST',
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.organizations.notifications(orgId) })
      const previous = snapshotCaches(queryClient, orgId)
      patchCaches(queryClient, orgId, (n) => (n.isRead ? n : { ...n, isRead: true }))
      return previous
    },
    onError: (_err, _vars, previous) => {
      if (previous) restoreCaches(queryClient, orgId, previous)
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.notifications(orgId) }),
  })
}

/**
 * Unread count over any fetched slice — derived client-side (no extra endpoint). Feed it
 * `useNotifications` data, or `data?.pages.flat()` from the infinite variant. Pairs with
 * `<UnreadBadge count={…} />` for nav placements.
 */
export function unreadCount(rows: Notification[] | undefined): number {
  return rows?.reduce((acc, n) => acc + (n.isRead ? 0 : 1), 0) ?? 0
}
