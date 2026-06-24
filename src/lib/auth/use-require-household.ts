import { useEffect } from 'react'
import { usePathname, useRouter } from 'expo-router'
import { authClient } from '@/lib/auth/client'
import { isPublicRoute } from '@/lib/config/navigation'

/**
 * Household gate — a SIGNED-IN user with NO household is sent to /onboarding (create or join). Pairs
 * with useRequireAuth (which handles signed-OUT) and useActiveOrgGuard (which activates a sole org).
 *
 * Fail-open AND signed-in-only: it never acts while the session/org list is loading, never off
 * onboarding/public routes, and — critically — NEVER for a signed-out user. The auth guard owns the
 * signed-out case (→ /login); if this guard also redirected a signed-out user (→ /onboarding) the two
 * fire in the same commit on the gated "/" route and thrash the navigation store into a "maximum
 * update depth" loop. (Native's useListOrganizations returns an empty list for a signed-out user
 * rather than web's 401 error, so the `error` check alone wasn't enough — the session check is.)
 */
export function useRequireHousehold() {
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { data: orgs, isPending, error } = authClient.useListOrganizations()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    // Do nothing until we KNOW the user is signed in: while the session resolves, or for a signed-out
    // user, this guard stays silent so it can never race useRequireAuth's /login redirect.
    if (sessionPending || !session) return
    // Then fail-open on the org list: only a confirmed-empty list (loaded, no error, zero orgs) is a
    // real "no household" — a transient/auth hiccup must never strand a member on the create screen.
    if (isPending || error) return
    const hasHousehold = Array.isArray(orgs) && orgs.length > 0
    if (!hasHousehold && !pathname.startsWith('/onboarding') && !isPublicRoute(pathname)) {
      router.replace('/onboarding')
    }
  }, [session, sessionPending, isPending, error, orgs, pathname, router])
}
