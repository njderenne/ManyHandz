import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { PointsBreakdown } from '@/lib/manyhandz/points'

/** An assignment row with the chore basics embedded (what the board/list renders). */
export type AssignmentWithChore = {
  id: string
  choreId: string
  assignedToMemberId: string
  rotationGroupId: string | null
  dueDate: string
  dueTime: string | null
  originalDueDate?: string | null
  snoozeCount: number
  checklistProgress: { label: string; done: boolean }[]
  status: string
  skipReason?: string | null
  beforePhotoMediaId: string | null
  createdAt: string
  choreName: string
  choreIcon: string
  difficulty: number
  estimatedMinutes: number
  requiresApproval: boolean
  aiVerificationEnabled: boolean
  categoryId: string | null
  checklist: { label: string; required: boolean }[]
  referencePhotoMediaId: string | null
}

export type AssignmentFilters = {
  from?: string
  to?: string
  status?: string
  assignedToMemberId?: string
}

function queryString(filters: AssignmentFilters): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
  const s = params.toString()
  return s ? `?${s}` : ''
}

export function useAssignments(orgId: string, filters: AssignmentFilters = {}) {
  return useQuery({
    queryKey: [...queryKeys.organizations.assignments(orgId), filters] as const,
    queryFn: () => apiFetch<AssignmentWithChore[]>(`/api/organizations/${orgId}/assignments${queryString(filters)}`),
    enabled: Boolean(orgId),
  })
}

export function useAssignment(orgId: string, id: string) {
  return useQuery({
    queryKey: queryKeys.organizations.assignmentDetail(orgId, id),
    queryFn: () => apiFetch<AssignmentWithChore>(`/api/organizations/${orgId}/assignments/${id}`),
    enabled: Boolean(orgId && id),
  })
}

export type CreateAssignmentInput = { choreId: string; assignedToMemberId: string; dueDate: string; dueTime?: string | null }

export function useCreateAssignment(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAssignmentInput) =>
      apiFetch(`/api/organizations/${orgId}/assignments`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) }),
  })
}

export type UpdateAssignmentInput = Partial<{
  status: string
  checklistProgress: { label: string; done: boolean }[]
  beforePhotoMediaId: string | null
  skipReason: string | null
  assignedToMemberId: string
  dueDate: string
  dueTime: string | null
}>

export function useUpdateAssignment(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAssignmentInput }) =>
      apiFetch(`/api/organizations/${orgId}/assignments/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignmentDetail(orgId, id) })
    },
  })
}

export type CompleteInput = {
  beforePhotoMediaId?: string | null
  afterPhotoMediaId?: string | null
  notes?: string | null
  actualMinutes?: number | null
}
export type CompleteResult = { completion: { id: string; status: string }; breakdown: PointsBreakdown; needsApproval: boolean }

/** Complete an assignment — runs the points engine; pending_approval for a kid, else awarded instantly. */
export function useCompleteAssignment(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ assignmentId, input }: { assignmentId: string; input?: CompleteInput }) =>
      apiFetch<CompleteResult>(`/api/organizations/${orgId}/assignments/${assignmentId}/complete`, {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.completions(orgId, 'pending_approval') })
    },
  })
}

export type PendingCompletion = {
  id: string
  assignmentId: string
  completedByMemberId: string
  completedAt: string
  beforePhotoMediaId: string | null
  afterPhotoMediaId: string | null
  notes: string | null
  pointsEarned: number
  status: string
  choreName: string
  choreIcon: string
  referencePhotoMediaId: string | null
  memberName: string | null
}

/** The parent approval queue (family). */
export function useApprovalQueue(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.completions(orgId, 'pending_approval'),
    queryFn: () => apiFetch<PendingCompletion[]>(`/api/organizations/${orgId}/completions?status=pending_approval`),
    enabled: Boolean(orgId),
  })
}

export function useApproveCompletion(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (completionId: string) =>
      apiFetch(`/api/organizations/${orgId}/completions/${completionId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.completions(orgId, 'pending_approval') })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(orgId) })
    },
  })
}

export function useRejectCompletion(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ completionId, reason }: { completionId: string; reason: string }) =>
      apiFetch(`/api/organizations/${orgId}/completions/${completionId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.completions(orgId, 'pending_approval') })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.assignments(orgId) })
    },
  })
}
