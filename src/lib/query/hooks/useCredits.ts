import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { CreditLedgerEntry } from '@/lib/db/schema'

/**
 * useCredits — read-side hooks for the credit ledger (worker/routes/credits.ts). Same resource
 * shape as useNotifications.ts: org-scoped query keys, `enabled` guarded on orgId, and cursor
 * pagination via useInfiniteQuery.
 *
 * READ-ONLY by design: there are no client mutations because clients never mint or burn points —
 * the Worker awards/spends via worker/credits.ts after state changes it verified itself. After an
 * action the client knows earns credits, invalidate the org's credit keys (prefix
 * `['organizations', orgId, 'credits']` sweeps balance AND history):
 *
 *   queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'credits'] })
 */

/** GET /credits/balance response. */
type BalanceResponse = { balance: number }

/**
 * Cache key for one balance: the canonical key for the all-kinds sum, extended with the kind for
 * narrowed sums — different server responses must never share a cache entry. The canonical key
 * stays the PREFIX, so invalidating `creditBalance(orgId)` sweeps every kind variant too (same
 * suffix trick as useNotifications' infinite key).
 */
const balanceKey = (orgId: string, kind?: string) =>
  kind
    ? ([...queryKeys.organizations.creditBalance(orgId), kind] as const)
    : queryKeys.organizations.creditBalance(orgId)

/**
 * Current credit balance for the caller in this org — `data` is the plain number.
 * Pass `kind` to narrow to one ledger namespace (e.g. 'reward_points'); omit for the combined sum.
 */
export function useCreditBalance(orgId: string, kind?: string) {
  return useQuery({
    queryKey: balanceKey(orgId, kind),
    queryFn: () =>
      apiFetch<BalanceResponse>(
        `/api/organizations/${orgId}/credits/balance${
          kind ? `?kind=${encodeURIComponent(kind)}` : ''
        }`,
      ),
    select: (data) => data.balance,
    enabled: Boolean(orgId),
  })
}

/** Matches the Worker's `.limit(50)` — a short page means we've reached the end. */
const PAGE_SIZE = 50

/**
 * The caller's ledger history, newest first, cursor-paginated (same pattern as
 * useInfiniteNotifications — the cursor is the createdAt of the last row of the previous page).
 * Render with `data?.pages.flat()`. Keyed directly on the canonical history key: unlike
 * notifications there is no flat variant, so no 'infinite' suffix is needed.
 */
export function useCreditHistory(orgId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.organizations.creditHistory(orgId),
    queryFn: ({ pageParam }) =>
      apiFetch<CreditLedgerEntry[]>(
        `/api/organizations/${orgId}/credits/history${
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
      // Stall guard: each cursor must move STRICTLY older (ISO strings compare chronologically).
      // A repeated or non-decreasing cursor means the server ignored it, or a same-millisecond
      // tie straddles the page boundary — stop paginating rather than loop or thrash.
      // UPGRADE PATH: a composite (createdAt, id) cursor returned explicitly by the Worker
      // (`{ data, nextCursor }`) would paginate THROUGH same-millisecond ties instead of
      // stopping at them — adopt it together with worker/routes/credits.ts if ledgers ever
      // bulk-insert rows sharing a timestamp.
      if (lastPageParam && next >= lastPageParam) return undefined
      return next
    },
    enabled: Boolean(orgId),
  })
}
