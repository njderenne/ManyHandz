import type { MiddlewareHandler } from 'hono'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import {
  canWithHousehold,
  type HouseholdKidPolicy,
  type HouseholdMode,
  type HouseholdRole,
  type Permission,
} from '@/lib/config/modes'
import type { AuthEnv } from './middleware/org'
import type { Env } from './env'

/**
 * Household authorization — the ManyHandz layer on top of the org gates (middleware/org.ts).
 *
 * The mode permission matrix (src/lib/config/modes.ts) is the single source of truth for "who can do
 * what", and it must be enforced SERVER-SIDE — the client mirror is never the authority. This module
 * resolves the active household's mode + kid policy + the caller's household role, and exposes a
 * `requirePermission(...)` gate that runs `canWithHousehold` exactly like the client does.
 *
 * Mount AFTER requireOrg:  routes.post('/:orgId/chores', requireOrg, requirePermission('createChores'), …)
 * Queries STILL scope by organizationId themselves — this gate authorizes the actor; it doesn't
 * replace WHERE clauses.
 */

export type HouseholdContext = {
  orgId: string
  /** The caller's member row id in this household (the in-app actor for created_by / assigned_to). */
  memberId: string
  mode: HouseholdMode
  householdRole: HouseholdRole
  policy: HouseholdKidPolicy
}

/** Hono env for permission-gated routes: `new Hono<HouseholdEnv>()`. */
export type HouseholdEnv = {
  Bindings: Env
  Variables: AuthEnv['Variables'] & { household: HouseholdContext }
}

type Ctx = Parameters<MiddlewareHandler<HouseholdEnv>>[0]

/** Resolve the active household's mode/policy + the caller's member (role). Requires requireOrg first. */
export async function resolveHousehold(c: Ctx): Promise<HouseholdContext | null> {
  const session = c.get('session')
  const orgId = c.get('orgId')
  if (!session || !orgId) return null
  const db = getDb(c.env.DATABASE_URL)
  const [org] = await db
    .select({
      mode: schema.organization.mode,
      allowKidGifting: schema.organization.allowKidGifting,
      allowKidChallenges: schema.organization.allowKidChallenges,
      allowKidCompetitions: schema.organization.allowKidCompetitions,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  const [m] = await db
    .select({ id: schema.member.id, householdRole: schema.member.householdRole })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, session.user.id)))
    .limit(1)
  if (!org || !m) return null
  return {
    orgId,
    memberId: m.id,
    mode: org.mode as HouseholdMode,
    householdRole: m.householdRole as HouseholdRole,
    policy: {
      allowKidGifting: org.allowKidGifting,
      allowKidChallenges: org.allowKidChallenges,
      allowKidCompetitions: org.allowKidCompetitions,
    },
  }
}

/**
 * Gate: the caller must hold `permission` in the active household (mode matrix + the second-layer kid
 * toggles). Mount AFTER requireOrg. Caches the resolved household on `c.set('household', …)` so the
 * route body reuses it (memberId, mode, …) without a second query.
 */
export function requirePermission(permission: Permission): MiddlewareHandler<HouseholdEnv> {
  return async (c, next) => {
    const household = await resolveHousehold(c)
    if (!household) return c.json({ error: 'forbidden' }, 403)
    if (!canWithHousehold(household.mode, household.householdRole, permission, household.policy)) {
      return c.json({ error: 'forbidden — insufficient household permission' }, 403)
    }
    c.set('household', household)
    return next()
  }
}
