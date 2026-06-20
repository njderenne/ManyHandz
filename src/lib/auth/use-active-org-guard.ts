import { useEffect, useRef } from 'react'
import { authClient } from '@/lib/auth/client'

/**
 * useActiveOrgGuard — closes the "create → activate" limbo.
 *
 * A user can end up signed in with organization memberships but NO active organization set on the
 * current session — e.g. they created their org on the web, then opened the native app (the
 * session is fresh and `activeOrganizationId` is null). Without this guard the Team screen would
 * ask them to "create" (they already have one) and then to "activate" it by tapping — confusing.
 *
 * This guard auto-activates the sole membership: once the session and the org list have resolved,
 * if there is exactly ONE organization and none is active, it calls `organization.setActive` for
 * it. Better-Auth's reactive `useActiveOrganization`/`useListOrganizations` atoms then update
 * every consumer, so the user lands straight inside their org.
 *
 * Safety / idempotency:
 *  - Only fires for a single, unambiguous membership (count === 1). With 0 orgs there's nothing to
 *    activate; with 2+ we must NOT guess — the user picks on the Team screen.
 *  - `attemptedRef` records the org id we've tried so a re-render (or a transient null while the
 *    active-org atom refetches) can't trigger a second `setActive`, avoiding any loop.
 *  - Fully fail-open: any error is swallowed. The Team screen's manual tap-to-activate still works
 *    as the fallback, exactly as before.
 *  - Platform-agnostic: imports the shared `authClient` surface, so Metro's native (client.ts) and
 *    web (client.web.ts) builds both get the same behavior.
 */
export function useActiveOrgGuard(): void {
  const { data: session } = authClient.useSession()
  const { data: orgs } = authClient.useListOrganizations()
  const { data: activeOrg, isPending: activePending } = authClient.useActiveOrganization()

  // Remembers the org id we've already asked to activate, so we never fire setActive twice.
  const attemptedRef = useRef<string | null>(null)

  useEffect(() => {
    // Wait until the session and org list have resolved, and the active-org atom has settled.
    if (!session || activePending) return
    // Already inside an org (or already attempted to enter this one) — nothing to do.
    if (activeOrg) return
    if (!orgs || orgs.length !== 1) return

    const soleOrg = orgs[0]
    if (attemptedRef.current === soleOrg.id) return
    attemptedRef.current = soleOrg.id

    authClient.organization.setActive({ organizationId: soleOrg.id }).catch(() => {
      // Fail-open: clear the marker so a later mount can retry; manual tap-to-activate still works.
      attemptedRef.current = null
    })
  }, [session, orgs, activeOrg, activePending])
}
