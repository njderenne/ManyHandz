import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { SnoozeRequest, SwapRequest } from '@/lib/db/schema'

/**
 * useRequests — snooze (postpone) + swap (trade) client hooks (mirrors useChores / useAssignments).
 * Reads (the pending queues) are open to every member; the Worker gates the writes by the mode
 * permission matrix. Snoozing for a family kid returns a pending request; for an adult/roommate it
 * applies immediately. Swaps are accepted/declined by the target member. Every mutation invalidates
 * the assignment board (re-dating / reassigning shows up there) plus the relevant request queue.
 */

// --- SNOOZE -------------------------------------------------------------------------------------

export type SnoozeInput = {
  reason?: string
  newDueDate: string // YYYY-MM-DD
  newDueTime?: string | null // HH:MM
}

/** What the snooze endpoint returns: an immediate apply, or a pending request for a parent. */
export type SnoozeResult =
  | { assignment: { id: string; dueDate: string; snoozeCount: number; status: string }; needsApproval: false }
  | { snoozeRequest: SnoozeRequest; needsApproval: true }

/** A pending snooze request enriched with the chore + requester for the approval queue. */
export type SnoozeRequestRow = {
  id: string
  assignmentId: string
  requestedByMemberId: string
  reason: string
  newDueDate: string
  newDueTime: string | null
  status: string
  denialReason: string | null
  createdAt: string
  choreName: string
  choreIcon: string
  memberName: string | null
}

export function useSnoozeRequests(orgId: string, status = 'pending') {
  return useQuery({
    queryKey: [...queryKeys.organizations.snoozeRequests(orgId), status] as const,
    queryFn: () =>
      apiFetch<SnoozeRequestRow[]>(`/api/organizations/${orgId}/snooze-requests?status=${status}`),
    enabled: Boolean(orgId),
  })
}

/** Snooze an assignment — immediate for adults/roommates, a pending request for a family kid. */
export function useSnoozeAssignment(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ assignmentId, input }: { assignmentId: string; input: SnoozeInput }) =>
      apiFetch<SnoozeResult>(`/api/organizations/${orgId}/assignments/${assignmentId}/snooze`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.snoozeRequests(orgId) })
    },
  })
}

export function useApproveSnooze(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/snooze-requests/${requestId}/approve`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.snoozeRequests(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) })
    },
  })
}

export function useDenySnooze(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason: string }) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/snooze-requests/${requestId}/deny`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.snoozeRequests(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) })
    },
  })
}

// --- SWAP ---------------------------------------------------------------------------------------

export type SwapCreateInput = {
  requesterAssignmentId: string
  targetMemberId: string
  targetAssignmentId?: string | null // omit → free swap (hand it over)
  message?: string | null
}

export function useSwapRequests(orgId: string, status = 'pending') {
  return useQuery({
    queryKey: [...queryKeys.organizations.swapRequests(orgId), status] as const,
    queryFn: () =>
      apiFetch<SwapRequest[]>(`/api/organizations/${orgId}/swap-requests?status=${status}`),
    enabled: Boolean(orgId),
  })
}

export function useCreateSwapRequest(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SwapCreateInput) =>
      apiFetch<SwapRequest>(`/api/organizations/${orgId}/swap-requests`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.swapRequests(orgId) }),
  })
}

export function useAcceptSwap(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/swap-requests/${requestId}/accept`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.swapRequests(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) })
    },
  })
}

export function useDeclineSwap(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/swap-requests/${requestId}/decline`, {
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.swapRequests(orgId) }),
  })
}
