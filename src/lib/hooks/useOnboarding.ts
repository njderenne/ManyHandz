import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authClient } from '@/lib/auth/client'
import { apiFetch } from '@/lib/api/client'
import type { HouseholdMode } from '@/lib/config/modes'

/**
 * Onboarding actions. Create = Better-Auth organization.create + setActive, then the ManyHandz setup
 * (mode, invite code, trial, seed categories). Join = the join-by-code route + setActive. Both
 * invalidate everything so useHouseholdMode + the nav pick up the new household immediately.
 */
function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28)
  return `${base || 'household'}-${Math.random().toString(36).slice(2, 7)}`
}

export type CreateHouseholdInput = { name: string; mode: Exclude<HouseholdMode, 'office'>; timezone?: string }

async function createHousehold(input: CreateHouseholdInput): Promise<string> {
  const res = await authClient.organization.create({ name: input.name.trim(), slug: slugify(input.name) })
  if (res.error || !res.data) throw new Error(res.error?.message ?? 'Could not create your household')
  const orgId = res.data.id
  await authClient.organization.setActive({ organizationId: orgId })
  await apiFetch(`/api/organizations/${orgId}/household/setup`, {
    method: 'POST',
    body: JSON.stringify({ mode: input.mode, timezone: input.timezone }),
  })
  return orgId
}

async function joinHousehold(inviteCode: string): Promise<string> {
  const res = await apiFetch<{ orgId: string }>('/api/households/join', {
    method: 'POST',
    body: JSON.stringify({ inviteCode }),
  })
  await authClient.organization.setActive({ organizationId: res.orgId })
  return res.orgId
}

export function useCreateHousehold() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: createHousehold, onSuccess: () => queryClient.invalidateQueries() })
}

export function useJoinHousehold() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: joinHousehold, onSuccess: () => queryClient.invalidateQueries() })
}
