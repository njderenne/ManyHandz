import { useEffect } from 'react'
import { usePathname, useRouter } from 'expo-router'
import { authClient } from '@/lib/auth/client'
import { isPublicRoute } from '@/lib/config/navigation'

/**
 * Household gate — a signed-in user with NO household is sent to /onboarding (create or join). Pairs
 * with useRequireAuth (which handles signed-OUT) and useActiveOrgGuard (which activates a sole org).
 * Fail-open: never redirects while the org list is loading, and never off onboarding/public routes —
 * so it can't trap a user or fight the auth gate.
 */
export function useRequireHousehold() {
  const { data: orgs, isPending, error } = authClient.useListOrganizations()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    // Fail-open while loading OR if the org list errored — a transient/auth hiccup must never strand a
    // member who actually HAS a household on the create-household screen. Only a confirmed-empty list
    // (loaded, no error, zero orgs) is a real "no household".
    if (isPending || error) return
    const hasHousehold = Array.isArray(orgs) && orgs.length > 0
    if (!hasHousehold && !pathname.startsWith('/onboarding') && !isPublicRoute(pathname)) {
      router.replace('/onboarding')
    }
  }, [isPending, error, orgs, pathname, router])
}
