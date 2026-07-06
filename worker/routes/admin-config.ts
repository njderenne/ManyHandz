import { Hono } from 'hono'
import type { Env } from '../env'
import { VERSION } from '../version'
import { DECLARED_ENV } from '../declared-env'
import { timingSafeEqualStr } from '../lib/timing-safe'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Config reporter for Criterial (the studio admin). Returns the env KEYS this app expects, each
 * with a `hasValue` flag computed from the Worker's runtime env — NEVER the values themselves.
 * Criterial diffs the key set against its template manifest (drift detection) and renders
 * `hasValue` as set vs "declared but empty" in its Environment matrix, so a placeholder like
 * `KEY=# TODO` never reads as a real ✓. This is the one probe only the app itself can answer:
 * Cloudflare secrets are write-only, so "a secret name exists" ≠ "it holds a real value".
 *
 *   GET /api/admin/config   (Authorization: Bearer ADMIN_METRICS_TOKEN)
 *   → { manifestVersion, appSlug, version, templateSeedCommit, env: [{ key, hasValue }, …] }
 *
 * Contract: criterial/docs/TEMPLATE_SYNC.md (manifest v2). Mounted ALWAYS (worker/index.ts →
 * app.route('/api/admin', adminConfigRoutes)) and dormant — 401 — until ADMIN_METRICS_TOKEN is
 * set; the token must be mirrored into Criterial's sync-metrics.yml env block or the app shows
 * "Not reporting" (memory: criterial-registration). Rate-limited under /api/admin/* by index.ts.
 *
 * The key list is the GENERATED `DECLARED_ENV` (worker/declared-env.ts) — never hand-maintained.
 * After any env.ts change run `node builder/generate/declared-env.js`; declared-env.test.ts fails
 * the suite while the generated file is stale. Build-time vars (EXPO_PUBLIC_*) aren't visible to
 * the Worker, so they aren't reported here.
 */
export const adminConfigRoutes = new Hono<{ Bindings: Env }>()

/** The template manifest version this app reports against (matches Criterial's TEMPLATE_SYNC). */
const MANIFEST_VERSION = 2

/**
 * The slug Criterial keys this app's metrics by — REQUIRED equal to the wrangler.toml `name`
 * (memory: criterial-registration). Derived from APP_CONFIG.name with the same transform as the
 * rate limiter's KV prefix (worker/middleware/rate-limit.ts) so the file stays byte-identical
 * fleet-wide with zero extra mint knobs: 'App Template' → 'app-template'. The readiness doctor
 * (builder/verify/readiness.js) asserts this derivation equals the wrangler name and FAILs the
 * admin row on mismatch — rename one side rather than hand-editing this constant.
 */
const APP_SLUG = APP_CONFIG.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * Treat empties, inline-comment-only values, and the common mint placeholders as "no value" —
 * so `KEY=# TODO` or `KEY=your_key_here` reports hasValue:false, not a false ✓ in Criterial.
 */
const PLACEHOLDER =
  /^(#|your[_-]|change[_-]?me|replace|x{3,}|todo\b|example\b|placeholder|generate-|<.*>|\.\.\.$|re_your|sk_your|rk_your)/i

/** Exported for declared-env.test.ts — the semantics are part of the Criterial contract. */
export function hasRealValue(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  let v = raw.trim()
  // Strip a trailing inline comment (` # like this`) before judging emptiness.
  const h = v.indexOf(' #')
  if (h >= 0) v = v.slice(0, h).trim()
  if (!v) return false
  return !PLACEHOLDER.test(v)
}

adminConfigRoutes.get('/config', (c) => {
  // 401 (not 404) in every unauthorized case INCLUDING token-unset: Criterial treats 401 as the
  // honest "reporter present, token not wired" state, distinct from a 404 "no reporter at all".
  // Constant-time compare (worker/lib/timing-safe.ts) — never `!==` on a credential.
  const token = c.env.ADMIN_METRICS_TOKEN
  const auth = c.req.header('authorization')
  if (!token || !timingSafeEqualStr(auth ?? '', `Bearer ${token}`)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const envObj = c.env as unknown as Record<string, unknown>
  const env = DECLARED_ENV.map((key) => ({ key, hasValue: hasRealValue(envObj[key]) }))
  return c.json({
    manifestVersion: MANIFEST_VERSION,
    appSlug: APP_SLUG,
    version: VERSION,
    // Template-lineage stamp — null until the Phase-2 registry mints it; the field ships NOW so
    // Criterial's cross-check contract is stable (absent vs null vs sha are three honest states).
    templateSeedCommit: null,
    env,
  })
})
