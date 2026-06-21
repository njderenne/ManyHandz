import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { ActivityLogEntry } from '@/lib/db/schema'

/**
 * useActivity — the household activity feed + reactions (mirrors useChores/useAssignments). Reads are
 * available to every member; reacting is a universal social action the Worker gates only by
 * membership. The feed is org-scoped and paginated by a createdAt cursor (newest first), and each
 * entry carries its reaction tallies plus which emoji the caller reacted with.
 */

/** The reaction set — named keys, stored verbatim server-side (mirrors REACTION_EMOJIS in the route). */
export const REACTION_EMOJIS = ['thumbsup', 'heart', 'fire', 'star', 'clap'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

/** Count per emoji for one feed entry, e.g. { thumbsup: 3, heart: 1 }. */
export type ReactionTally = Partial<Record<ReactionEmoji, number>> & Record<string, number>

/** A feed entry with its reaction counts and the caller's own reactions. */
export type ActivityFeedEntry = ActivityLogEntry & {
  reactions: ReactionTally
  myReactions: string[]
}

/**
 * The household activity feed, newest first. Pass `cursor` (the createdAt of the last row seen) to
 * page to older entries; the key includes the cursor so each page caches independently.
 */
export function useActivityFeed(orgId: string, cursor?: string) {
  return useQuery({
    queryKey: cursor
      ? ([...queryKeys.organizations.activityFeed(orgId), cursor] as const)
      : queryKeys.organizations.activityFeed(orgId),
    queryFn: () =>
      apiFetch<ActivityFeedEntry[]>(
        `/api/organizations/${orgId}/activity-feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    enabled: Boolean(orgId),
  })
}

export type ToggleReactionResult = { ok: boolean; reacted: boolean; emoji: ReactionEmoji }

/** Toggle a reaction (insert/delete) on one feed entry; invalidates the feed on success. */
export function useToggleReaction(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ activityId, emoji }: { activityId: string; emoji: ReactionEmoji }) =>
      apiFetch<ToggleReactionResult>(
        `/api/organizations/${orgId}/activity-feed/${activityId}/reactions`,
        { method: 'POST', body: JSON.stringify({ emoji }) },
      ),
    // Sweeps every cached page of the feed (the activityFeed key is the shared prefix).
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.activityFeed(orgId) }),
  })
}
