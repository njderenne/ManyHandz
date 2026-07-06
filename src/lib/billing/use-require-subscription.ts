import { useEffect } from 'react'
import { usePathname, useRouter } from 'expo-router'
import { authClient, useSession } from '@/lib/auth/client'
import { useSubscription } from '@/lib/billing/useSubscription'
import { REQUIRE_SUBSCRIPTION } from '@/lib/config/monetization'

/**
 * Global subscription wall (cadio donor, templatized). Mounted ONCE in AppShell (_layout.tsx),
 * immediately AFTER useRequireAuth (a session is guaranteed by then) and useActiveOrgGuard (so a
 * sole org auto-activates and the org-scoped billing summary can load). A signed-in user whose
 * org is NOT on a paid/trialing plan is bounced to /paywall and can't reach any core screen.
 *
 * The hook is mounted UNCONDITIONALLY (hooks must be called unconditionally); the
 * REQUIRE_SUBSCRIPTION gate lives INSIDE the effect — flipping the business model between
 * freemium and hard-wall B2B is a config change (monetization.requireSubscription), not a code
 * merge. Default false = this whole file is an inert no-op.
 *
 * Fail-SAFE, like the org guard: every not-yet-known state returns early WITHOUT redirecting, so
 * a paying/trialing user is never flash-locked on cold start. The redirect fires ONLY on a
 * positive, fully-resolved unpaid reading:
 *   - exempt route (paywall / auth / account-management) → never bounce (avoids a redirect loop
 *     and keeps sign-out + the billing portal reachable)
 *   - no session → useRequireAuth owns the signed-out case; we never race it
 *   - no active org → org not resolved yet (useSubscription is disabled without one) → PENDING
 *   - summary loading / errored / undefined → fail SAFE, no lock
 *   - resolved to FREE → HARD wall to /paywall
 *
 * The paid-access check is `summary.tier !== 'FREE'` — /summary.tier is ALREADY the effective
 * tier (the server's effectiveTier applies the trial lift + grace clamp), so cadio's client-side
 * trial/grace re-derivation is deliberately DELETED here (invariant BILLING §1.3: the server's
 * coercion is the only one; a client copy is exactly the kind that drifts).
 *
 * Client-side UX enforcement only — the Worker's per-route requireTier stays the real authority.
 */

// Signed-IN routes a user WITHOUT a paid/trialing sub may still reach, so the gate never traps
// them: the paywall itself (the redirect target), the auth screens (sign out / switch account),
// the settings/account screens (which hold "manage subscription" + sign out), and the invite
// deep-links (an unpaid user invited to a paid team must reach "Accept invitation" before they
// can join). The Stripe billing portal opens in an external WebBrowser (not an in-app route), so
// it needs no entry.
const SUBSCRIPTION_EXEMPT = [
  '/paywall',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/landing',
  '/privacy',
  '/terms',
  '/invite',
  '/accept-invite',
  '/settings',
  '/account',
  '/preferences',
  // 0b integration additions (A1 manifest flag, B1/A4 agreed): /grant/[code] is the account-less
  // public grant page (already in PUBLIC_PREFIXES — a signed-in FREE user following a grant deep
  // link must not be walled off it), and /onboarding is the pre-org create-or-join gate (B5) —
  // a require-create app would otherwise ping-pong a context-less unpaid user between walls.
  '/grant',
  '/onboarding',
]

/** True when this pathname is reachable without a paid subscription (no redirect to the wall). */
function isExempt(pathname: string): boolean {
  return SUBSCRIPTION_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function useRequireSubscription(): void {
  const { data: session } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const { data: summary, isLoading, isError } = useSubscription()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!REQUIRE_SUBSCRIPTION) return // freemium default — the wall is config-off
    if (isExempt(pathname)) return // paywall / auth / account-management always reachable
    if (!session) return // signed-out is useRequireAuth's job — never race it
    if (!activeOrg) return // org not resolved yet → summary query disabled → PENDING, fail safe
    if (isLoading || isError || !summary) return // summary not loaded / errored → fail SAFE
    if (summary.tier === 'FREE') router.replace('/paywall') // signed-in + resolved + unpaid → wall
  }, [pathname, session, activeOrg, summary, isLoading, isError, router])
}
