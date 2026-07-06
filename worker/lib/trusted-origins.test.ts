import { describe, it, expect } from 'vitest'
import { buildTrustedOrigins } from './trusted-origins'
import type { Env } from '../env'

/** Minimal Env — buildTrustedOrigins reads BETTER_AUTH_URL + ENVIRONMENT (dev-origin gating).
 *  Defaults to 'development' so the localhost-convenience expectations below exercise dev mode;
 *  the production suite passes 'production' explicitly. */
function env(betterAuthUrl?: string, environment = 'development'): Env {
  return { BETTER_AUTH_URL: betterAuthUrl, ENVIRONMENT: environment } as unknown as Env
}

const SCHEME = 'apptemplate://'

describe('buildTrustedOrigins — apex/www/trailing-dot matrix', () => {
  it('https apex → itself + www sibling + trailing-dot variants of BOTH', () => {
    const list = buildTrustedOrigins(env('https://grindline.app'), { scheme: SCHEME })
    expect(list).toContain('https://grindline.app')
    expect(list).toContain('https://grindline.app.') // the grindline production outage
    expect(list).toContain('https://www.grindline.app')
    expect(list).toContain('https://www.grindline.app.')
  })

  it('www input → gains the apex (+ trailing-dot variants of both)', () => {
    const list = buildTrustedOrigins(env('https://www.example.com'), { scheme: SCHEME })
    expect(list).toContain('https://www.example.com')
    expect(list).toContain('https://www.example.com.')
    expect(list).toContain('https://example.com')
    expect(list).toContain('https://example.com.')
  })

  it('workers.dev deploy URL → itself + trailing-dot, NO www sibling', () => {
    const list = buildTrustedOrigins(env('https://myapp.studio.workers.dev'), { scheme: SCHEME })
    expect(list).toContain('https://myapp.studio.workers.dev')
    expect(list).toContain('https://myapp.studio.workers.dev.')
    expect(list.some((o) => o.includes('www.'))).toBe(false)
  })

  it('deeper custom subdomain gets trailing-dot but no www sibling', () => {
    const list = buildTrustedOrigins(env('https://app.example.com'), { scheme: SCHEME })
    expect(list).toContain('https://app.example.com')
    expect(list).toContain('https://app.example.com.')
    expect(list).not.toContain('https://www.app.example.com')
  })

  it('preserves an explicit port on every variant', () => {
    const list = buildTrustedOrigins(env('https://example.com:8443'), { scheme: SCHEME })
    expect(list).toContain('https://example.com:8443')
    expect(list).toContain('https://example.com.:8443')
    expect(list).toContain('https://www.example.com:8443')
    expect(list).toContain('https://www.example.com.:8443')
  })

  it('strips a trailing slash before expanding', () => {
    const list = buildTrustedOrigins(env('https://grindline.app/'), { scheme: SCHEME })
    expect(list).toContain('https://grindline.app')
    expect(list).not.toContain('https://grindline.app/')
  })
})

describe('buildTrustedOrigins — localhost / IP are untouched', () => {
  it('localhost BETTER_AUTH_URL gets no siblings and no trailing dot', () => {
    const list = buildTrustedOrigins(env('http://localhost:8787'), { scheme: SCHEME })
    expect(list).toContain('http://localhost:8787')
    expect(list).not.toContain('http://localhost.:8787')
    expect(list).not.toContain('http://www.localhost:8787')
  })

  it('raw-IP origin passes through as itself only', () => {
    const list = buildTrustedOrigins(env('http://192.168.1.50:8787'), { scheme: SCHEME })
    expect(list).toContain('http://192.168.1.50:8787')
    expect(list).not.toContain('http://192.168.1.50.:8787')
    expect(list.some((o) => o.includes('www.192'))).toBe(false)
  })
})

describe('buildTrustedOrigins — scheme, extras, defaults, de-dup', () => {
  it('always appends the native scheme; DEV additionally gets both localhost dev origins', () => {
    const list = buildTrustedOrigins(env('https://example.com'), { scheme: SCHEME })
    expect(list).toContain(SCHEME)
    expect(list).toContain('http://localhost:8081')
    expect(list).toContain('http://localhost:8787')
  })

  it('PRODUCTION drops the localhost dev origins (a dev convenience, never a prod trust grant)', () => {
    const list = buildTrustedOrigins(env('https://example.com', 'production'), { scheme: SCHEME })
    expect(list).toContain(SCHEME)
    expect(list).not.toContain('http://localhost:8081')
    expect(list).not.toContain('http://localhost:8787')
  })

  it('production with a localhost BETTER_AUTH_URL still derives that origin (derived ≠ appended)', () => {
    // The standing dev entries are gated, but the DERIVED origin from BETTER_AUTH_URL always
    // survives — an operator who points auth at localhost said so explicitly via config.
    const list = buildTrustedOrigins(env('http://localhost:8787', 'production'), { scheme: SCHEME })
    expect(list).toContain('http://localhost:8787')
    expect(list).not.toContain('http://localhost:8081')
  })

  it('expands `extra` entries like BETTER_AUTH_URL (deploy URL gets its trailing-dot variant)', () => {
    const list = buildTrustedOrigins(env('https://grindline.app'), {
      scheme: SCHEME,
      extra: ['https://grindline.studio.workers.dev'],
    })
    expect(list).toContain('https://grindline.studio.workers.dev')
    expect(list).toContain('https://grindline.studio.workers.dev.')
  })

  it('passes non-URL extras (bare schemes) through verbatim', () => {
    const list = buildTrustedOrigins(env('https://example.com'), {
      scheme: SCHEME,
      extra: ['otherapp://'],
    })
    expect(list).toContain('otherapp://')
  })

  it('de-dups: localhost BETTER_AUTH_URL does not double the standing localhost entry', () => {
    const list = buildTrustedOrigins(env('http://localhost:8787'), { scheme: SCHEME })
    expect(list.filter((o) => o === 'http://localhost:8787')).toHaveLength(1)
    expect(new Set(list).size).toBe(list.length) // no duplicates anywhere
  })

  it('falls back to http://localhost:8787 when BETTER_AUTH_URL is unset (default deploy)', () => {
    const list = buildTrustedOrigins(env(undefined), { scheme: SCHEME })
    expect(list).toContain('http://localhost:8787')
    expect(new Set(list).size).toBe(list.length)
  })
})
