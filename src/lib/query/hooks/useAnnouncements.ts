import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Announcement } from '@/lib/db/schema'

/**
 * useAnnouncements — pinned household notices for the dashboard banner (mirrors useChores). Reads
 * are available to every household member; the Worker gates writes by the mode permission matrix
 * (`editHouseholdSettings` — parents / roommates / office managers, never kids), so the client only
 * mirrors that for UI affordances — never to enforce. GET returns active (pinned, not expired)
 * notices ordered urgent → important → normal, then newest first.
 */
export type AnnouncementPriority = 'normal' | 'important' | 'urgent'

export type AnnouncementInput = {
  title: string
  body?: string | null
  priority?: AnnouncementPriority
  /** ISO-8601 instant, or null to clear the expiry. */
  expiresAt?: string | null
}

export function useAnnouncements(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.announcements(orgId),
    queryFn: () => apiFetch<Announcement[]>(`/api/organizations/${orgId}/announcements`),
    enabled: Boolean(orgId),
  })
}

export function useCreateAnnouncement(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AnnouncementInput) =>
      apiFetch<Announcement>(`/api/organizations/${orgId}/announcements`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.announcements(orgId) }),
  })
}

export function useUpdateAnnouncement(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ announcementId, input }: { announcementId: string; input: Partial<AnnouncementInput> }) =>
      apiFetch<Announcement>(`/api/organizations/${orgId}/announcements/${announcementId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.announcements(orgId) }),
  })
}

/** Soft delete — un-pins the notice so it drops out of the active feed. */
export function useDeleteAnnouncement(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (announcementId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/announcements/${announcementId}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.announcements(orgId) }),
  })
}
