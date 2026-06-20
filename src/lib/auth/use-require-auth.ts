import { useEffect } from 'react'
import { Platform } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useSession } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { isPublicRoute } from '@/lib/config/navigation'

export type AuthGateStatus = 'pending' | 'redirecting' | 'allowed'

// Where a signed-out user on a gated route gets sent. 'landing' mode points at the public marketing
// page — but only on WEB; native apps always send a signed-out user to /login (they already installed
// the app, so the marketing pitch is pointless), so the target collapses to /login off-web.
// Computed once at module load on purpose: Platform.OS and authGate.redirectTo are both static for the
// app's lifetime, so there's nothing to recompute per render.
const REDIRECT_TARGET =
  APP_CONFIG.authGate.redirectTo === 'landing' && Platform.OS === 'web' ? '/landing' : '/login'

/**
 * Global auth wall. Mount ONCE in AppShell, after useForceUpdateGate (so a dead build's
 * update-required card still wins) and alongside useActiveOrgGuard. Returns a status the shell
 * renders against:
 *   - 'pending'     — gated route, session still resolving → show a splash, NEVER redirect yet.
 *   - 'redirecting' — gated route, resolved to signed-out → bouncing to the auth screen; keep the
 *                     splash up so the gated UI never paints.
 *   - 'allowed'     — a session exists, OR the route is public (public routes render immediately and
 *                     never wait on the session probe — keeps /login instant on a web cold load).
 *
 * Fail-CLOSED, unlike the org/update guards: an unresolved or errored session holds the splash; it
 * never falls through to the gated app. The only escapes are a real session or a public route.
 *
 * Guards the AppShell navigator tree only — re-mount it in any future root navigator or modal
 * presented OUTSIDE AppShell.
 */
export function useRequireAuth(): AuthGateStatus {
  const { data: session, isPending } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const isPublic = isPublicRoute(pathname)
  const signedOut = !isPending && !session

  useEffect(() => {
    // Signed-out on a gated route → bounce to the auth wall. The router is left untouched while the
    // session is still pending. (We deliberately do NOT bounce a signed-IN user off /login — that
    // would race login.tsx's own post-sign-in replace to /invite/[code] and break the referral flow.)
    if (signedOut && !isPublic) router.replace(REDIRECT_TARGET)
  }, [signedOut, isPublic, router])

  if (isPublic) return 'allowed' // public routes paint immediately — no session wait, no flash
  if (isPending) return 'pending' // gated + still resolving → splash, never the gated UI
  if (session) return 'allowed'
  return 'redirecting' // gated + signed-out → holding the splash while we bounce to the wall
}
