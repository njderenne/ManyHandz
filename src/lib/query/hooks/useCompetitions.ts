import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Competition } from '@/lib/db/schema'

/**
 * useCompetitions — head-to-head competition hooks (mirrors useChores/useAssignments). Reads are
 * open to every household member; the Worker gates writes by the mode permission matrix
 * (`createCompetitions` + the kid toggle + the kid stakes cap), so the client only mirrors that for
 * UI affordances — never to enforce. Only the OPPONENT may accept/decline a pending challenge.
 */

/** Which slice of a member's competitions to list. */
export type CompetitionStatusFilter = 'active' | 'pending' | 'past'

export type CompetitionType =
  | 'most_points'
  | 'most_completions'
  | 'first_to_target'
  | 'specific_chore_race'

export type CompetitionInput = {
  opponentMemberId: string
  title: string
  competitionType: CompetitionType
  targetValue?: number | null
  choreId?: string | null
  stakesPoints?: number
  stakesDescription?: string | null
  /** ISO date-time; the Worker defaults to a 7-day window when omitted. */
  endsAt?: string
}

export function useCompetitions(orgId: string, status: CompetitionStatusFilter = 'active') {
  return useQuery({
    queryKey: [...queryKeys.organizations.competitions(orgId), status] as const,
    queryFn: () =>
      apiFetch<Competition[]>(`/api/organizations/${orgId}/competitions?status=${status}`),
    enabled: Boolean(orgId),
  })
}

export function useCompetition(orgId: string, id: string) {
  return useQuery({
    queryKey: [...queryKeys.organizations.competitions(orgId), 'detail', id] as const,
    queryFn: () => apiFetch<Competition>(`/api/organizations/${orgId}/competitions/${id}`),
    enabled: Boolean(orgId && id),
  })
}

export function useCreateCompetition(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CompetitionInput) =>
      apiFetch<Competition>(`/api/organizations/${orgId}/competitions`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.competitions(orgId) }),
  })
}

export function useAcceptCompetition(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Competition>(`/api/organizations/${orgId}/competitions/${id}/accept`, {
        method: 'POST',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.competitions(orgId) }),
  })
}

export function useDeclineCompetition(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Competition>(`/api/organizations/${orgId}/competitions/${id}/decline`, {
        method: 'POST',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.competitions(orgId) }),
  })
}
