import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { Hono } from 'hono'
import { DECLARED_ENV } from './declared-env'
import { adminConfigRoutes, hasRealValue } from './routes/admin-config'
import { devAuth } from './middleware/dev-auth'
import type { Env } from './env'

/**
 * A2's admin-surface tests: the generated DECLARED_ENV drift guard, the Criterial config
 * reporter's auth + shape contract, and the /api/dev/* production hardening. They live in one
 * file because they guard one surface — the ADMIN_METRICS_TOKEN-gated admin plane.
 */

// ---------------------------------------------------------------------------
// DECLARED_ENV drift guard
// ---------------------------------------------------------------------------

/**
 * Independent re-derivation of the env-key list from worker/env.ts SOURCE — deliberately
 * duplicating builder/generate/declared-env.js's parse (same type-based rule: a 2-space-indented
 * `KEY: string` / `KEY?: string` member of `interface Env`) so a generator bug can't hide behind
 * shared code. If this fails, someone edited env.ts without rerunning
 * `node builder/generate/declared-env.js` — the reporter would silently under-report to Criterial.
 */
function deriveKeysFromEnvTs(): string[] {
  const src = fs.readFileSync(new URL('./env.ts', import.meta.url), 'utf8')
  const open = src.indexOf('export interface Env {')
  const close = src.indexOf('\n}', open)
  expect(open).toBeGreaterThanOrEqual(0)
  expect(close).toBeGreaterThan(open)
  const keys: string[] = []
  for (const line of src.slice(open, close).split('\n')) {
    const m = line.match(/^ {2}([A-Z][A-Z0-9_]*)\??:\s*string\b/)
    if (m) keys.push(m[1])
  }
  return keys
}

describe('DECLARED_ENV — generated file tracks worker/env.ts', () => {
  it('matches a fresh re-derivation from env.ts source (regenerate with builder/generate/declared-env.js)', () => {
    expect([...DECLARED_ENV]).toEqual(deriveKeysFromEnvTs())
  })

  it('excludes the non-string bindings by type, not by name', () => {
    for (const binding of ['ASSETS', 'RATE_LIMIT', 'MEDIA', 'REALTIME_ROOM']) {
      expect(DECLARED_ENV).not.toContain(binding)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(DECLARED_ENV).size).toBe(DECLARED_ENV.length)
  })
})

// ---------------------------------------------------------------------------
// Criterial config reporter — auth + shape
// ---------------------------------------------------------------------------

/** Minimal Env stub — the reporter only reads string keys + ADMIN_METRICS_TOKEN. */
function envStub(overrides: Record<string, unknown> = {}): Env {
  return overrides as unknown as Env
}

const TOKEN = 'test-admin-token'

async function getConfig(env: Env, authHeader?: string) {
  return adminConfigRoutes.request(
    '/config',
    { headers: authHeader ? { authorization: authHeader } : {} },
    env,
  )
}

describe('GET /api/admin/config — Criterial reporter', () => {
  it('401s when ADMIN_METRICS_TOKEN is unset (dormant, even with a header)', async () => {
    const res = await getConfig(envStub(), 'Bearer anything')
    expect(res.status).toBe(401)
  })

  it('401s on a wrong or missing Bearer when the token is set', async () => {
    const env = envStub({ ADMIN_METRICS_TOKEN: TOKEN })
    expect((await getConfig(env)).status).toBe(401)
    expect((await getConfig(env, 'Bearer nope')).status).toBe(401)
    expect((await getConfig(env, TOKEN)).status).toBe(401) // must be `Bearer <token>` exactly
  })

  it('200s on the exact Bearer with the manifest-v2 shape and EVERY declared key', async () => {
    const env = envStub({
      ADMIN_METRICS_TOKEN: TOKEN,
      DATABASE_URL: 'postgres://real',
      APPLE_CLIENT_ID: '# TODO',
    })
    const res = await getConfig(env, `Bearer ${TOKEN}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      manifestVersion: number
      appSlug: string
      version: string
      templateSeedCommit: string | null
      deploy: { gitSha: string | null; deployedAt: string | null }
      env: { key: string; hasValue: boolean }[]
    }
    expect(body.manifestVersion).toBe(2)
    expect(body.appSlug).toBe('manyhandz') // derived from APP_CONFIG.name; == wrangler name
    expect(typeof body.version).toBe('string')
    expect(body.templateSeedCommit).toBeNull() // Phase-2 registry fills it; the FIELD ships now
    expect(body.deploy).toEqual({ gitSha: null, deployedAt: null }) // no stamp in this stub = honest nulls
    expect(body.env.map((e) => e.key)).toEqual([...DECLARED_ENV])
    const byKey = Object.fromEntries(body.env.map((e) => [e.key, e.hasValue]))
    expect(byKey.DATABASE_URL).toBe(true)
    expect(byKey.APPLE_CLIENT_ID).toBe(false) // placeholder ≠ value
    expect(byKey.STRIPE_SECRET_KEY).toBe(false) // undefined ≠ value
    // No values, ever — only key names + booleans leave the worker.
    expect(JSON.stringify(body)).not.toContain('postgres://real')
  })

  it('reports the deploy stamp when the wrapper injected GIT_SHA/DEPLOYED_AT', async () => {
    const env = envStub({
      ADMIN_METRICS_TOKEN: TOKEN,
      GIT_SHA: 'abc1234',
      DEPLOYED_AT: '2026-07-12T00:00:00.000Z',
    })
    const res = await getConfig(env, `Bearer ${TOKEN}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deploy: { gitSha: string | null; deployedAt: string | null } }
    expect(body.deploy).toEqual({ gitSha: 'abc1234', deployedAt: '2026-07-12T00:00:00.000Z' })
  })
})

describe('hasRealValue — placeholder semantics (part of the Criterial contract)', () => {
  it.each([
    ['real-value', true],
    ['  padded  ', true],
    ['value # inline comment', true],
    ['', false],
    ['   ', false],
    ['# TODO', false],
    ['your_key_here', false],
    ['change-me', false],
    ['xxxxx', false],
    ['<paste here>', false],
    [undefined, false],
    [42, false],
  ] as const)('%j → %s', (raw, want) => {
    expect(hasRealValue(raw)).toBe(want)
  })
})

// ---------------------------------------------------------------------------
// devAuth — /api/dev/* production hardening
// ---------------------------------------------------------------------------

/** A stand-in dev surface: devAuth in front of a route that answers 200 when reached. */
function devApp() {
  return new Hono<{ Bindings: Env }>()
    .use('/api/dev/*', devAuth)
    .get('/api/dev/health', (c) => c.json({ ok: true }))
}

describe('devAuth — /api/dev/* hardening', () => {
  it('passes through in development (no token needed)', async () => {
    const res = await devApp().request('/api/dev/health', {}, envStub({ ENVIRONMENT: 'development' }))
    expect(res.status).toBe(200)
  })

  it('production + token set: 404 (not 401 — never advertise the surface) without the Bearer', async () => {
    const env = envStub({ ADMIN_METRICS_TOKEN: TOKEN })
    const bare = await devApp().request('/api/dev/health', {}, env)
    expect(bare.status).toBe(404)
    expect(await bare.json()).toEqual({ error: 'not found' })
    const wrong = await devApp().request(
      '/api/dev/health',
      { headers: { authorization: 'Bearer nope' } },
      env,
    )
    expect(wrong.status).toBe(404)
  })

  it('production + token set: exact Bearer reaches the route', async () => {
    const res = await devApp().request(
      '/api/dev/health',
      { headers: { authorization: `Bearer ${TOKEN}` } },
      envStub({ ADMIN_METRICS_TOKEN: TOKEN }),
    )
    expect(res.status).toBe(200)
  })

  it('production + token unset: falls through (routes keep 404ing themselves — zero regression)', async () => {
    const res = await devApp().request('/api/dev/health', {}, envStub())
    expect(res.status).toBe(200) // the stub route has no self-gate; devAuth itself must not block
  })
})
