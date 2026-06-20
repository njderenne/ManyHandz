import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { AchievementUnlock } from '@/lib/db/schema'

/**
 * useAchievements — the caller's achievement unlocks in the active org, in the canonical resource
 * hook shape (see useNotifications.ts): a typed TanStack Query against the Worker
 * (worker/routes/achievements.ts), keyed by the org-scoped query key so invalidation is a prefix
 * match.
 *
 * Only FACTS come from the server (which keys unlocked, when). The catalog — titles, icons,
 * tiers — lives in src/lib/achievements.ts; screens join the two:
 *
 *   const { unlockedKeys, unlockByKey } = useAchievements(orgId)
 *   ACHIEVEMENT_LIST.map((def) => {
 *     const unlocked = unlockedKeys.has(def.key)
 *     const unlockedAt = unlockByKey.get(def.key)?.createdAt
 *     …
 *   })
 *
 * There is no unlock MUTATION on purpose: unlocks are server-internal side effects of milestones
 * (worker/achievements.ts). A screen that just performed a milestone action can invalidate
 * queryKeys.organizations.achievements(orgId) to light the new card up immediately.
 */
export function useAchievements(orgId: string) {
  const query = useQuery({
    queryKey: queryKeys.organizations.achievements(orgId),
    queryFn: () => apiFetch<AchievementUnlock[]>(`/api/organizations/${orgId}/achievements`),
    enabled: Boolean(orgId),
  })

  /** Keys the caller has unlocked — O(1) membership checks while rendering the catalog grid. */
  const unlockedKeys = useMemo(
    () => new Set((query.data ?? []).map((u) => u.achievementKey)),
    [query.data],
  )

  /** Full unlock row per key — for unlock dates and metadata on unlocked cards. */
  const unlockByKey = useMemo(
    () => new Map((query.data ?? []).map((u) => [u.achievementKey, u] as const)),
    [query.data],
  )

  return { ...query, unlockedKeys, unlockByKey }
}
