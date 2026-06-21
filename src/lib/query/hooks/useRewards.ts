import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Reward, RewardRedemption } from '@/lib/db/schema'

/**
 * useRewards — the rewards-catalog + redemption client hooks (mirrors useChores / useAssignments).
 * Reads are available to every household member; the Worker gates writes by the mode permission
 * matrix (`createRewards` to manage the catalog, `redeemRewards` to redeem, `approveCompletions` to
 * approve/reject), so the client only mirrors that for UI affordances — never to enforce.
 *
 * Redeeming spends points (a NEGATIVE credit-ledger entry on the server), so member-derived balances
 * change — redemption mutations invalidate `members` alongside the rewards keys.
 */
export type RewardInput = {
  name: string
  description?: string | null
  icon?: string
  pointsCost: number
}

/** A redemption row joined with the reward + redeemer basics (what the pending-redemptions list renders). */
export type RedemptionWithReward = {
  id: string
  rewardId: string
  memberId: string
  pointsSpent: number
  status: string
  approvedByMemberId: string | null
  approvedAt: string | null
  redeemedAt: string
  rewardName: string
  rewardIcon: string
  memberName: string | null
}

export type RedeemResult = { redemption: RewardRedemption; settlementId: string | null }

export function useRewards(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.rewards(orgId),
    queryFn: () => apiFetch<Reward[]>(`/api/organizations/${orgId}/rewards`),
    enabled: Boolean(orgId),
  })
}

export function useCreateReward(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RewardInput) =>
      apiFetch<Reward>(`/api/organizations/${orgId}/rewards`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.rewards(orgId) }),
  })
}

export function useUpdateReward(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ rewardId, input }: { rewardId: string; input: Partial<RewardInput> }) =>
      apiFetch<Reward>(`/api/organizations/${orgId}/rewards/${rewardId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.rewards(orgId) }),
  })
}

export function useDeleteReward(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rewardId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/rewards/${rewardId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.rewards(orgId) }),
  })
}

/** Redeem a reward — spends points (server deducts via the ledger) and queues a pending redemption. */
export function useRedeemReward(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rewardId: string) =>
      apiFetch<RedeemResult>(`/api/organizations/${orgId}/rewards/${rewardId}/redeem`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.rewardRedemptions(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.settlements(orgId) })
    },
  })
}

/** Redemption list — pass a status ('pending' for the admin approve/reject queue). */
export function useRewardRedemptions(orgId: string, status?: string) {
  return useQuery({
    queryKey: [...queryKeys.organizations.rewardRedemptions(orgId), status ?? 'all'] as const,
    queryFn: () =>
      apiFetch<RedemptionWithReward[]>(
        `/api/organizations/${orgId}/reward-redemptions${status ? `?status=${encodeURIComponent(status)}` : ''}`,
      ),
    enabled: Boolean(orgId),
  })
}

export function useApproveRedemption(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (redemptionId: string) =>
      apiFetch(`/api/organizations/${orgId}/reward-redemptions/${redemptionId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.rewardRedemptions(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.settlements(orgId) })
    },
  })
}

/** Reject a redemption — the server REFUNDS the spent points, so member balances change too. */
export function useRejectRedemption(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (redemptionId: string) =>
      apiFetch(`/api/organizations/${orgId}/reward-redemptions/${redemptionId}/reject`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.rewardRedemptions(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.settlements(orgId) })
    },
  })
}
