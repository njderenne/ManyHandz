import { Hono } from 'hono'
import { and, desc, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { requirePermission, type HouseholdEnv } from '../household'

/**
 * Bonus challenges — time-boxed household challenges (the brief's §16). Org-scoped reads (every member
 * sees active/past challenges), mode-permission-gated writes (`requirePermission('createChallenges')` —
 * which also applies the family-kid `allowKidChallenges` toggle via canWithHousehold). Four types:
 * `double_points` (a household-wide ×multiplier window — the completion engine reads the ACTIVE one),
 * `complete_count` / `no_overdue` / `custom` (target + bonusPoints, resolved by the cron at endsAt).
 *
 * `pointsMultiplier` is stored ×10 fixed-point (15 = 1.5×). Only ONE active `double_points` challenge
 * is allowed at a time — a second is rejected. Resolution + bonus payout (through the credit ledger,
 * kind=POINTS_KIND) happens in the challenges cron, NOT here.
 *
 *   GET    /api/organizations/:orgId/challenges               → active challenges, newest first
 *   GET    /api/organizations/:orgId/challenges?scope=past    → past (completed/failed/expired)
 *   GET    /api/organizations/:orgId/challenges/:challengeId  → one challenge
 *   POST   /api/organizations/:orgId/challenges               → create        (createChallenges)
 *   PATCH  /api/organizations/:orgId/challenges/:challengeId  → edit          (createChallenges)
 *   DELETE /api/organizations/:orgId/challenges/:challengeId  → cancel/expire (createChallenges)
 */
export const challengeRoutes = new Hono<HouseholdEnv>()

const CHALLENGE_TYPES = ['double_points', 'complete_count', 'no_overdue', 'custom'] as const

const challengeCreate = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullish(),
    challengeType: z.enum(CHALLENGE_TYPES),
    targetValue: z.number().int().min(1).max(100000).nullish(),
    bonusPoints: z.number().int().min(0).max(100000).optional(),
    // ×10 fixed-point: 10 = 1.0×, 15 = 1.5×, 20 = 2.0×. Floor 10 (never below 1×), cap 50 (5×).
    pointsMultiplier: z.number().int().min(10).max(50).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime(),
  })
  .refine((d) => new Date(d.endsAt).getTime() > Date.now(), { message: 'endsAt must be in the future', path: ['endsAt'] })
  .refine(
    (d) => !d.startsAt || new Date(d.endsAt).getTime() > new Date(d.startsAt).getTime(),
    { message: 'endsAt must be after startsAt', path: ['endsAt'] },
  )

const challengeUpdate = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullish(),
  targetValue: z.number().int().min(1).max(100000).nullish(),
  bonusPoints: z.number().int().min(0).max(100000).optional(),
  pointsMultiplier: z.number().int().min(10).max(50).optional(),
  endsAt: z.string().datetime().optional(),
})

/**
 * Reject a second active double_points challenge: at most one may be `status='active'` in a household
 * at a time. `excludeId` lets an UPDATE ignore the row being edited.
 */
async function hasActiveDoublePoints(
  env: HouseholdEnv['Bindings'],
  orgId: string,
  excludeId?: string,
): Promise<boolean> {
  const conds = [
    eq(schema.bonusChallenge.organizationId, orgId),
    eq(schema.bonusChallenge.status, 'active'),
    eq(schema.bonusChallenge.challengeType, 'double_points'),
  ]
  if (excludeId) conds.push(ne(schema.bonusChallenge.id, excludeId))
  const [row] = await getDb(env.DATABASE_URL)
    .select({ id: schema.bonusChallenge.id })
    .from(schema.bonusChallenge)
    .where(and(...conds))
    .limit(1)
  return Boolean(row)
}

challengeRoutes.get('/:orgId/challenges', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const scope = c.req.query('scope') === 'past' ? 'past' : 'active'
  const statusFilter =
    scope === 'past'
      ? ne(schema.bonusChallenge.status, 'active')
      : eq(schema.bonusChallenge.status, 'active')
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.bonusChallenge)
    .where(and(eq(schema.bonusChallenge.organizationId, orgId), statusFilter))
    .orderBy(desc(schema.bonusChallenge.createdAt))
    .limit(200)
  return c.json(rows)
})

challengeRoutes.get('/:orgId/challenges/:challengeId', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.bonusChallenge)
    .where(
      and(
        eq(schema.bonusChallenge.id, c.req.param('challengeId')),
        eq(schema.bonusChallenge.organizationId, orgId),
      ),
    )
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})

challengeRoutes.post('/:orgId/challenges', requireOrg, requirePermission('createChallenges'), async (c) => {
  const { orgId, memberId } = c.get('household')
  const parsed = challengeCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // Only one active double_points window per household — reject a second.
  if (d.challengeType === 'double_points' && (await hasActiveDoublePoints(c.env, orgId))) {
    return c.json({ error: 'a double-points challenge is already active' }, 409)
  }

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.bonusChallenge)
    .values({
      organizationId: orgId,
      title: d.title,
      description: d.description ?? null,
      challengeType: d.challengeType,
      targetValue: d.targetValue ?? null,
      bonusPoints: d.bonusPoints ?? 0,
      pointsMultiplier: d.pointsMultiplier ?? 10,
      startsAt: d.startsAt ? new Date(d.startsAt) : new Date(),
      endsAt: new Date(d.endsAt),
      status: 'active',
      createdByMemberId: memberId,
    })
    .returning()

  // Backstop the check-then-act race (no transaction on the HTTP driver): if a concurrent create also
  // produced an active double_points window, void the one we just made so the invariant holds.
  if (d.challengeType === 'double_points' && (await hasActiveDoublePoints(c.env, orgId, row.id))) {
    await getDb(c.env.DATABASE_URL).update(schema.bonusChallenge).set({ status: 'expired' }).where(eq(schema.bonusChallenge.id, row.id))
    return c.json({ error: 'a double-points challenge is already active' }, 409)
  }

  await audit(c, {
    entityType: 'bonus_challenge',
    entityId: row.id,
    action: 'challenge.created',
    metadata: { title: row.title, challengeType: row.challengeType },
  })
  return c.json(row, 201)
})

challengeRoutes.patch('/:orgId/challenges/:challengeId', requireOrg, requirePermission('createChallenges'), async (c) => {
  const { orgId } = c.get('household')
  const challengeId = c.req.param('challengeId')
  const parsed = challengeUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // Only edit a still-active challenge.
  const [existing] = await getDb(c.env.DATABASE_URL)
    .select({ id: schema.bonusChallenge.id, startsAt: schema.bonusChallenge.startsAt, endsAt: schema.bonusChallenge.endsAt })
    .from(schema.bonusChallenge)
    .where(
      and(
        eq(schema.bonusChallenge.id, challengeId),
        eq(schema.bonusChallenge.organizationId, orgId),
        eq(schema.bonusChallenge.status, 'active'),
      ),
    )
    .limit(1)
  if (!existing) return c.json({ error: 'not found' }, 404)

  // Build the update from only the keys the client actually sent (PATCH semantics).
  const updates: Partial<typeof schema.bonusChallenge.$inferInsert> = {}
  if (d.title !== undefined) updates.title = d.title
  if (d.description !== undefined) updates.description = d.description ?? null
  if (d.targetValue !== undefined) updates.targetValue = d.targetValue ?? null
  if (d.bonusPoints !== undefined) updates.bonusPoints = d.bonusPoints
  if (d.pointsMultiplier !== undefined) updates.pointsMultiplier = d.pointsMultiplier
  if (d.endsAt !== undefined) {
    const ends = new Date(d.endsAt)
    if (ends.getTime() <= existing.startsAt.getTime()) {
      return c.json({ error: 'endsAt must be after startsAt' }, 400)
    }
    updates.endsAt = ends
  }
  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.bonusChallenge)
    .set(updates)
    .where(
      and(
        eq(schema.bonusChallenge.id, challengeId),
        eq(schema.bonusChallenge.organizationId, orgId),
        eq(schema.bonusChallenge.status, 'active'),
      ),
    )
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'bonus_challenge', entityId: row.id, action: 'challenge.updated' })
  return c.json(row)
})

challengeRoutes.delete('/:orgId/challenges/:challengeId', requireOrg, requirePermission('createChallenges'), async (c) => {
  const { orgId } = c.get('household')
  const challengeId = c.req.param('challengeId')
  // Cancel an active challenge → 'expired'. No bonus is paid (the cron only pays out at natural end).
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.bonusChallenge)
    .set({ status: 'expired' })
    .where(
      and(
        eq(schema.bonusChallenge.id, challengeId),
        eq(schema.bonusChallenge.organizationId, orgId),
        eq(schema.bonusChallenge.status, 'active'),
      ),
    )
    .returning({ id: schema.bonusChallenge.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'bonus_challenge', entityId: challengeId, action: 'challenge.cancelled' })
  return c.json({ ok: true })
})
