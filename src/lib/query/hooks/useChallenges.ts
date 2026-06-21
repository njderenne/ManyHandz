import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { BonusChallenge } from '@/lib/db/schema'

/**
 * useChallenges — bonus-challenge resource hooks (mirrors useChores). Reads are available to every
 * household member; the Worker gates writes by the mode permission matrix (`createChallenges`, plus
 * the family-kid `allowKidChallenges` toggle), so the client only mirrors that for UI affordances —
 * never to enforce. Resolution + bonus payout happens in the cron, not through these hooks.
 *
 * `pointsMultiplier` is the stored ×10 fixed-point value (15 = 1.5×); divide by 10 to display.
 */
export type ChallengeType = 'double_points' | 'complete_count' | 'no_overdue' | 'custom'

export type ChallengeInput = {
  title: string
  description?: string | null
  challengeType: ChallengeType
  /** Target for complete_count / custom (e.g. number of completions). */
  targetValue?: number | null
  /** Flat bonus paid on success (complete_count / no_overdue / custom). */
  bonusPoints?: number
  /** ×10 fixed-point multiplier for double_points: 10 = 1.0×, 15 = 1.5×, 20 = 2.0×. */
  pointsMultiplier?: number
  /** ISO datetime; defaults to now on the server when omitted. */
  startsAt?: string
  /** ISO datetime; required, must be in the future. */
  endsAt: string
}

/** PATCH payload — challengeType + startsAt are immutable; everything else is editable while active. */
export type ChallengeUpdateInput = {
  title?: string
  description?: string | null
  targetValue?: number | null
  bonusPoints?: number
  pointsMultiplier?: number
  endsAt?: string
}

/** Active challenges (default), newest first. */
export function useChallenges(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.challenges(orgId),
    queryFn: () => apiFetch<BonusChallenge[]>(`/api/organizations/${orgId}/challenges`),
    enabled: Boolean(orgId),
  })
}

/** Past challenges (completed / failed / expired), newest first. */
export function usePastChallenges(orgId: string) {
  return useQuery({
    queryKey: [...queryKeys.organizations.challenges(orgId), 'past'] as const,
    queryFn: () => apiFetch<BonusChallenge[]>(`/api/organizations/${orgId}/challenges?scope=past`),
    enabled: Boolean(orgId),
  })
}

export function useChallenge(orgId: string, challengeId: string) {
  return useQuery({
    queryKey: [...queryKeys.organizations.challenges(orgId), challengeId] as const,
    queryFn: () => apiFetch<BonusChallenge>(`/api/organizations/${orgId}/challenges/${challengeId}`),
    enabled: Boolean(orgId && challengeId),
  })
}

export function useCreateChallenge(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ChallengeInput) =>
      apiFetch<BonusChallenge>(`/api/organizations/${orgId}/challenges`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.challenges(orgId) }),
  })
}

export function useUpdateChallenge(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ challengeId, input }: { challengeId: string; input: ChallengeUpdateInput }) =>
      apiFetch<BonusChallenge>(`/api/organizations/${orgId}/challenges/${challengeId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { challengeId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.challenges(orgId) })
      queryClient.invalidateQueries({ queryKey: [...queryKeys.organizations.challenges(orgId), challengeId] })
    },
  })
}

export function useDeleteChallenge(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (challengeId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/challenges/${challengeId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.challenges(orgId) }),
  })
}
