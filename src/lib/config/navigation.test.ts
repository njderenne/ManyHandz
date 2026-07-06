import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// navigation.ts pulls lucide-react-native (icon components) — a native ESM package the Node unit
// tier can't load. Icons are opaque values to these tests; stub exactly what PRIMARY_NAV imports.
vi.mock('lucide-react-native', () => ({
  Home: () => null,
  CalendarDays: () => null,
  Scale: () => null,
  Gift: () => null,
  Target: () => null,
  Settings: () => null,
  BarChart3: () => null,
}))

// isPublicRoute reads the RN global __DEV__ for its dev-gallery carve-out; the Node tier has no
// bundler-injected globals. Stub it false — the PRODUCTION posture is what these tests pin.
vi.stubGlobal('__DEV__', false)
import {
  NAV_BY_CONTEXT,
  PRIMARY_NAV,
  activeNavName,
  isNavHidden,
  isPublicRoute,
  navForContext,
  type NavItem,
} from './navigation'
import { DEFAULT_KIND, KIND_CONFIGS, PERSONAL_KIND } from './roles'

/**
 * Navigation config guards (SPINE_SPEC §11.2). Two jobs:
 *
 *  1. The navForContext fallback ladder — a stale/unknown (kind, role) must always resolve to a
 *     renderable tab set, never crash or 404 the shell.
 *  2. The stale-tab guard — every href (and alias root) in PRIMARY_NAV and every NAV_BY_CONTEXT
 *     set must point at a real screen in app/. A tab that 404s is a config bug this catches in CI.
 *
 * Plus the M-2 public-route pin: '/grant' must be reachable signed-out or the account-less
 * share-grant page (app/grant/[code].tsx, A4) is auth-redirected and dead on arrival.
 */

// ─── Expo-router route table, derived from the filesystem ─────────────────

/** Collect every route pathname app/ declares: strip (groups), drop index, keep [params]. */
function collectRoutes(): string[][] {
  // fileURLToPath (not __dirname) — vitest runs test files as ESM, and this stays Windows-safe.
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app')
  const routes: string[][] = []
  const walk = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), [...segments, entry.name])
        continue
      }
      if (!/\.(tsx|ts)$/.test(entry.name)) continue
      const base = entry.name.replace(/\.(tsx|ts)$/, '')
      if (base.startsWith('_') || base.startsWith('+')) continue // _layout, +html, +not-found
      const full = [...segments, base]
        .filter((s) => !(s.startsWith('(') && s.endsWith(')'))) // route groups don't affect the URL
      if (full[full.length - 1] === 'index') full.pop()
      routes.push(full)
    }
  }
  walk(appDir, [])
  return routes
}

/** True when `href` resolves against the route table ([param] segments match anything). */
function hrefResolves(href: string, routes: string[][]): boolean {
  const want = href.split('/').filter(Boolean)
  return routes.some(
    (route) =>
      route.length === want.length &&
      route.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']')) || seg === want[i]),
  )
}

function allNavSets(): Array<{ where: string; items: NavItem[] }> {
  const sets: Array<{ where: string; items: NavItem[] }> = [{ where: 'PRIMARY_NAV', items: PRIMARY_NAV }]
  for (const [kind, byRole] of Object.entries(NAV_BY_CONTEXT)) {
    for (const [role, items] of Object.entries(byRole ?? {})) {
      sets.push({ where: `NAV_BY_CONTEXT.${kind}.${role}`, items })
    }
  }
  return sets
}

describe('navigation — stale-tab guard', () => {
  const routes = collectRoutes()

  it('every href in every nav set points at a real screen in app/', () => {
    for (const { where, items } of allNavSets()) {
      for (const item of items) {
        expect(hrefResolves(item.href, routes), `${where} → '${item.href}' has no screen in app/`).toBe(true)
      }
    }
  })

  it('every nav set is non-empty and has unique tab names', () => {
    for (const { where, items } of allNavSets()) {
      expect(items.length, `${where} is empty`).toBeGreaterThan(0)
      expect(new Set(items.map((i) => i.name)).size, `${where} has duplicate names`).toBe(items.length)
    }
  })
})

describe('navForContext — the SPINE §5 fallback ladder', () => {
  it('1. no kind (loading / signed-out) → PRIMARY_NAV', () => {
    expect(navForContext(undefined, undefined)).toBe(PRIMARY_NAV)
    expect(navForContext(undefined, 'owner')).toBe(PRIMARY_NAV)
  })

  it('2. kind without a NAV_BY_CONTEXT entry → PRIMARY_NAV (personal + legacy junk)', () => {
    // ManyHandz declares all three kinds, so only personal/unknown kinds fall through.
    expect(navForContext(PERSONAL_KIND, 'owner')).toBe(PRIMARY_NAV)
    expect(navForContext('legacy-nope', 'whatever')).toBe(PRIMARY_NAV)
    // Declared kinds resolve their own sets (never the fallback).
    expect(navForContext(DEFAULT_KIND, 'parent')).toBe(NAV_BY_CONTEXT.family?.parent)
    expect(navForContext('roommate', 'roommate')).toBe(NAV_BY_CONTEXT.roommate?.roommate)
  })

  it('prototype-chain kind/role names never resolve to a non-NavItem value', () => {
    // {}['toString'] is truthy via the prototype chain — Object.hasOwn guards against it.
    expect(navForContext('toString', 'toString')).toBe(PRIMARY_NAV)
    expect(navForContext('constructor', 'valueOf')).toBe(PRIMARY_NAV)
  })

  it('3./4. declared entries: role set wins, stale role falls back to defaultJoinerRole set (armed — vacuous while NAV_BY_CONTEXT is empty)', () => {
    for (const [kind, byRole] of Object.entries(NAV_BY_CONTEXT)) {
      const cfg = KIND_CONFIGS[kind as keyof typeof KIND_CONFIGS]
      for (const [role, items] of Object.entries(byRole ?? {})) {
        expect(navForContext(kind, role)).toBe(items)
      }
      const expected = byRole?.[cfg.defaultJoinerRole] ?? PRIMARY_NAV
      expect(navForContext(kind, 'totally-stale-role')).toBe(expected)
    }
  })
})

describe('activeNavName — optional nav param (grindline signature)', () => {
  it('defaults to PRIMARY_NAV — existing call sites unchanged', () => {
    expect(activeNavName('/')).toBe('home')
    expect(activeNavName('/schedule/anything')).toBe('schedule')
    expect(activeNavName('/definitely-not-a-tab')).toBeUndefined()
  })

  it('resolves over a custom nav set, longest prefix wins, aliases honored', () => {
    const icon = PRIMARY_NAV[0].icon
    const nav: NavItem[] = [
      { name: 'home', label: 'Home', icon, href: '/' },
      { name: 'log', label: 'Log', icon, href: '/log' },
      { name: 'stats', label: 'Stats', icon, href: '/stats', aliases: ['/goals'] },
    ]
    expect(activeNavName('/log/123', nav)).toBe('log')
    expect(activeNavName('/goals', nav)).toBe('stats') // alias lights the tab
    expect(activeNavName('/settings', nav)).toBeUndefined()
    expect(activeNavName('/', nav)).toBe('home') // root only wins on exact match
  })
})

describe('public routes — the M-2 grant pin', () => {
  it("'/grant' and '/grant/<code>' are reachable signed-out (A4's account-less page depends on this)", () => {
    expect(isPublicRoute('/grant')).toBe(true)
    expect(isPublicRoute('/grant/ABCDE12345')).toBe(true)
  })

  it('prefix matching stays exact-or-slash — no accidental widening', () => {
    expect(isPublicRoute('/grants')).toBe(false) // the signed-in management screen stays gated
    expect(isPublicRoute('/grantXYZ')).toBe(false)
  })

  it('the public grant page renders without app chrome (nav hidden, like /share)', () => {
    expect(isNavHidden('/grant/ABCDE12345')).toBe(true)
    expect(isNavHidden('/share/token123')).toBe(true)
  })

  it('/onboarding stays public and chrome-less (the context guard redirects there)', () => {
    expect(isPublicRoute('/onboarding')).toBe(true)
    expect(isNavHidden('/onboarding')).toBe(true)
  })
})
