import { useEffect, useRef } from 'react'
import { usePathname, useRouter, type Href } from 'expo-router'
import { authClient } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { useActiveContext } from '@/lib/context/use-active-context'
import { isPublicRoute } from '@/lib/config/navigation'

/**
 * useContextGuard — the require-a-tenant entry guard (SPINE_SPEC §6.3, grindline donor).
 *
 * Mounted UNCONDITIONALLY in AppShell (app/_layout.tsx, stage-0 wiring) alongside useRequireAuth +
 * useActiveOrgGuard; it gates ITSELF on config: everything below no-ops unless
 * `APP_CONFIG.tenant.onboarding === 'require-create'` (the team-first / multi-kind posture).
 * The default mint ('none', solo-first — autoPersonalOrg covers everyone) pays only a config read.
 *
 * When armed, once a session exists and the org list has resolved, it makes sure the user is
 * pointed at a usable context:
 *   - ZERO contexts            → /onboarding (B5's create-or-join chooser over selectableKinds()).
 *   - 2+ contexts, none active → /onboarding too, which renders a PICKER when contexts already
 *     exist.
 *   - EXACTLY ONE, none active → NOT ours: useActiveOrgGuard auto-activates a sole org, and its
 *     setActive mutation is NOT covered by isLoading (which fences only the initial fetches) — so
 *     we treat 1-org-no-active as still-settling and skip. Redirecting here would race the
 *     auto-activate and strand a fresh sign-in on /onboarding after its picker condition clears.
 *
 * Cooperates with useActiveOrgGuard rather than fighting it: that guard owns the 1-org
 * auto-activate; this one owns "no context to work in". A user with an active context is never
 * redirected. The redirect is a path string on purpose — no import of B5's screen.
 *
 * Fail-open & non-looping:
 *   - Never redirects off a PUBLIC route (so /onboarding itself, /login, legal pages don't bounce).
 *   - Waits for the list to actually resolve (isLoading) before deciding — an in-flight list is
 *     not "zero contexts".
 *   - `redirectedRef` de-dupes so a transient re-render can't fire a second replace.
 */
export function useContextGuard(): void {
  // Hooks are called unconditionally (rules of hooks) — the config gate lives INSIDE the effect.
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { active, contexts, hasContexts, isLoading } = useActiveContext()
  const pathname = usePathname()
  const router = useRouter()
  const redirectedRef = useRef(false)

  useEffect(() => {
    // Config gate (SPINE §6.3): solo-first apps never force onboarding — the personal org exists.
    if (APP_CONFIG.tenant.onboarding !== 'require-create') return
    // Only act for a signed-in user whose context state has fully resolved.
    if (sessionPending || !session) return
    if (isLoading) return
    // Never bounce a public route (covers /onboarding, /login, legal, invite deep links).
    if (isPublicRoute(pathname)) return

    const needsOnboarding = !hasContexts // zero contexts
    // 2+ ONLY: a sole org with no active context is useActiveOrgGuard's auto-activate mid-flight
    // (see the header) — bouncing it to /onboarding would leave the user stranded there.
    const needsPicker = contexts.length > 1 && !active

    if (needsOnboarding || needsPicker) {
      if (redirectedRef.current) return
      redirectedRef.current = true
      // Path-string contract, no import (B1↔B5): app/onboarding.tsx is B5's file and lands at
      // integration, so the typed-routes union doesn't include it yet — hence the Href cast.
      router.replace('/onboarding' as Href)
      return
    }
    // Settled into a usable context — re-arm so a later context loss can redirect again.
    redirectedRef.current = false
  }, [session, sessionPending, isLoading, contexts, hasContexts, active, pathname, router])
}
