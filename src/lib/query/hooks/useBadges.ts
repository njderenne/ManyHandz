import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { CustomBadge, HouseholdMilestone } from '@/lib/db/schema'

/**
 * useBadges — the recognition layer's client hooks (mirrors useChores). Reads are open to every
 * household member; the Worker gates writes by the mode permission matrix (`createChores`, the same
 * gate as the chore library), so the client only mirrors that for UI affordances — never to enforce.
 *
 * Two badge kinds: CUSTOM (parent/admin-authored, CRUD + manual award/revoke here) and SYSTEM
 * (code-defined catalog the Worker returns; auto-award is server-side).
 */

/** The custom-badge criteria a household can author (mirrors the Worker's BADGE_CRITERIA_TYPES). */
export type BadgeCriteriaType =
  | 'manual'
  | 'chore_count'
  | 'category_count'
  | 'streak'
  | 'speed_bonus_count'
  | 'points_total'

export type BadgeInput = {
  name: string
  description: string
  icon?: string
  color?: string
  criteriaType: BadgeCriteriaType
  criteriaTarget?: number | null
  criteriaCategoryId?: string | null
}

/** A code-defined system badge as returned by the Worker (definition only; unlock is data). */
export type SystemBadge = {
  key: string
  name: string
  description: string
  icon: string
  category: 'beginner' | 'consistency' | 'points' | 'skill' | 'fairness' | 'level' | 'social'
  threshold: number | null
}

/** GET /badges → the household's custom library + the full system catalog. */
export type BadgeLibrary = { custom: CustomBadge[]; system: SystemBadge[] }

/** One member's trophy case (GET /members/:memberId/badges). */
export type MemberBadgeCustomAward = {
  awardId: string
  badgeId: string
  name: string
  description: string
  icon: string
  color: string
  criteriaType: BadgeCriteriaType
  awardedAt: string
  awardedByMemberId: string | null
}
export type MemberSystemBadge = SystemBadge & { earned: boolean; unlockedAt: string | null }
export type MemberBadges = {
  member: {
    memberId: string
    userId: string
    displayName: string | null
    avatarUrl: string | null
    favoriteColor: string
  }
  customAwards: MemberBadgeCustomAward[]
  systemBadges: MemberSystemBadge[]
  milestones: HouseholdMilestone[]
}

// --- Reads ---

export function useBadges(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.customBadges(orgId),
    queryFn: () => apiFetch<BadgeLibrary>(`/api/organizations/${orgId}/badges`),
    enabled: Boolean(orgId),
  })
}

export function useMemberBadges(orgId: string, memberId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.memberBadges(orgId, memberId),
    queryFn: () => apiFetch<MemberBadges>(`/api/organizations/${orgId}/members/${memberId}/badges`),
    enabled: Boolean(orgId && memberId),
  })
}

export function useMilestones(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.milestones(orgId),
    queryFn: () => apiFetch<HouseholdMilestone[]>(`/api/organizations/${orgId}/milestones`),
    enabled: Boolean(orgId),
  })
}

// --- Custom badge CRUD ---

export function useCreateBadge(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: BadgeInput) =>
      apiFetch<CustomBadge>(`/api/organizations/${orgId}/badges`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.customBadges(orgId) }),
  })
}

export function useUpdateBadge(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ badgeId, input }: { badgeId: string; input: Partial<BadgeInput> }) =>
      apiFetch<CustomBadge>(`/api/organizations/${orgId}/badges/${badgeId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.customBadges(orgId) }),
  })
}

export function useDeleteBadge(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (badgeId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/badges/${badgeId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.customBadges(orgId) }),
  })
}

// --- Manual award / revoke ---

export function useAwardBadge(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ badgeId, memberId }: { badgeId: string; memberId: string }) =>
      apiFetch(`/api/organizations/${orgId}/badges/${badgeId}/award`, {
        method: 'POST',
        body: JSON.stringify({ memberId }),
      }),
    onSuccess: (_data, { memberId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.customBadges(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.memberBadges(orgId, memberId) })
    },
  })
}

export function useRevokeBadge(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ badgeId, memberId }: { badgeId: string; memberId: string }) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/badges/${badgeId}/award/${memberId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, { memberId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.customBadges(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.memberBadges(orgId, memberId) })
    },
  })
}
