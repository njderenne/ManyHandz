import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'

/**
 * usePolls — household polls / quick votes (mirrors useChores). Reads are open to every member; the
 * Worker admin-gates create/close (parents in Family, any member in Roommate) — the client mirrors
 * that for UI affordances only, never to enforce.
 *
 * Tallies and the caller's own selections are DERIVED server-side from poll_vote, so the shaped poll
 * the API returns already carries per-option vote counts + `myVotes`. Anonymous polls omit voter ids.
 */
export type PollOptionResult = { id: string; text: string; votes: number }

export type PollResult = {
  id: string
  question: string
  options: PollOptionResult[]
  allowMultiple: boolean
  isAnonymous: boolean
  closesAt: string | null
  isClosed: boolean
  totalVotes: number
  /** The current member's selected option ids (empty if they haven't voted). */
  myVotes: string[]
  createdByMemberId: string | null
  createdAt: string
}

export type CreatePollInput = {
  question: string
  /** 2–6 option labels; the server generates each option's id. */
  options: string[]
  allowMultiple?: boolean
  isAnonymous?: boolean
  /** ISO datetime; the poll auto-closes once it passes. */
  closesAt?: string | null
}

export function usePolls(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.polls(orgId),
    queryFn: () => apiFetch<PollResult[]>(`/api/organizations/${orgId}/polls`),
    enabled: Boolean(orgId),
  })
}

export function usePoll(orgId: string, pollId: string) {
  return useQuery({
    queryKey: [...queryKeys.organizations.polls(orgId), pollId] as const,
    queryFn: () => apiFetch<PollResult>(`/api/organizations/${orgId}/polls/${pollId}`),
    enabled: Boolean(orgId && pollId),
  })
}

export function useCreatePoll(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePollInput) =>
      apiFetch<PollResult>(`/api/organizations/${orgId}/polls`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.polls(orgId) }),
  })
}

/** Toggle a vote for an option (respects allowMultiple server-side). Returns the fresh poll state. */
export function useVotePoll(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pollId, optionId }: { pollId: string; optionId: string }) =>
      apiFetch<PollResult>(`/api/organizations/${orgId}/polls/${pollId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ optionId }),
      }),
    onSuccess: (_data, { pollId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.polls(orgId) })
      queryClient.invalidateQueries({ queryKey: [...queryKeys.organizations.polls(orgId), pollId] })
    },
  })
}

export function useClosePoll(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pollId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/polls/${pollId}/close`, { method: 'POST' }),
    onSuccess: (_data, pollId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.polls(orgId) })
      queryClient.invalidateQueries({ queryKey: [...queryKeys.organizations.polls(orgId), pollId] })
    },
  })
}
