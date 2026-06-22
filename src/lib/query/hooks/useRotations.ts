import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { RotationFrequency } from '@/lib/manyhandz/rotation'

/** An active rotation group with the chore basics embedded (what the rotation list renders). */
export type RotationGroupRow = {
  id: string
  choreId: string
  memberOrder: string[]
  currentIndex: number
  rotationType: 'round_robin' | 'fixed'
  frequency: RotationFrequency
  startDate: string
  choreName: string
  choreIcon: string
}

export type CreateRotationInput = {
  choreId: string
  memberOrder: string[]
  frequency: RotationFrequency
  rotationType?: 'round_robin' | 'fixed'
  startDate: string
}

export function useRotations(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.rotations(orgId),
    queryFn: () => apiFetch<RotationGroupRow[]>(`/api/organizations/${orgId}/rotations`),
    enabled: Boolean(orgId),
  })
}

export function useCreateRotation(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateRotationInput) =>
      apiFetch(`/api/organizations/${orgId}/rotations`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      // Creating a rotation also seeds the first assignment — refresh both.
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.rotations(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) })
    },
  })
}

export function useDeleteRotation(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/organizations/${orgId}/rotations/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.rotations(orgId) }),
  })
}
