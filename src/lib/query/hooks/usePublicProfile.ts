import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'

/**
 * usePublicProfile — read side of GET /api/users/:userId/public (worker/routes/users.ts): the
 * allow-listed public view of any user, for "who is this?" surfaces (profile screens, chat
 * headers, member sheets). Same resource-hook shape as useCredits.ts: typed TanStack Query,
 * `enabled` guarded on the id, keyed by the registry (queryKeys.users.publicProfile).
 *
 * There is deliberately no mutation here — the profile is read-only for everyone but its owner,
 * and the moderation actions that live NEXT TO a profile (report/block) belong to
 * useModeration.ts / report-block.tsx. See app/users/[id].tsx for the two wired together.
 */

/** Mirrors the Worker's response shape — the privacy contract lives in worker/routes/users.ts. */
export type PublicProfile = {
  id: string
  name: string
  image: string | null
  /** 'YYYY-MM' — month granularity by design (full signup timestamps are a privacy leak). */
  memberSince: string
  /**
   * True when the CALLER has blocked this user — a snapshot from fetch time. After a block or
   * unblock, the live block list (useBlocks) is fresher: screens should prefer it once loaded,
   * the way app/users/[id].tsx derives its blocked state.
   */
  blocked: boolean
}

/**
 * Fetch a user's public profile. Pass `undefined` while the id is still resolving (e.g. a route
 * param) — the query stays disabled until one is available. A deleted/unknown user surfaces as an
 * ApiError with status 404; screens special-case it into a "user not found" state rather than the
 * generic retry affordance (4xx never retries — see ApiError.shouldRetry).
 */
export function usePublicProfile(userId?: string) {
  return useQuery({
    queryKey: queryKeys.users.publicProfile(userId ?? ''),
    queryFn: () => apiFetch<PublicProfile>(`/api/users/${encodeURIComponent(userId ?? '')}/public`),
    enabled: Boolean(userId),
  })
}
