import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { FairnessResult } from '@/lib/manyhandz/fairness'

/**
 * useFairness — the effort-weighted fairness report (mirrors useChores). Read-only and available to
 * every household member: the Worker computes the balance from the credit-of-effort sum and excludes
 * away members; the client just renders. The `period` selector keys the cache so switching periods
 * is instant once each is fetched.
 */

/** The fairness periods the Worker accepts (mirror of the route's enum). */
export const FAIRNESS_PERIODS = ['this_week', 'last_week', 'this_month', 'last_month', 'all_time'] as const
export type FairnessPeriod = (typeof FAIRNESS_PERIODS)[number]

export type FairnessResponse = {
  period: FairnessPeriod
  range: { from: string | null; to: string | null }
  /** The computed fairness (per-member %, deviation, status + the household score/label). */
  fairness: FairnessResult
  /** memberId → display name, for rendering the engine's id-keyed result. */
  memberNames: Record<string, string>
  activeMemberCount: number
  /** Consecutive recent days with zero overdue assignments. */
  zeroOverdueStreakDays: number
}

export function useFairness(orgId: string, period: FairnessPeriod = 'this_week') {
  return useQuery({
    queryKey: queryKeys.organizations.fairness(orgId, period),
    queryFn: () =>
      apiFetch<FairnessResponse>(`/api/organizations/${orgId}/fairness?period=${period}`),
    enabled: Boolean(orgId),
  })
}
