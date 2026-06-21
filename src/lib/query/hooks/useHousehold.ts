import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { HouseholdMode, HouseholdRole } from '@/lib/config/modes'

/**
 * Household + members hooks. `useHousehold` returns the config + the caller's role (what
 * useHouseholdMode reads); `useHouseholdMembers` returns members with derived points/level/streak.
 * Writes are mode-permission-gated server-side.
 */
export type HouseholdConfig = {
  id: string
  name: string
  mode: HouseholdMode
  timezone: string
  inviteCode: string | null
  requirePhotoProof: boolean
  requireApproval: boolean
  leaderboardVisible: boolean
  allowKidGifting: boolean
  allowKidChallenges: boolean
  allowKidCompetitions: boolean
  maxKidCompetitionStakes: number
  aiVerificationEnabled: boolean
  aiVerificationProvider: string
  aiAutoApproveThreshold: number
  aiAutoRejectThreshold: number
  aiMonthlyCostCapCents: number
  healthScore: number
  subscriptionTier: string
  subscriptionStatus: string | null
  trialEndsAt: string | null
}

export type HouseholdResponse = {
  household: HouseholdConfig
  me: { memberId: string; householdRole: HouseholdRole; userId: string }
}

export type HouseholdMember = {
  memberId: string
  userId: string | null
  orgRole: string
  householdRole: HouseholdRole
  displayName: string
  avatarUrl: string | null
  favoriteColor: string
  bio: string | null
  birthday: string | null
  isActive: boolean
  awayUntil: string | null
  awayReason: string | null
  allowanceEnabled: boolean
  pointsBalance: number
  totalXp: number
  level: number
  title: string
  currentStreak: number
  longestStreak: number
}

export function useHousehold(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.household(orgId),
    queryFn: () => apiFetch<HouseholdResponse>(`/api/organizations/${orgId}/household`),
    enabled: Boolean(orgId),
  })
}

export function useHouseholdMembers(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.members(orgId),
    queryFn: () => apiFetch<HouseholdMember[]>(`/api/organizations/${orgId}/members`),
    enabled: Boolean(orgId),
  })
}

export type HouseholdSettingsInput = Partial<
  Pick<
    HouseholdConfig,
    | 'name' | 'timezone' | 'requirePhotoProof' | 'requireApproval' | 'leaderboardVisible'
    | 'allowKidGifting' | 'allowKidChallenges' | 'allowKidCompetitions' | 'maxKidCompetitionStakes'
    | 'aiVerificationEnabled' | 'aiVerificationProvider' | 'aiAutoApproveThreshold'
    | 'aiAutoRejectThreshold' | 'aiMonthlyCostCapCents'
  >
>

export function useUpdateHousehold(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: HouseholdSettingsInput) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/household`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.household(orgId) }),
  })
}

export type MemberUpdateInput = Partial<{
  displayName: string
  avatarUrl: string | null
  bio: string | null
  birthday: string | null
  favoriteColor: string
  awayUntil: string | null
  awayReason: string | null
  muteCelebrations: boolean
  householdRole: HouseholdRole
  isActive: boolean
  allowanceEnabled: boolean
  allowancePayoutType: string
  allowanceAmountCents: number
  allowanceRewardDescription: string | null
  allowanceThresholdPct: number
}>

export function useUpdateMember(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: MemberUpdateInput }) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.household(orgId) })
    },
  })
}
