import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { QuickTask } from '@/lib/db/schema'

/**
 * useQuickTasks — lightweight one-off to-dos (mirrors useChores). NO points/gamification: these are
 * plain household checklist items. Any member may create, edit, complete, reopen, or delete one, so
 * the client never gates writes by the permission matrix. The Worker scopes everything by org.
 */
export type QuickTaskInput = {
  title: string
  note?: string | null
  assignedToMemberId?: string | null
  dueDate?: string | null // YYYY-MM-DD
  dueTime?: string | null // HH:MM
}

export function useQuickTasks(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.quickTasks(orgId),
    queryFn: () => apiFetch<QuickTask[]>(`/api/organizations/${orgId}/quick-tasks`),
    enabled: Boolean(orgId),
  })
}

export function useCreateQuickTask(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: QuickTaskInput) =>
      apiFetch<QuickTask>(`/api/organizations/${orgId}/quick-tasks`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.quickTasks(orgId) }),
  })
}

export function useUpdateQuickTask(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: Partial<QuickTaskInput> }) =>
      apiFetch<QuickTask>(`/api/organizations/${orgId}/quick-tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.quickTasks(orgId) }),
  })
}

/** Single-tap complete — sets isCompleted + completedByMemberId + completedAt server-side. */
export function useCompleteQuickTask(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<QuickTask>(`/api/organizations/${orgId}/quick-tasks/${taskId}/complete`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.quickTasks(orgId) }),
  })
}

/** Un-complete — clears the completion fields. */
export function useReopenQuickTask(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<QuickTask>(`/api/organizations/${orgId}/quick-tasks/${taskId}/reopen`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.quickTasks(orgId) }),
  })
}

export function useDeleteQuickTask(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/quick-tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.quickTasks(orgId) }),
  })
}
