import type { MiddlewareHandler } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import type { HouseholdKidPolicy, HouseholdMode, HouseholdRole } from '@/lib/config/modes'
import type { AuthEnv } from '../middleware/org'

/**
 * Household context adapter — the SPINE §10.3 replacement for the old worker/household.ts
 * resolveHousehold(). requireOrg's single joined read already resolved the active org's kind and
 * the caller's role + member id onto the request context (c.get('orgKind'/'orgRole'/'orgMemberId')),
 * so this adapter re-shapes those vars for the route bodies that consumed HouseholdContext — the
 * only remaining query is the kid-policy flags read (and ONLY here; requireCapability fetches
 * policy itself via worker/lib/policy.ts when a gated capability needs it).
 *
 * AUTHORIZATION lives in requireCapability + roles.ts — this adapter never gates anything.
 */

export type HouseholdContext = {
  orgId: string
  /** The caller's member row id in this household (the in-app actor for created_by / assigned_to). */
  memberId: string
  mode: HouseholdMode
  householdRole: HouseholdRole
  policy: HouseholdKidPolicy
}

type Ctx = Parameters<MiddlewareHandler<AuthEnv>>[0]

/** Load the family-kid policy toggles for an org (the POLICY_FLAGS columns, typed). */
export async function loadKidPolicy(
  db: ReturnType<typeof getDb>,
  orgId: string,
): Promise<HouseholdKidPolicy> {
  const [org] = await db
    .select({
      allowKidGifting: schema.organization.allowKidGifting,
      allowKidChallenges: schema.organization.allowKidChallenges,
      allowKidCompetitions: schema.organization.allowKidCompetitions,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  return {
    allowKidGifting: org?.allowKidGifting ?? false,
    allowKidChallenges: org?.allowKidChallenges ?? false,
    allowKidCompetitions: org?.allowKidCompetitions ?? false,
  }
}

/**
 * Re-shape requireOrg's context vars into the HouseholdContext route bodies consume. Mount
 * requireOrg first; returns null only when that contract is broken (routes keep their existing
 * `if (!ctx) → 403` guards as a belt-and-braces check).
 */
export async function householdContext(c: Ctx): Promise<HouseholdContext | null> {
  const orgId = c.get('orgId')
  const memberId = c.get('orgMemberId')
  const kind = c.get('orgKind')
  const role = c.get('orgRole')
  if (!orgId || !memberId || !kind || !role) return null
  const policy = await loadKidPolicy(getDb(c.env.DATABASE_URL), orgId)
  return { orgId, memberId, mode: kind as HouseholdMode, householdRole: role as HouseholdRole, policy }
}
