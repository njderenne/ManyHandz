import type { MiddlewareHandler } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { can, canWithPolicy, capNeedsPolicy, kindFeature, type Capability } from '@/lib/config/roles'
import { getAuth } from '../auth'
import { POLICY_FLAGS } from '../lib/policy'
import type { Env } from '../env'

/**
 * Org-scoped auth middleware — the one implementation of golden rule 4's gates, so routes never
 * hand-roll session/org checks. Layer what the route needs:
 *
 *   requireSession            → c.get('session')            (401 without a session)
 *   requireOrg                → + c.get('orgId'/'orgKind'/'orgRole'/'orgMemberId')
 *                               (400 without an active org; 403 if the caller has no live
 *                               membership row; if the route has an :orgId param it must equal
 *                               the active org → 403)
 *   requireCapability('cap')  → + (kind, role) capability gate (roles.ts matrix + policy gates;
 *                               THE canonical gate for privileged actions — mount AFTER requireOrg)
 *   requireRole('owner',…)    → + raw role-string gate        (LEGACY app call sites only — B-1
 *                               LAW: no NEW chassis route may use this; role literals 403 every
 *                               kind with a custom vocabulary)
 *   requireKind('team',…)     → + org-kind gate               (kind-exclusive surfaces)
 *   requireKindFeature('key') → + per-kind feature gate       (kindFeature lookup, SPINE §7)
 *
 * Routes opt in per endpoint:  `routes.get('/summary', requireOrg, async (c) => …)`.
 * Queries still scope by organizationId/userId themselves — these gates authenticate the caller;
 * they don't replace WHERE clauses (see notifications.ts, the canonical resource route).
 */

/** Resolved Better-Auth session (user + session row), as returned by api.getSession. */
export type SessionData = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
>

/**
 * Context variables these middlewares set — routes read them via c.get(). requireOrg resolves the
 * org kind + the caller's member row (role + id) in ONE joined read — capability gates never
 * re-query. `orgMemberId` is the in-app actor id for created_by / assigned_to columns.
 */
export type AuthVariables = {
  session: SessionData
  orgId: string
  orgKind: string      // organization.kind of the active org
  orgRole: string      // caller's member.role in it
  orgMemberId: string  // caller's member.id (the in-app actor for created_by / assigned_to)
}

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
 * `session` + `orgId` + `orgKind` + `orgRole` + `orgMemberId`. Better-Auth checks membership when
 * SETTING the active org, but (as of better-auth 1.6.14) does not clear activeOrganizationId on
 * admin-removal or on other devices' sessions — so a stale session can still carry the org id
 * after the user was removed or left elsewhere. The joined read below re-verifies membership on
 * every request (fast via member_org_idx; uniqueness of the pair is NOT DB-enforced — limit 1)
 * AND resolves the active org's kind + the caller's role/member-id, so capability gates never
 * need a second round-trip. An ARCHIVED member (member.archived_at set) is NOT a live membership
 * — archived members keep history but lose org access. If the route carries an :orgId param it
 * must equal the active org (no cross-org URLs).
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
    .select({
      id: schema.member.id,
      role: schema.member.role,
      kind: schema.organization.kind,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
    .where(
      and(
        eq(schema.member.organizationId, orgId),
        eq(schema.member.userId, session.user.id),
        isNull(schema.member.archivedAt),
      ),
    )
    .limit(1)
  if (!membership) return c.json({ error: 'forbidden' }, 403)
  c.set('orgId', orgId)
  c.set('orgKind', membership.kind)
  // SPINE §10.3 cutover COMPLETE: member.role carries the household vocabulary (parent|kid|
  // roommate|manager|colleague; personal orgs keep 'owner') — the template shape, restored at
  // release N+1 after the live `UPDATE member SET role = household_role` cutover.
  c.set('orgRole', membership.role)
  c.set('orgMemberId', membership.id)
  return next()
}

/**
 * Gate factory: caller's membership role in the active org must be one of `roles`. Mount after
 * requireOrg (which loads `orgRole` — no second query). RETAINED for LEGACY app call sites only:
 * fleet apps still carry requireRole('owner','admin') lines that must keep compiling through
 * their backport waves. B-1 LAW: no NEW chassis route may use this — use requireCapability
 * (role literals lock out every kind with a custom role vocabulary; see roles.ts).
 */
export function requireRole(...roles: string[]): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const orgId = c.get('orgId')
    const role = c.get('orgRole')
    if (!orgId || !role) {
      // Programmer error, not a caller error — surface it loudly in dev instead of a silent 403.
      return c.json({ error: 'requireRole must be mounted after requireOrg' }, 500)
    }
    if (!roles.includes(role)) {
      return c.json({ error: 'forbidden — insufficient role' }, 403)
    }
    return next()
  }
}

/**
 * THE canonical gate for a privileged action (SPINE §4). Mount after requireOrg.
 *   1. Base check: can(orgKind, orgRole, cap) — pure, no I/O; false ⇒ 403.
 *   2. Policy check (only when capNeedsPolicy(kind, role, cap)): one SELECT of the POLICY_FLAGS
 *      columns from `organization`, then canWithPolicy; false ⇒ 403.
 * Default mint: policyGates empty ⇒ step 2 never runs ⇒ zero added queries. A gate whose flag is
 * missing from POLICY_FLAGS denies (fail-safe) — the roles.test.ts twin assertion catches the
 * drift in CI first.
 */
export function requireCapability(cap: Capability): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const orgId = c.get('orgId')
    const kind = c.get('orgKind')
    const role = c.get('orgRole')
    if (!orgId || !kind || !role) {
      // Programmer error, not a caller error — surface it loudly in dev instead of a silent 403.
      return c.json({ error: 'requireCapability must be mounted after requireOrg' }, 500)
    }
    if (!can(kind, role, cap)) {
      return c.json({ error: 'forbidden — insufficient permission' }, 403)
    }
    if (capNeedsPolicy(kind, role, cap)) {
      const flagNames = Object.keys(POLICY_FLAGS)
      const policy: Record<string, boolean> = {}
      if (flagNames.length > 0) {
        const [row] = await getDb(c.env.DATABASE_URL)
          .select(POLICY_FLAGS)
          .from(schema.organization)
          .where(eq(schema.organization.id, orgId))
          .limit(1)
        for (const name of flagNames) {
          policy[name] = (row as Record<string, unknown> | undefined)?.[name] === true
        }
      }
      if (!canWithPolicy(kind, role, cap, policy)) {
        return c.json({ error: 'forbidden — insufficient permission' }, 403)
      }
    }
    return next()
  }
}

/**
 * Gate factory: the active org must be one of these kinds (e.g. team-only routes). Mount after
 * requireOrg. Responds 403 (not 404) so the route's existence isn't an oracle either way.
 */
export function requireKind(...kinds: string[]): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const orgId = c.get('orgId')
    const kind = c.get('orgKind')
    if (!orgId || !kind) {
      // Programmer error, not a caller error — surface it loudly in dev instead of a silent 403.
      return c.json({ error: 'requireKind must be mounted after requireOrg' }, 500)
    }
    if (!kinds.includes(kind)) {
      return c.json({ error: 'not available for this organization type' }, 403)
    }
    return next()
  }
}

/**
 * Gate factory: kindFeature(orgKind, key) must be true — blocks Worker writes for surfaces a kind
 * disables (ManyHandz: roommate mode has no rewards ⇒ POST /rewards 403s). Mount after requireOrg.
 * The client mirror is FeatureGate's `kind` prop; this is the server-side authority (SPINE §7).
 */
export function requireKindFeature(key: string): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const orgId = c.get('orgId')
    const kind = c.get('orgKind')
    if (!orgId || !kind) {
      // Programmer error, not a caller error — surface it loudly in dev instead of a silent 403.
      return c.json({ error: 'requireKindFeature must be mounted after requireOrg' }, 500)
    }
    if (!kindFeature(kind, key)) {
      return c.json({ error: 'not available for this organization type' }, 403)
    }
    return next()
  }
}

/**
 * Audit helper — append a row to activity_log for the active org. Call from routes after a
 * state-changing action; never let an audit failure fail the action itself.
 */
export async function audit(
  c: Parameters<MiddlewareHandler<AuthEnv>>[0],
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
