import type { LucideIcon } from 'lucide-react-native'
import { Home, CalendarDays, Scale, Gift, Target, Settings, BarChart3 } from 'lucide-react-native'
import { roleForJoin, type Kind } from './roles'

/**
 * Navigation config — the app's primary tabs/destinations, declared once. Rebrand/reorder per app
 * here (see builder/MINT.md §5); every href MUST point at a real screen in app/ — a stale entry
 * renders a tab that 404s. The template's entries mirror its real routes (the dev gallery tabs);
 * a minted app replaces them with its product tabs.
 */
export type NavItem = {
  name: string
  label: string
  icon: LucideIcon
  href: string
  /**
   * Extra path prefixes that also light this tab — use when a tab's content lives at a DIFFERENT
   * top-level path than its href. Classic case: a Journal/feed tab at '/' whose entries open at
   * '/entry/[id]' → `aliases: ['/entry']`, so the detail screen keeps Journal lit. Without it, a
   * detail route that shares no prefix with any tab href matches nothing and renders nav-less (the
   * standalone-screen rule). Matched exactly like href (exact, or prefix followed by '/'); the
   * longest match across all hrefs + aliases wins.
   */
  aliases?: string[]
}

/** Fallback tab set (navForContext rule 1/2 — loading, signed-out, or an unknown kind). The
 *  household core screens every ManyHandz role shares; role-specific sets live in NAV_BY_CONTEXT. */
export const PRIMARY_NAV: NavItem[] = [
  { name: 'home', label: 'Home', icon: Home, href: '/', aliases: ['/assignments', '/chores'] },
  { name: 'schedule', label: 'Schedule', icon: CalendarDays, href: '/schedule' },
  { name: 'fairness', label: 'Fairness', icon: Scale, href: '/fairness' },
  { name: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
]

// --- ManyHandz per-(kind, role) tab building blocks (was src/lib/config/mode-nav.ts —
//     folded here per SPINE_SPEC §10.3; MODE_NAV_TABS → NAV_BY_CONTEXT, navTabsFor → navForContext). ---
const HOME: NavItem = { name: 'home', label: 'Home', icon: Home, href: '/', aliases: ['/assignments', '/chores'] }
const SCHEDULE: NavItem = { name: 'schedule', label: 'Schedule', icon: CalendarDays, href: '/schedule' }
const FAIRNESS: NavItem = { name: 'fairness', label: 'Fairness', icon: Scale, href: '/fairness' }
const REWARDS: NavItem = { name: 'rewards', label: 'Rewards', icon: Gift, href: '/rewards' }
const GOALS: NavItem = { name: 'goals', label: 'Goals', icon: Target, href: '/goals' }
const STATS: NavItem = { name: 'stats', label: 'My Stats', icon: BarChart3, href: '/fairness' } // kid "My Stats" maps to the fairness screen
const SETTINGS: NavItem = { name: 'settings', label: 'Settings', icon: Settings, href: '/settings' }

/**
 * Per-(kind, role) tab sets (SPINE_SPEC §5; brief: Design System → bottom nav). navForContext
 * resolves the caller's set; unknown/stale roles fall back to the kind's defaultJoinerRole set.
 */
export const NAV_BY_CONTEXT: Partial<Record<Kind, Record<string, NavItem[]>>> = {
  family: {
    parent: [HOME, SCHEDULE, FAIRNESS, REWARDS, SETTINGS],
    kid: [HOME, GOALS, REWARDS, STATS],
  },
  roommate: {
    roommate: [HOME, SCHEDULE, FAIRNESS, SETTINGS],
  },
  office: {
    manager: [HOME, SCHEDULE, FAIRNESS, SETTINGS],
    colleague: [HOME, SCHEDULE, FAIRNESS, SETTINGS],
  },
}

/**
 * The tab set for a (kind, role) pair — consumed by BOTH nav bars (product-nav.tsx) via
 * useActiveContext(). Resolution order (SPINE §5 — never crash, never 404):
 *   1. no kind (loading / signed-out / personal)  → PRIMARY_NAV
 *   2. kind has no NAV_BY_CONTEXT entry           → PRIMARY_NAV  (the single-kind default mint)
 *   3. the caller's role has a tab set            → it
 *   4. unknown/stale role                         → the kind's defaultJoinerRole tab set
 *      (grindline's ATHLETE_CORE fallback, generalized) → else PRIMARY_NAV
 * Object.hasOwn (not `in`/truthy access) so prototype-chain names ('toString', …) in a stale
 * persisted role can never resolve to a non-NavItem value.
 */
export function navForContext(kind: string | undefined, role: string | undefined): NavItem[] {
  if (!kind) return PRIMARY_NAV
  const byRole = Object.hasOwn(NAV_BY_CONTEXT, kind)
    ? NAV_BY_CONTEXT[kind as Kind]
    : undefined
  if (!byRole) return PRIMARY_NAV
  if (role && Object.hasOwn(byRole, role)) return byRole[role]
  const fallbackRole = roleForJoin(kind, false)
  return Object.hasOwn(byRole, fallbackRole) ? byRole[fallbackRole] : PRIMARY_NAV
}

/**
 * Primary-nav visibility rule (product decision: "persist on content, hide on forms").
 *
 * The nav stays mounted on tab roots AND on pushed content/detail screens (so /children/[id] still
 * shows nav with the Growth tab lit). It hides only on form/modal-style screens — create/edit flows
 * — where nav competes with the form's own actions and a stray tab tap would discard unsaved input.
 * A route is treated as a form when its LAST path segment is one of these (covers /events/new,
 * /children/[id]/edit, …). Add app-specific exceptions here if a content screen ever ends in one.
 *
 * These rules + activeNavName are SHARED by both nav layouts (ProductTabBar bottom bar and
 * ProductTopNav desktop top nav, in src/components/layout/product-nav.tsx) — one rule set, never a
 * forked second navigation tree.
 */
const FORM_ROUTE_SEGMENTS = new Set(['new', 'edit', 'create', 'compose'])

/** Auth/onboarding lives outside the product shell entirely — never show nav there. ('/share' and
 *  '/grant' are the account-less public surfaces — an outsider with a link gets no app chrome.) */
const NAV_HIDDEN_PREFIXES = ['/login', '/signup', '/landing', '/onboarding', '/privacy', '/share', '/grant']

function lastSegment(pathname: string): string {
  const parts = pathname.split('?')[0].split('#')[0].split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

/** True when the primary nav should be hidden for this pathname (forms, modals, auth). */
export function isNavHidden(pathname: string): boolean {
  if (NAV_HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true
  return FORM_ROUTE_SEGMENTS.has(lastSegment(pathname))
}

/**
 * Resolve the active nav item by best (longest) href-prefix match, so a pushed detail screen
 * highlights its parent tab (/children/[id] → the tab whose href is /children). The root '/' href
 * only wins on an exact match — otherwise it would shadow every route as a one-char prefix.
 * `nav` defaults to PRIMARY_NAV; context-aware callers pass `navForContext(kind, role)` so the
 * active-tab resolution runs over the SAME set the bar renders (grindline signature).
 */
export function activeNavName(pathname: string, nav: NavItem[] = PRIMARY_NAV): string | undefined {
  let best: { name: string; len: number } | undefined
  for (const item of nav) {
    // Match the tab's href OR any of its aliases; the longest matching prefix across all items wins.
    for (const prefix of [item.href, ...(item.aliases ?? [])]) {
      const matches =
        prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`)
      if (matches && (!best || prefix.length > best.len)) best = { name: item.name, len: prefix.length }
    }
  }
  return best?.name
}

/**
 * Routes reachable WITHOUT a session — the public allowlist for the auth gate
 * (src/lib/auth/use-require-auth.ts). Everything NOT matched here redirects a signed-out user to the
 * auth wall. Kept separate from NAV_HIDDEN_PREFIXES on purpose: that set answers "show nav chrome?",
 * this one answers "allow unauthenticated?" — they overlap (e.g. /login) but diverge (e.g. /terms and
 * the invite deep links must be public, yet shouldn't hide nav). Matched like the nav prefixes:
 * exact, or prefix followed by '/'.
 */
const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/landing',
  '/onboarding',
  '/privacy',
  '/terms',
  '/invite', // /invite/[code] — a logged-out user can open a referral link; it ends in a sign-in CTA
  '/accept-invite', // /accept-invite/[id] — same: reachable signed-out, prompts to sign in
  '/share', // /share/[token] — a public share link must resolve for someone with no account
  '/grant', // /grant/[code] — the PUBLIC, account-less share-grant view (validated by the grant code, not a session; worker/routes/grant-public.ts)
]

/** True when a signed-out user is allowed on this pathname (no redirect to the auth wall). */
export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true
  // The dev component gallery is template-only (__DEV__) and never ships in a mint — never gate it.
  if (__DEV__ && (pathname === '/components' || pathname.startsWith('/components/'))) return true
  return false
}
