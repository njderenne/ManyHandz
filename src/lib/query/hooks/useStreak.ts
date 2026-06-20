import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'

/**
 * useStreak / useCheckIn — the client pair for the streaks endpoints
 * (worker/routes/streaks.ts; helpers in worker/streaks.ts). Same shape as the canonical resource
 * hook (useNotifications.ts): a typed query on the org-scoped key, plus a mutation that re-syncs
 * it. The Worker computes the EFFECTIVE state — a broken streak reads as currentCount 0 and the
 * query never 404s (no row = the zero state) — so the client never does day math.
 *
 * Hooks stay toast-free — screens own user feedback per call, e.g. celebrate growth via
 * `checkIn.mutate(undefined, { onSuccess: ({ grew }) => grew && confetti() })`.
 */

/** Client mirror of the Worker's EffectiveStreak (worker/streaks.ts) — keep the two in sync. */
export type EffectiveStreak = {
  kind: string
  /** Effective consecutive-day count — 0 when broken or never started. */
  currentCount: number
  /** All-time high-water mark — survives breaks. */
  longestCount: number
  /** YYYY-MM-DD in the user's timezone at the time of the last activity; null = never. */
  lastActivityDate: string | null
  /** True when today's activity is already recorded — disable the check-in affordance. */
  checkedInToday: boolean
}

/** POST /check-in response — the updated state plus whether the count advanced. */
export type CheckInResult = {
  streak: EffectiveStreak
  /** True when the count advanced (increment or fresh start); false for a same-day repeat. */
  grew: boolean
}

export function useStreak(orgId: string, kind = 'daily') {
  return useQuery({
    queryKey: queryKeys.organizations.streak(orgId, kind),
    queryFn: () =>
      apiFetch<EffectiveStreak>(
        `/api/organizations/${orgId}/streaks/${encodeURIComponent(kind)}`,
      ),
    enabled: Boolean(orgId),
  })
}

/**
 * Record today's activity. Not optimistic — the Worker owns the day math (timezone, increment vs
 * reset), so the cache is seeded from the response instead, then invalidated to re-sync.
 */
export function useCheckIn(orgId: string, kind = 'daily') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<CheckInResult>(
        `/api/organizations/${orgId}/streaks/${encodeURIComponent(kind)}/check-in`,
        { method: 'POST' },
      ),
    // The response IS the fresh row — seed the cache so the flame updates instantly.
    onSuccess: (result) => {
      queryClient.setQueryData<EffectiveStreak>(
        queryKeys.organizations.streak(orgId, kind),
        result.streak,
      )
    },
    // Success or failure, re-sync with the server's truth.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.streak(orgId, kind) }),
  })
}
