import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { UserSettings } from '@/lib/db/schema'

/**
 * useUserSettings / useUpdateUserSettings — the USER-scoped settings pair for the
 * `user_settings` table (worker/routes/settings.ts; the Worker scopes by session user and
 * creates a default row on first read, so the query never 404s for a signed-in caller).
 *
 * useUpdateUserSettings is the canonical OPTIMISTIC MUTATION pattern: the cache is patched
 * immediately in `onMutate`, rolled back from the snapshot in `onError`, and re-synced with the
 * server in `onSettled`. The hook stays toast-free — screens own user feedback via per-call
 * options: `mutation.mutate(input, { onError: () => toast(...) })`.
 */

/**
 * THE canonical notificationPrefs shape — mirrors the Worker's docblock
 * (worker/routes/settings.ts; keep the two in sync). The column itself is open-shaped jsonb so
 * minted apps can add channels; this type names the channels every app ships with.
 */
export type NotificationPrefs = {
  push: { enabled: boolean }
  email: { enabled: boolean; digest: boolean }
}

/** Client-side mirror of the server defaults: everything on except the weekly digest (opt-in). */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  push: { enabled: true },
  email: { enabled: true, digest: false },
}

/**
 * Overlay stored prefs onto the defaults so reads always see the full shape — older rows (or a
 * null column) simply fall back per channel. Use this instead of reading the jsonb directly.
 */
export function resolveNotificationPrefs(settings: UserSettings | undefined): NotificationPrefs {
  const stored = (settings?.notificationPrefs ?? {}) as Partial<NotificationPrefs>
  return {
    push: { ...DEFAULT_NOTIFICATION_PREFS.push, ...stored.push },
    email: { ...DEFAULT_NOTIFICATION_PREFS.email, ...stored.email },
  }
}

/** PATCH body — every field optional; only what's present is updated. */
export type UpdateUserSettingsInput = {
  /**
   * Shallow-merged BY CHANNEL on the server: send whole channel objects (e.g.
   * `{ email: { enabled: true, digest: false } }`), never a lone flag — a partial channel
   * object would clobber that channel's other flags.
   */
  notificationPrefs?: Partial<NotificationPrefs>
  marketingOptIn?: boolean
  locale?: string
  timezone?: string
  /** ISO timestamp to stamp onboarding done, or null to reset it. */
  onboardingCompletedAt?: string | null
}

export function useUserSettings() {
  return useQuery({
    queryKey: queryKeys.userSettings,
    queryFn: () => apiFetch<UserSettings>('/api/user/settings'),
  })
}

/** Mirror the Worker's merge semantics onto a cached row — what the server WILL return. */
function applyOptimistic(previous: UserSettings, input: UpdateUserSettingsInput): UserSettings {
  const next = { ...previous }
  if (input.notificationPrefs) {
    next.notificationPrefs = {
      ...(previous.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS),
      ...input.notificationPrefs,
    }
  }
  if (input.marketingOptIn !== undefined) next.marketingOptIn = input.marketingOptIn
  if (input.locale !== undefined) next.locale = input.locale
  if (input.timezone !== undefined) next.timezone = input.timezone
  if (input.onboardingCompletedAt !== undefined) {
    next.onboardingCompletedAt =
      input.onboardingCompletedAt === null ? null : new Date(input.onboardingCompletedAt)
  }
  return next
}

export function useUpdateUserSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    // Keyed so concurrent saves can see each other (the isMutating guard in onSettled).
    mutationKey: queryKeys.userSettings,
    mutationFn: (input: UpdateUserSettingsInput) =>
      apiFetch<UserSettings>('/api/user/settings', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onMutate: async (input) => {
      // Optimistic: cancel in-flight reads (they'd overwrite the patch), snapshot, patch the cache.
      await queryClient.cancelQueries({ queryKey: queryKeys.userSettings })
      const previous = queryClient.getQueryData<UserSettings>(queryKeys.userSettings)
      if (previous) {
        queryClient.setQueryData<UserSettings>(queryKeys.userSettings, applyOptimistic(previous, input))
      }
      return { previous }
    },
    onError: (_err, _input, context) => {
      // Roll back to the snapshot — the screen's per-call onError owns the failure toast.
      if (context?.previous) queryClient.setQueryData(queryKeys.userSettings, context.previous)
    },
    // Success or failure, re-sync with the server's truth (also picks up server-side merges) —
    // but only when THIS is the last settings save in flight. Rapid toggles otherwise race: an
    // earlier save's refetch could briefly revert a newer optimistic patch.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: queryKeys.userSettings }) === 1) {
        return queryClient.invalidateQueries({ queryKey: queryKeys.userSettings })
      }
    },
  })
}
