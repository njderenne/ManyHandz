import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { resolveGrant, grantHasScope, logGrantActivity } from '../lib/access-grant'
import { assertSubjectInOrg } from '../lib/oversight'
import { grantViewComposer, grantActions } from '../grant-config'
import type { Env } from '../env'

/**
 * Access grants — PUBLIC, account-less surface (SUBJECT_SPEC §6.4). NO session: every request is
 * authorized ONLY by the grant code in the path, re-validated on each call (revokedAt IS NULL AND
 * startsAt <= now < expiresAt — resolveGrant, never cached). Scopes are re-checked server-side per
 * action; a pinned grant's subject fence is re-verified per call.
 *
 * Mounted at /api/grant (NOT /api/organizations) — DELIBERATELY outside requireOrg's tree, the
 * pet-pilot sitter-public pattern: a grantee has no account, no session, and no org membership,
 * so the CODE is the whole credential and this file is the only door. The mount is rate-limited
 * (worker/index.ts: 60 req / 5 min per IP) to blunt code-guessing — codes are 32^10, the limiter
 * is defense in depth. requireSession/requireOrg must NEVER appear here.
 *
 *   GET  /api/grant/:code       → { status:'invalid' } (404 — missing and revoked look identical)
 *                                 | { status:'not_started'|'expired', granteeName, startsAt, expiresAt }
 *                                 | { status:'active', granteeName, scopes, expiresAt, orgName, view }
 *                                 + best-effort 'view' activity row
 *   POST /api/grant/:code/act   → { action, subjectId?, details? } — scope re-checked, subject
 *                                 verified against the grant's org AND pin, handler runs, activity
 *                                 row links the created operational row
 *
 * The view payload and action vocabulary are app-owned registries (worker/grant-config.ts) — the
 * chassis ships a curated subject-roster composer and zero actions.
 */
export const grantPublicRoutes = new Hono<{ Bindings: Env }>()

/** Feature-off ⇒ 404 on the whole surface (defense-in-depth under the stage-0 conditional mount). */
grantPublicRoutes.use('*', async (c, next) => {
  if (!APP_CONFIG.features.shareGrants) return c.json({ error: 'not found' }, 404)
  return next()
})

grantPublicRoutes.get('/:code', async (c) => {
  const code = c.req.param('code')
  // Pre-DB shape check: reject garbage before touching Neon (chassis codes are 10 chars; the
  // 4..16 window tolerates app-tuned lengths without becoming a length oracle).
  if (!code || code.length < 4 || code.length > 16) return c.json({ status: 'invalid' }, 404)

  const db = getDb(c.env.DATABASE_URL)
  const res = await resolveGrant(db, code)
  // Missing and revoked are ONE state — no oracle for code-guessers or ex-grantees.
  if (res.status === 'invalid') return c.json({ status: 'invalid' }, 404)
  const grant = res.grant
  if (res.status !== 'active') {
    // Inactive: tell the NAMED grantee when their window is — grant metadata only, zero org data.
    return c.json(
      {
        status: res.status,
        granteeName: grant.granteeName,
        startsAt: grant.startsAt,
        expiresAt: grant.expiresAt,
      },
      200,
    )
  }

  const [org] = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, grant.organizationId))
    .limit(1)

  // The app-owned composer builds the view — ALLOWLISTED fields only (grant-config privacy law).
  const view = await grantViewComposer(db, grant)

  // Audit the page load itself — best-effort (logGrantActivity never throws), so the owner can
  // answer "who looked, when" (SUBJECT_SPEC §7 rule 5).
  await logGrantActivity(db, grant, { action: 'view', subjectId: grant.subjectId })

  return c.json({
    status: 'active',
    granteeName: grant.granteeName,
    scopes: grant.scopes,
    expiresAt: grant.expiresAt,
    orgName: org?.name ?? null,
    view,
  })
})

grantPublicRoutes.post('/:code/act', async (c) => {
  const code = c.req.param('code')
  if (!code || code.length < 4 || code.length > 16) return c.json({ status: 'invalid' }, 404)
  const db = getDb(c.env.DATABASE_URL)
  const res = await resolveGrant(db, code)
  if (res.status !== 'active') return c.json({ error: 'access is not active' }, 403)
  const grant = res.grant

  const raw = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!raw || typeof raw !== 'object') return c.json({ error: 'a JSON object body is required' }, 400)
  const action = typeof raw.action === 'string' ? raw.action : ''
  const def = grantActions[action]
  if (!def) return c.json({ error: 'unknown action' }, 400)

  // Scope re-check per action (the server is the contract — grant.scopes could have been minted
  // narrower than the app's full vocabulary).
  if (!grantHasScope(grant, def.scope)) {
    return c.json({ error: `this grant does not include ${def.scope}` }, 403)
  }

  // Subject fence: a pinned grant acts on ITS subject only (a supplied id must match the pin);
  // a whole-org grant may act on any ACTIVE subject of the grant's org. Never trust the client id.
  let subjectId: string | null = null
  const suppliedSubjectId = typeof raw.subjectId === 'string' ? raw.subjectId : null
  if (grant.subjectId) {
    if (suppliedSubjectId && suppliedSubjectId !== grant.subjectId) {
      return c.json({ error: 'subject not found' }, 404)
    }
    subjectId = grant.subjectId
  } else if (suppliedSubjectId) {
    // The canonical subject fence (worker/lib/oversight.ts) — org-scoped + not archived. This
    // surface has no requireOrg context, but the fence is pinned to the GRANT's own org, so a
    // leaked/guessed subjectId from another tenant can never resolve.
    if (!(await assertSubjectInOrg(db, grant.organizationId, suppliedSubjectId))) {
      return c.json({ error: 'subject not found' }, 404)
    }
    subjectId = suppliedSubjectId
  }

  // `details` is grantee-supplied on an ACCOUNT-LESS surface and lands verbatim in the owner's
  // audit trail, so each action declares its own whitelisting + per-field-capped `.strip()` zod
  // schema (worker/grant-config.ts) — a code holder can't store an arbitrary/unbounded blob into
  // the household's audit log. Defense-in-depth atop the rate limiter (pet-pilot rationale).
  const parsedDetails = def.input.safeParse(raw.details ?? {})
  if (!parsedDetails.success) {
    return c.json({ error: parsedDetails.error.issues[0]?.message ?? 'invalid details' }, 400)
  }
  const details = (parsedDetails.data ?? {}) as Record<string, unknown>

  const result = await def.handler(db, grant, { subjectId, details })
  if (!result.ok) return c.json({ error: result.error }, result.status)

  // Tamper-evident audit trail for the owner — links the operational row the handler created.
  await logGrantActivity(db, grant, {
    action,
    subjectId,
    entityType: result.entityType ?? null,
    entityId: result.entityId ?? null,
    details,
  })
  return c.json({ ok: true })
})
