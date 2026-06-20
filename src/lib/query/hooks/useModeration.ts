import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Report, UserBlock } from '@/lib/db/schema'

/**
 * useModeration — client side of the UGC-safety pair (App Store Guideline 1.2: report + block).
 * Same shape as useNotifications (the canonical resource hook): typed TanStack Query against the
 * Worker, keyed by the org-scoped query key. Unblock is optimistic (removing a cached row can't
 * fabricate state); block waits for the server — an optimistic block would have to invent a row
 * the client can't author (blockerUserId is server-derived) — and re-syncs the cache on settle.
 *
 * Pairs with worker/routes/moderation.ts and the <ReportSheet>/useBlockUser UI in
 * src/components/moderation/report-block.tsx.
 */

/**
 * Report vocabulary — must mirror REPORT_REASONS in worker/routes/moderation.ts (the worker
 * validates against its copy; the client can't import worker code).
 */
export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

/** Stable empty list so `blocks`/`blockedIds` keep their identity before the query resolves. */
const EMPTY_BLOCKS: UserBlock[] = []

export type SubmitReportInput = {
  orgId: string
  /** What kind of entity is being reported (e.g. 'post', 'comment'). Required with entityId. */
  entityType?: string
  entityId?: string
  /** For profile/behavior reports — at least one of entityId / reportedUserId is required. */
  reportedUserId?: string
  reason: ReportReason
  details?: string
}

/**
 * Mutation for POST /api/organizations/:orgId/reports. Fire-and-forget from the UI's point of
 * view — no cache to update (reports land in a moderation queue, not a user-facing list).
 */
export function useReport() {
  return useMutation({
    mutationFn: ({ orgId, ...body }: SubmitReportInput) =>
      apiFetch<Report>(`/api/organizations/${orgId}/reports`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

/**
 * The caller's block list plus block/unblock actions, all keyed by
 * `queryKeys.organizations.blocks(orgId)`. Unblock updates the cache optimistically and rolls
 * back on error; block waits for the server. `onSettled` re-syncs both with the server either way.
 */
export function useBlocks(orgId?: string) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.organizations.blocks(orgId ?? '')

  const query = useQuery({
    queryKey,
    queryFn: () => apiFetch<UserBlock[]>(`/api/organizations/${orgId}/blocks`),
    enabled: Boolean(orgId),
  })

  const blocks = query.data ?? EMPTY_BLOCKS
  const blockedIds = useMemo(() => new Set(blocks.map((b) => b.blockedUserId)), [blocks])

  const blockMutation = useMutation({
    mutationFn: (blockedUserId: string) =>
      apiFetch<{ ok: true }>(`/api/organizations/${orgId}/blocks`, {
        method: 'POST',
        body: JSON.stringify({ blockedUserId }),
      }),
    // No optimistic insert: a client-built row would need a fabricated blockerUserId (it's
    // server-derived), corrupting the cached UserBlock shape. The settled invalidation pulls
    // the real row instead.
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

  const unblockMutation = useMutation({
    mutationFn: (blockedUserId: string) =>
      apiFetch<{ ok: true }>(
        `/api/organizations/${orgId}/blocks/${encodeURIComponent(blockedUserId)}`,
        { method: 'DELETE' },
      ),
    onMutate: async (blockedUserId) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<UserBlock[]>(queryKey)
      queryClient.setQueryData<UserBlock[]>(queryKey, (old = []) =>
        old.filter((b) => b.blockedUserId !== blockedUserId),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

  // Depend on `.mutate`/`.mutateAsync` (stable in TanStack v5), not the mutation object (new
  // every render).
  const blockMutateAsync = blockMutation.mutateAsync
  const unblockMutate = unblockMutation.mutate

  /** Resolves on server confirm, rejects on failure — confirm flows await it (see useBlockUser). */
  const block = useCallback(
    (userId: string) => {
      if (!orgId) return Promise.reject(new Error('No active organization'))
      return blockMutateAsync(userId)
    },
    [orgId, blockMutateAsync],
  )

  const unblock = useCallback(
    (userId: string) => {
      if (!orgId) return
      unblockMutate(userId)
    },
    [orgId, unblockMutate],
  )

  const isBlocked = useCallback((userId: string) => blockedIds.has(userId), [blockedIds])

  return { blocks, blockedIds, block, unblock, isBlocked, isLoading: query.isLoading }
}

/**
 * Drop blocked users' rows from a UGC list — THE helper every list screen runs its
 * user-generated content through before rendering (feeds, comments, search results, …):
 *
 *   const { blockedIds } = useBlocks(orgId)
 *   const visible = filterBlocked(posts ?? [], blockedIds)
 *
 * Filtering happens client-side by design (see schema.ts user_block): server queries stay
 * simple, and a fresh block hides content as soon as the confirmed write re-syncs the cache above.
 */
export function filterBlocked<T extends { userId: string }>(
  rows: T[],
  blockedIds: Set<string>,
): T[] {
  if (blockedIds.size === 0) return rows
  return rows.filter((row) => !blockedIds.has(row.userId))
}
