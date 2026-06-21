import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Goal, GoalContribution } from '@/lib/db/schema'

/**
 * useGoals — point-savings goals (family mode). Reads are open to every household member; the Worker
 * gates writes by the mode permission matrix: a member creates goals for themselves
 * (`contributeToOwnGoals`; a kid's start pending_approval until a parent approves), a parent can
 * create for anyone (`createGoalsForAnyone`) and edit/approve/cancel. Contributions deduct the
 * contributor's balance (a negative credit-ledger entry) and bump the goal. Mirrors useChores.
 */
export type GoalInput = {
  title: string
  description?: string | null
  icon?: string
  targetPoints: number
  monetaryValueCents?: number | null
  autoContributeEnabled?: boolean
  autoContributePercentage?: number
  /** Parents only — target another member; omit for the caller's own goal. */
  memberId?: string
}

export type GoalUpdateInput = Partial<{
  title: string
  description: string | null
  icon: string
  targetPoints: number
  monetaryValueCents: number | null
  autoContributeEnabled: boolean
  autoContributePercentage: number
}>

/** A goal plus its contribution history (the detail endpoint). */
export type GoalWithContributions = Goal & { contributions: GoalContribution[] }

export type ContributeResult = { goal: Goal; contributed: number; completed: boolean }

export function useGoals(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.goals(orgId),
    queryFn: () => apiFetch<Goal[]>(`/api/organizations/${orgId}/goals`),
    enabled: Boolean(orgId),
  })
}

export function useGoal(orgId: string, goalId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.goalDetail(orgId, goalId),
    queryFn: () => apiFetch<GoalWithContributions>(`/api/organizations/${orgId}/goals/${goalId}`),
    enabled: Boolean(orgId && goalId),
  })
}

export function useCreateGoal(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GoalInput) =>
      apiFetch<Goal>(`/api/organizations/${orgId}/goals`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.goals(orgId) }),
  })
}

export function useUpdateGoal(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ goalId, input }: { goalId: string; input: GoalUpdateInput }) =>
      apiFetch<Goal>(`/api/organizations/${orgId}/goals/${goalId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { goalId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.goals(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.goalDetail(orgId, goalId) })
    },
  })
}

/** Parent approves a kid-created goal (pending_approval → active). */
export function useApproveGoal(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (goalId: string) =>
      apiFetch<Goal>(`/api/organizations/${orgId}/goals/${goalId}/approve`, { method: 'POST' }),
    onSuccess: (_data, goalId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.goals(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.goalDetail(orgId, goalId) })
    },
  })
}

export function useCancelGoal(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (goalId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/goals/${goalId}/cancel`, { method: 'POST' }),
    onSuccess: (_data, goalId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.goals(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.goalDetail(orgId, goalId) })
    },
  })
}

/** Contribute points from the caller's own balance into a goal (deducts balance, bumps the goal). */
export function useContributeToGoal(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ goalId, points }: { goalId: string; points: number }) =>
      apiFetch<ContributeResult>(`/api/organizations/${orgId}/goals/${goalId}/contribute`, {
        method: 'POST',
        body: JSON.stringify({ points }),
      }),
    onSuccess: (_data, { goalId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.goals(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.goalDetail(orgId, goalId) })
      // Contributing spends points → the member's derived balance changed.
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(orgId) })
    },
  })
}
