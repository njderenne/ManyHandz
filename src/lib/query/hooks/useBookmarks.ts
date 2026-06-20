import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Bookmark } from '@/lib/db/schema'

/**
 * useBookmarks — client side of the universal "save this" primitive (worker/routes/bookmarks.ts).
 * Same shape as useModeration's useBlocks (list query + derived membership Set + optimistic
 * write-back), keyed by the org-scoped query key.
 *
 * How a minted app makes any entity saveable:
 *
 *   1. Pick an entityType slug for the domain row ('recipe', 'listing', 'article', …).
 *   2. Drop <BookmarkButton orgId={orgId} entityType="recipe" entityId={recipe.id} /> on the
 *      card/row/header (src/components/engagement/bookmark-button.tsx) — it self-wires to these
 *      hooks, so cards need no extra plumbing.
 *   3. Build the "Saved" screen from the list: `const { bookmarks } = useBookmarks(orgId)`, then
 *      resolve each row's entityId against the domain query (and skip rows whose entity is gone —
 *      saves are soft references by design; see the Worker's PUT docblock).
 *
 * `kind` namespaces save flavors when an app has more than one ('favorite' default; 'pin',
 * 'watchlist'). A button and a list using the same kind share one cache entry, so a toggle
 * anywhere updates fill state everywhere.
 */

/** Mirrors the schema column default AND keys.ts's `kind ?? 'favorite'` normalization. */
export const DEFAULT_BOOKMARK_KIND = 'favorite'

/** Stable empty list so `bookmarks`/`bookmarkedIds` keep their identity before the query resolves. */
const EMPTY_BOOKMARKS: Bookmark[] = []

/**
 * THE membership-set key format: 'entityType:entityId:kind'. Lives here so the Set producer and
 * every consumer agree on one string shape — never assemble it inline. `kind` is part of the key
 * because membership is PER KIND: a 'pin' on a recipe must not read as bookmarked to a 'favorite'
 * button. Omitted kind folds to the default, so callers and rows always normalize identically.
 */
export function bookmarkEntityKey(entityType: string, entityId: string, kind?: string): string {
  return `${entityType}:${entityId}:${kind ?? DEFAULT_BOOKMARK_KIND}`
}

/**
 * Cache key for one list: the canonical per-kind key, extended with entityType for narrowed
 * lists — different server responses must never share a cache entry. The canonical key stays the
 * PREFIX, so invalidating `bookmarks(orgId, kind)` sweeps every entityType variant too (same
 * suffix trick as useCredits' balanceKey).
 */
const bookmarksKey = (orgId: string, kind?: string, entityType?: string) =>
  entityType
    ? ([...queryKeys.organizations.bookmarks(orgId, kind), entityType] as const)
    : queryKeys.organizations.bookmarks(orgId, kind)

export type BookmarkFilters = {
  /** Save namespace — omit for the 'favorite' default. */
  kind?: string
  /** Narrow to one entity family (e.g. only saved 'recipe' rows). */
  entityType?: string
}

/**
 * The caller's saves in this org (newest first) plus the derived membership Set that drives fill
 * state. Returns:
 *
 *   - `bookmarks`      — the rows, for "Saved" list screens
 *   - `bookmarkedIds`  — Set of bookmarkEntityKey(entityType, entityId, kind) for O(1) membership
 *   - `isBookmarked`   — convenience lookup over that Set (defaults to this hook's filter kind)
 *
 * Flat query over the newest 50 rows (the Worker's `.limit(50)`): a fresh toggle is always the
 * newest row, so fill state is exact for everything recently touched. UPGRADE PATH: an app
 * expecting >50 saves per
 * kind should move this to the useCreditHistory useInfiniteQuery pattern (same Worker cursor
 * contract — `?cursor=<ISO createdAt>`), building the Set from `pages.flat()`.
 */
export function useBookmarks(orgId: string, filters: BookmarkFilters = {}) {
  const { kind, entityType } = filters
  const query = useQuery({
    queryKey: bookmarksKey(orgId, kind, entityType),
    queryFn: () =>
      apiFetch<Bookmark[]>(
        `/api/organizations/${orgId}/bookmarks?kind=${encodeURIComponent(
          kind ?? DEFAULT_BOOKMARK_KIND,
        )}${entityType ? `&entityType=${encodeURIComponent(entityType)}` : ''}`,
      ),
    enabled: Boolean(orgId),
  })

  const bookmarks = query.data ?? EMPTY_BOOKMARKS
  const bookmarkedIds = useMemo(
    () => new Set(bookmarks.map((b) => bookmarkEntityKey(b.entityType, b.entityId, b.kind))),
    [bookmarks],
  )
  // The kind defaults to this hook's filter kind — the Worker already filtered the rows to it,
  // so a caller probing a DIFFERENT kind would always get false (use a second hook instance).
  const isBookmarked = useCallback(
    (type: string, id: string, kindOverride?: string) =>
      bookmarkedIds.has(bookmarkEntityKey(type, id, kindOverride ?? kind)),
    [bookmarkedIds, kind],
  )

  return { bookmarks, bookmarkedIds, isBookmarked, isLoading: query.isLoading }
}

export type ToggleBookmarkInput = {
  entityType: string
  entityId: string
  /** Save namespace — omit for the 'favorite' default. Must match the kind the list was read with. */
  kind?: string
  /**
   * The entity's CURRENT state — derive it from `isBookmarked(...)`, which reflects optimistic
   * patches, so rapid double-taps toggle correctly. true → DELETE (unsave); false → PUT (save).
   */
  bookmarked: boolean
}

/** Keyed so concurrent toggles can see each other (the isMutating guard in onSettled). */
const toggleMutationKey = (orgId: string) => ['organizations', orgId, 'bookmarks', 'toggle'] as const

/**
 * One mutation for both directions: PUTs or DELETEs based on `bookmarked`, with an optimistic
 * cache patch (the derived Set flips immediately) and snapshot rollback on error. Both verbs are
 * idempotent on the Worker (unique index + onConflictDoNothing), so a retry after a flaky network
 * can never duplicate or over-delete.
 *
 * The optimistic INSERT fabricates a placeholder row (synthetic id, empty userId — both
 * server-derived); that's safe here because every consumer keys off entityType/entityId/kind,
 * which the client authors, and the settled invalidation replaces the placeholder with the real
 * row. Hooks stay toast-free — screens own failure feedback via per-call options:
 * `toggle.mutate(input, { onError: () => toast(...) })`.
 */
export function useToggleBookmark(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: toggleMutationKey(orgId),
    mutationFn: ({ entityType, entityId, kind, bookmarked }: ToggleBookmarkInput) =>
      apiFetch<{ ok: true }>(`/api/organizations/${orgId}/bookmarks`, {
        method: bookmarked ? 'DELETE' : 'PUT',
        body: JSON.stringify({ entityType, entityId, kind: kind ?? DEFAULT_BOOKMARK_KIND }),
      }),
    onMutate: async ({ entityType, entityId, kind, bookmarked }) => {
      // Optimistic: cancel in-flight reads (they'd overwrite the patch), snapshot, patch the cache.
      await queryClient.cancelQueries({ queryKey: queryKeys.organizations.bookmarks(orgId, kind) })
      // Patch the two variants this entity can live in, both REBUILT via bookmarksKey — never
      // disassemble a query key by index (key layout is an implementation detail of the key fn).
      // The canonical per-kind list and the list narrowed to THIS entityType are the only caches
      // that can hold the row (variants narrowed to other entityTypes never match it), and every
      // mounted button derives from one of the two, so they all flip together.
      const keys = [bookmarksKey(orgId, kind), bookmarksKey(orgId, kind, entityType)]
      const previous = keys.map(
        (key) => [key, queryClient.getQueryData<Bookmark[]>(key)] as const,
      )
      for (const [key, rows] of previous) {
        if (!rows) continue // variant never fetched — nothing to patch (or roll back)
        if (bookmarked) {
          // Unsave: drop the row.
          queryClient.setQueryData<Bookmark[]>(
            key,
            rows.filter((b) => !(b.entityType === entityType && b.entityId === entityId)),
          )
        } else {
          if (rows.some((b) => b.entityType === entityType && b.entityId === entityId)) continue
          const placeholder: Bookmark = {
            id: `optimistic:${bookmarkEntityKey(entityType, entityId, kind)}`,
            organizationId: orgId,
            userId: '', // server-derived; replaced by the settled refetch
            entityType,
            entityId,
            kind: kind ?? DEFAULT_BOOKMARK_KIND,
            createdAt: new Date(),
          }
          queryClient.setQueryData<Bookmark[]>(key, [placeholder, ...rows])
        }
      }
      return { previous }
    },
    onError: (_err, _input, context) => {
      // Roll back every patched variant to its snapshot — the screen owns the failure toast.
      for (const [key, rows] of context?.previous ?? []) {
        if (rows) queryClient.setQueryData(key, rows)
      }
    },
    // Success or failure, re-sync this kind's lists with the server's truth — but only when THIS
    // is the last toggle in flight. Rapid taps otherwise race: an earlier toggle's refetch could
    // briefly revert a newer optimistic patch (same guard as useUpdateUserSettings).
    onSettled: (_data, _err, { kind }) => {
      if (queryClient.isMutating({ mutationKey: toggleMutationKey(orgId) }) === 1) {
        return queryClient.invalidateQueries({
          queryKey: queryKeys.organizations.bookmarks(orgId, kind),
        })
      }
    },
  })
}
