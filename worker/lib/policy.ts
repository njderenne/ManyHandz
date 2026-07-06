import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { schema } from '@/lib/db'

/**
 * POLICY_FLAGS — org boolean columns referenced by KIND_CONFIGS policyGates, keyed by
 * PolicyFlagName (SPINE_SPEC §4.1). requireCapability's policy step SELECTs exactly these columns
 * from `organization` when `capNeedsPolicy(kind, role, cap)` — the 2nd-layer runtime gate
 * (the old ManyHandz canWithHousehold, generalized).
 *
 * ManyHandz: the three family-kid toggles the Settings screen exposes. The family kind's
 * policyGates (src/lib/config/roles.ts) gate kid `points:gift` / `competition:create` /
 * `challenge:create` on them. A vitest (roles.test.ts) asserts every PolicyFlagName used in
 * KIND_CONFIGS has an entry here — config drift fails CI instead of surfacing as a mystery 403.
 * A gate whose flag is MISSING from this map denies (fail-safe).
 */
export const POLICY_FLAGS: Record<string, AnyPgColumn> = {
  allowKidGifting: schema.organization.allowKidGifting,
  allowKidChallenges: schema.organization.allowKidChallenges,
  allowKidCompetitions: schema.organization.allowKidCompetitions,
}
