import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Chore } from '@/lib/db/schema'

/**
 * useChores — the canonical ManyHandz resource hook (mirrors useNotifications). Reads are available
 * to every household member; the Worker gates writes by the mode permission matrix (`createChores`),
 * so the client only needs to mirror that for UI affordances — never to enforce.
 */
export type ChoreChecklistStep = { label: string; required: boolean }
export type ChoreInput = {
  name: string
  description?: string | null
  categoryId?: string | null
  difficulty?: number
  estimatedMinutes?: number
  icon?: string
  requiresApproval?: boolean
  aiVerificationEnabled?: boolean
  checklist?: ChoreChecklistStep[]
}

export function useChores(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.chores(orgId),
    queryFn: () => apiFetch<Chore[]>(`/api/organizations/${orgId}/chores`),
    enabled: Boolean(orgId),
  })
}

export function useChore(orgId: string, choreId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.choreDetail(orgId, choreId),
    queryFn: () => apiFetch<Chore>(`/api/organizations/${orgId}/chores/${choreId}`),
    enabled: Boolean(orgId && choreId),
  })
}

export function useCreateChore(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ChoreInput) =>
      apiFetch<Chore>(`/api/organizations/${orgId}/chores`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.chores(orgId) }),
  })
}

export function useUpdateChore(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ choreId, input }: { choreId: string; input: Partial<ChoreInput> }) =>
      apiFetch<Chore>(`/api/organizations/${orgId}/chores/${choreId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { choreId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.chores(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.choreDetail(orgId, choreId) })
    },
  })
}

export function useDeleteChore(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (choreId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/chores/${choreId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.chores(orgId) }),
  })
}
