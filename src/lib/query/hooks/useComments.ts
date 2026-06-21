import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'

/**
 * useComments — the threaded comments on a single assignment (mirrors useChores). Reads are open to
 * every household member; the Worker authorizes posting (any member) and deletion (author or admin),
 * so the client only mirrors that for UI affordances — never to enforce. The thread is chronological
 * (oldest first) and capped at 50 comments per assignment server-side.
 */
export type AssignmentComment = {
  id: string
  assignmentId: string
  memberId: string | null
  body: string
  createdAt: string
  memberName: string | null
  avatarUrl: string | null
}

export function useComments(orgId: string, assignmentId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.assignmentComments(orgId, assignmentId),
    queryFn: () =>
      apiFetch<AssignmentComment[]>(`/api/organizations/${orgId}/assignments/${assignmentId}/comments`),
    enabled: Boolean(orgId && assignmentId),
  })
}

export function useAddComment(orgId: string, assignmentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      apiFetch<AssignmentComment>(`/api/organizations/${orgId}/assignments/${assignmentId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.assignmentComments(orgId, assignmentId),
      }),
  })
}

export function useDeleteComment(orgId: string, assignmentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<{ ok: boolean }>(
        `/api/organizations/${orgId}/assignments/${assignmentId}/comments/${commentId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.assignmentComments(orgId, assignmentId),
      }),
  })
}
