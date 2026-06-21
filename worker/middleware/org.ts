import type { Context, MiddlewareHandler } from 'hono'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { getAuth } from '../auth'
import type { Env } from '../env'

/**
 * Org-scoped auth middleware — the one implementation of golden rule 4's gates, so routes never
 * hand-roll session/org checks. Layer what the route needs:
 *
 *   requireSession           → c.get('session')            (401 without a session)
 *   requireOrg               → + c.get('orgId')            (400 without an active org; 403 if the
 *                              caller has no live membership row; if the route has an :orgId
 *                              param it must equal the active org → 403)
 *   requireRole('owner',…)   → + membership-role gate      (403 unless the caller's role matches;
 *                              mount AFTER requireOrg)
 *
 * Routes opt in per endpoint:  `routes.get('/summary', requireOrg, async (c) => …)`.
 * Queries still scope by organizationId/userId themselves — these gates authenticate the caller;
 * they don't replace WHERE clauses (see notifications.ts, the canonical resource route).
 */

/** Resolved Better-Auth session (user + session row), as returned by api.getSession. */
export type SessionData = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
>

/** Context variables these middlewares set — routes read them via c.get(). */
export type AuthVariables = { session: SessionData; orgId: string }

/** Hono env for auth-gated routes: `new Hono<AuthEnv>()`. */
export type AuthEnv = { Bindings: Env; Variables: AuthVariables }

/** Resolve + cache the session on the context; null means unauthenticated. */
async function resolveSession(c: Parameters<MiddlewareHandler<AuthEnv>>[0]): Promise<SessionData | null> {
  const cached = c.get('session')
  if (cached) return cached
  const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers })
  if (session) c.set('session', session)
  return session
}

/** Gate: signed-in caller. Sets `session`. */
export const requireSession: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const session = await resolveSession(c)
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  return next()
}

/**
 * Gate: signed-in caller with an active organization AND a live membership row. Sets
 * `session` + `orgId`. Better-Auth checks membership when SETTING the active org, but
 * (as of better-auth 1.6.14) does not clear activeOrganizationId on admin-removal or on
 * other devices' sessions — so a stale session can still carry the org id after the user
 * was removed or left elsewhere. The point read below re-verifies membership on every
 * request (fast via member_org_idx; uniqueness of the pair is NOT DB-enforced — limit 1).
 * If the route carries an :orgId param it must equal the active org (no cross-org URLs).
 */
export const requireOrg: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const session = await resolveSession(c)
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  const orgId = session.session.activeOrganizationId
  if (!orgId) return c.json({ error: 'no active organization' }, 400)
  const param = c.req.param('orgId')
  if (param && param !== orgId) {
    return c.json({ error: 'forbidden — not your active organization' }, 403)
  }
  const [membership] = await getDb(c.env.DATABASE_URL)
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, session.user.id)))
    .limit(1)
  if (!membership) return c.json({ error: 'forbidden' }, 403)
  c.set('orgId', orgId)
  return next()
}

/**
 * Gate factory: caller's membership role in the active org must be one of `roles`
 * (Better-Auth org roles: 'owner' | 'admin' | 'member'). Mount after requireOrg.
 */
export function requireRole(...roles: string[]): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const session = c.get('session')
    const orgId = c.get('orgId')
    if (!session || !orgId) {
      // Programmer error, not a caller error — surface it loudly in dev instead of a silent 403.
      return c.json({ error: 'requireRole must be mounted after requireOrg' }, 500)
    }
    const [membership] = await getDb(c.env.DATABASE_URL)
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, session.user.id)))
      .limit(1)
    if (!membership || !roles.includes(membership.role)) {
      return c.json({ error: 'forbidden — insufficient role' }, 403)
    }
    return next()
  }
}

/**
 * Audit helper — append a row to activity_log for the active org. Call from routes after a
 * state-changing action; never let an audit failure fail the action itself.
 */
export async function audit<V extends AuthVariables>(
  c: Context<{ Bindings: Env; Variables: V }>,
  entry: { entityType: string; entityId?: string; action: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const session = c.get('session')
  const orgId = c.get('orgId')
  if (!orgId) return
  try {
    await getDb(c.env.DATABASE_URL).insert(schema.activityLog).values({
      organizationId: orgId,
      userId: session?.user.id ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      action: entry.action,
      metadata: entry.metadata ?? null,
    })
  } catch (e) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'audit.write_failed',
        action: entry.action,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
  }
}
