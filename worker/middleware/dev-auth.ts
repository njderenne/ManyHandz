import type { MiddlewareHandler } from 'hono'
import type { Env } from '../env'
import { timingSafeEqualStr } from '../lib/timing-safe'

/**
 * Dev-surface hardening for `/api/dev/*` (registered in worker/index.ts BEFORE the dev handlers).
 *
 * The dev routes (/api/dev/email/:template previews, /api/dev/health deep probe) each gate
 * themselves on ENVIRONMENT === 'development' and 404 in production. That per-route discipline is
 * one forgotten `if` away from an exposure, so this middleware adds a second, structural wall:
 *
 *   · ADMIN_METRICS_TOKEN set   → require `Authorization: Bearer <token>` exactly, in EVERY
 *     environment, else 404. Deliberately 404 — NOT 401 — so an unauthenticated scanner can't
 *     even learn the dev surface exists (401 would advertise "something here, bring
 *     credentials"). The token check must NOT defer to ENVIRONMENT: several fleet workers
 *     deliberately commit ENVIRONMENT=development in their production wrangler configs (the
 *     readiness deep probe needs /api/dev/health during polish), and an environment-first
 *     pass-through would exempt exactly the deployments this wall was built to close.
 *   · token unset               → pass through. The routes keep 404ing themselves outside
 *     ENVIRONMENT=development (today's behavior, zero regression on apps that never set the
 *     token), and local dev stays zero-friction because .dev.vars never provisions the token.
 *
 * The Bearer token is the same ADMIN_METRICS_TOKEN the Criterial config reporter uses
 * (worker/routes/admin-config.ts) — one studio credential, two admin surfaces. Tooling that
 * probes /api/dev/* (builder/verify/readiness.js) sends the header for the same reason.
 */
export const devAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const token = c.env.ADMIN_METRICS_TOKEN
  if (!token) return next()

  // Constant-time compare (worker/lib/timing-safe.ts) — never `!==` on a credential.
  if (!timingSafeEqualStr(c.req.header('authorization') ?? '', `Bearer ${token}`)) {
    // Indistinguishable from an unmounted route — don't advertise the surface.
    return c.json({ error: 'not found' }, 404)
  }
  return next()
}
