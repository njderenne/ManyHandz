import { Hono } from 'hono'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { requirePermission, resolveHousehold, type HouseholdEnv } from '../household'
import { can } from '@/lib/config/modes'
import { requireTier } from '../entitlements'
import { POINTS_KIND } from './household'

/**
 * Rewards — the point-priced reward catalog + redemption flow (family mode's `/rewards`). The catalog
 * is org-scoped reading for every member; creating/editing a reward is `createRewards`-gated. Redeeming
 * checks the caller's DERIVED points balance (SUM of creditLedger.delta, kind=points — never a stored
 * column), deducts via a NEGATIVE ledger entry (reason=reward_redemption), and inserts a `pending`
 * redemption for a parent to approve. In FAMILY mode a redemption also auto-creates a settlement
 * (sourceType=reward_redemption) for a parent to fulfill. Approve finalizes; reject REFUNDS the points
 * via a positive ledger entry and voids the settlement. Pairs with src/lib/query/hooks/useRewards.ts.
 *
 *   GET    /api/organizations/:orgId/rewards                        → active catalog, newest first
 *   POST   /api/organizations/:orgId/rewards                        → create        (createRewards)
 *   PATCH  /api/organizations/:orgId/rewards/:rewardId             → edit          (createRewards)
 *   DELETE /api/organizations/:orgId/rewards/:rewardId            → soft delete   (createRewards)
 *   POST   /api/organizations/:orgId/rewards/:rewardId/redeem      → redeem        (redeemRewards)
 *   GET    /api/organizations/:orgId/reward-redemptions?status=…  → redemption list
 *   POST   /api/organizations/:orgId/reward-redemptions/:id/approve → approve       (approveCompletions)
 *   POST   /api/organizations/:orgId/reward-redemptions/:id/reject  → reject+refund (approveCompletions)
 */
export const rewardRoutes = new Hono<HouseholdEnv>()

const rewardCreate = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
  icon: z.string().max(40).optional(),
  pointsCost: z.number().int().min(1).max(1_000_000),
})
const rewardUpdate = rewardCreate.partial()

/** The caller's (a user's) current points balance — SUM(delta) over the credit ledger, kind=points. */
async function pointsBalance(
  env: HouseholdEnv['Bindings'],
  orgId: string,
  userId: string,
): Promise<number> {
  const [row] = await getDb(env.DATABASE_URL)
    .select({ balance: sql<string>`coalesce(sum(${schema.creditLedger.delta}), 0)` })
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.organizationId, orgId),
        eq(schema.creditLedger.userId, userId),
        eq(schema.creditLedger.kind, POINTS_KIND),
      ),
    )
  return Number(row?.balance ?? 0)
}

// --- Catalog ---

rewardRoutes.get('/:orgId/rewards', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.reward)
    .where(and(eq(schema.reward.organizationId, orgId), eq(schema.reward.isActive, true)))
    .orderBy(desc(schema.reward.createdAt))
  return c.json(rows)
})

rewardRoutes.post('/:orgId/rewards', requireOrg, requirePermission('createRewards'), async (c) => {
  const { orgId, memberId } = c.get('household')
  // Paid: the rewards/allowance/points economy is a Premium feature. Server-side gate (the client's
  // TierGate only decorates) — trialing/grace orgs pass via requireTier.
  const gate = await requireTier(getDb(c.env.DATABASE_URL), orgId, 'STANDARD')
  if (!gate.ok) return c.json({ error: gate.reason }, 402)
  const parsed = rewardCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.reward)
    .values({
      organizationId: orgId,
      name: d.name,
      description: d.description ?? null,
      icon: d.icon ?? 'gift',
      pointsCost: d.pointsCost,
      createdByMemberId: memberId,
    })
    .returning()
  await audit(c, { entityType: 'reward', entityId: row.id, action: 'reward.created', metadata: { name: row.name, pointsCost: row.pointsCost } })
  return c.json(row, 201)
})

rewardRoutes.patch('/:orgId/rewards/:rewardId', requireOrg, requirePermission('createRewards'), async (c) => {
  const { orgId } = c.get('household')
  const gate = await requireTier(getDb(c.env.DATABASE_URL), orgId, 'STANDARD')
  if (!gate.ok) return c.json({ error: gate.reason }, 402)
  const rewardId = c.req.param('rewardId')
  const parsed = rewardUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // Build the update from only the keys the client actually sent (PATCH semantics).
  const updates: Partial<typeof schema.reward.$inferInsert> = {}
  if (d.name !== undefined) updates.name = d.name
  if (d.description !== undefined) updates.description = d.description ?? null
  if (d.icon !== undefined) updates.icon = d.icon
  if (d.pointsCost !== undefined) updates.pointsCost = d.pointsCost
  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.reward)
    .set(updates)
    .where(and(eq(schema.reward.id, rewardId), eq(schema.reward.organizationId, orgId), eq(schema.reward.isActive, true)))
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'reward', entityId: row.id, action: 'reward.updated' })
  return c.json(row)
})

rewardRoutes.delete('/:orgId/rewards/:rewardId', requireOrg, requirePermission('createRewards'), async (c) => {
  const { orgId } = c.get('household')
  const gate = await requireTier(getDb(c.env.DATABASE_URL), orgId, 'STANDARD')
  if (!gate.ok) return c.json({ error: gate.reason }, 402)
  const rewardId = c.req.param('rewardId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.reward)
    .set({ isActive: false })
    .where(and(eq(schema.reward.id, rewardId), eq(schema.reward.organizationId, orgId), eq(schema.reward.isActive, true)))
    .returning({ id: schema.reward.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'reward', entityId: rewardId, action: 'reward.deleted' })
  return c.json({ ok: true })
})

// --- Redemption ---

rewardRoutes.post('/:orgId/rewards/:rewardId/redeem', requireOrg, requirePermission('redeemRewards'), async (c) => {
  const ctx = c.get('household')
  const db = getDb(c.env.DATABASE_URL)
  // Paid: redeeming points for rewards is the Premium engagement economy.
  const gate = await requireTier(db, ctx.orgId, 'STANDARD')
  if (!gate.ok) return c.json({ error: gate.reason }, 402)
  const rewardId = c.req.param('rewardId')

  const [reward] = await db
    .select({ id: schema.reward.id, name: schema.reward.name, pointsCost: schema.reward.pointsCost })
    .from(schema.reward)
    .where(and(eq(schema.reward.id, rewardId), eq(schema.reward.organizationId, ctx.orgId), eq(schema.reward.isActive, true)))
    .limit(1)
  if (!reward) return c.json({ error: 'not found' }, 404)

  // The redeemer is the caller. Resolve their user id for the ledger (points are keyed by user).
  const userId = c.get('session').user.id
  const balance = await pointsBalance(c.env, ctx.orgId, userId)
  if (balance < reward.pointsCost) return c.json({ error: 'insufficient points', balance, required: reward.pointsCost }, 400)

  // 1. Insert the pending redemption (status defaults to 'pending').
  const [redemption] = await db
    .insert(schema.rewardRedemption)
    .values({
      organizationId: ctx.orgId,
      rewardId: reward.id,
      memberId: ctx.memberId,
      pointsSpent: reward.pointsCost,
      status: 'pending',
    })
    .returning()

  // 2. Deduct the points — a NEGATIVE credit-ledger entry. Idempotent on the redemption id so a
  //    retry can't double-charge.
  await db
    .insert(schema.creditLedger)
    .values({
      organizationId: ctx.orgId,
      userId,
      kind: POINTS_KIND,
      delta: -reward.pointsCost,
      reason: 'reward_redemption',
      entityType: 'reward_redemption',
      entityId: redemption.id,
      idempotencyKey: `reward_redemption:${redemption.id}`,
    })
    .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })

  // 2b. Guard the check-then-act race (the HTTP driver has no transaction): re-derive the balance
  //     AFTER the deduct and roll back if a concurrent/duplicate redeem drove it negative. This
  //     prevents a member from redeeming the same reward N times before any single deduct lands.
  const postBalance = await pointsBalance(c.env, ctx.orgId, userId)
  if (postBalance < 0) {
    await db
      .insert(schema.creditLedger)
      .values({
        organizationId: ctx.orgId,
        userId,
        kind: POINTS_KIND,
        delta: reward.pointsCost, // reverse the deduct
        reason: 'reward_redemption_rollback',
        entityType: 'reward_redemption',
        entityId: redemption.id,
        idempotencyKey: `reward_redemption_rollback:${redemption.id}`,
      })
      .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })
    await db.delete(schema.rewardRedemption).where(eq(schema.rewardRedemption.id, redemption.id))
    return c.json({ error: 'insufficient points', balance: postBalance + reward.pointsCost, required: reward.pointsCost }, 400)
  }

  // 3. Family mode: auto-create a settlement for a parent to fulfill (the kid is OWED the reward).
  let settlementId: string | null = null
  if (ctx.mode === 'family') {
    const [parent] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, ctx.orgId), eq(schema.member.householdRole, 'parent'), eq(schema.member.isActive, true)))
      .limit(1)
    if (parent) {
      const [settlement] = await db
        .insert(schema.settlement)
        .values({
          organizationId: ctx.orgId,
          fromMemberId: parent.id, // the parent OWES the reward
          toMemberId: ctx.memberId, // the redeemer is OWED
          payoutType: 'custom',
          payoutDescription: reward.name,
          description: `Reward: ${reward.name}`,
          sourceType: 'reward_redemption',
          sourceId: redemption.id,
          status: 'pending',
          createdByMemberId: ctx.memberId,
        })
        .returning({ id: schema.settlement.id })
      settlementId = settlement?.id ?? null
    }
  }

  await audit(c, {
    entityType: 'reward_redemption',
    entityId: redemption.id,
    action: 'reward.redeemed',
    metadata: { rewardId: reward.id, pointsSpent: reward.pointsCost, settlementId },
  })
  return c.json({ redemption, settlementId }, 201)
})

rewardRoutes.get('/:orgId/reward-redemptions', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const status = c.req.query('status')
  const where = [eq(schema.rewardRedemption.organizationId, orgId)]
  if (status) where.push(eq(schema.rewardRedemption.status, status))
  const rows = await getDb(c.env.DATABASE_URL)
    .select({
      id: schema.rewardRedemption.id,
      rewardId: schema.rewardRedemption.rewardId,
      memberId: schema.rewardRedemption.memberId,
      pointsSpent: schema.rewardRedemption.pointsSpent,
      status: schema.rewardRedemption.status,
      approvedByMemberId: schema.rewardRedemption.approvedByMemberId,
      approvedAt: schema.rewardRedemption.approvedAt,
      redeemedAt: schema.rewardRedemption.redeemedAt,
      rewardName: schema.reward.name,
      rewardIcon: schema.reward.icon,
      memberName: schema.member.displayName,
    })
    .from(schema.rewardRedemption)
    .innerJoin(schema.reward, eq(schema.reward.id, schema.rewardRedemption.rewardId))
    .leftJoin(schema.member, eq(schema.member.id, schema.rewardRedemption.memberId))
    .where(and(...where))
    .orderBy(desc(schema.rewardRedemption.redeemedAt))
    .limit(200)
  return c.json(rows)
})

/** Load a redemption (+ the redeemer's user id, for refunds) scoped to the org. */
async function loadPendingRedemption(env: HouseholdEnv['Bindings'], orgId: string, redemptionId: string) {
  const [row] = await getDb(env.DATABASE_URL)
    .select({
      id: schema.rewardRedemption.id,
      rewardId: schema.rewardRedemption.rewardId,
      memberId: schema.rewardRedemption.memberId,
      pointsSpent: schema.rewardRedemption.pointsSpent,
      status: schema.rewardRedemption.status,
      memberUserId: schema.member.userId,
    })
    .from(schema.rewardRedemption)
    .innerJoin(schema.member, eq(schema.member.id, schema.rewardRedemption.memberId))
    .where(and(eq(schema.rewardRedemption.id, redemptionId), eq(schema.rewardRedemption.organizationId, orgId)))
    .limit(1)
  return row
}

rewardRoutes.post('/:orgId/reward-redemptions/:id/approve', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'approveCompletions')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const gate = await requireTier(db, ctx.orgId, 'STANDARD')
  if (!gate.ok) return c.json({ error: gate.reason }, 402)
  const redemption = await loadPendingRedemption(c.env, ctx.orgId, c.req.param('id'))
  if (!redemption) return c.json({ error: 'not found' }, 404)
  if (redemption.status !== 'pending') return c.json({ error: 'not pending' }, 409)

  await db
    .update(schema.rewardRedemption)
    .set({ status: 'approved', approvedByMemberId: ctx.memberId, approvedAt: new Date() })
    .where(and(eq(schema.rewardRedemption.id, redemption.id), eq(schema.rewardRedemption.organizationId, ctx.orgId)))
  await audit(c, { entityType: 'reward_redemption', entityId: redemption.id, action: 'reward.redemption_approved' })
  return c.json({ ok: true })
})

rewardRoutes.post('/:orgId/reward-redemptions/:id/reject', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'approveCompletions')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const redemption = await loadPendingRedemption(c.env, ctx.orgId, c.req.param('id'))
  if (!redemption) return c.json({ error: 'not found' }, 404)
  if (redemption.status !== 'pending') return c.json({ error: 'not pending' }, 409)

  await db
    .update(schema.rewardRedemption)
    .set({ status: 'rejected', approvedByMemberId: ctx.memberId, approvedAt: new Date() })
    .where(and(eq(schema.rewardRedemption.id, redemption.id), eq(schema.rewardRedemption.organizationId, ctx.orgId)))

  // REFUND the spent points — a positive ledger entry back to the redeemer. Idempotent on the
  // redemption id so a double-reject can't refund twice.
  if (redemption.memberUserId) {
    await db
      .insert(schema.creditLedger)
      .values({
        organizationId: ctx.orgId,
        userId: redemption.memberUserId,
        kind: POINTS_KIND,
        delta: redemption.pointsSpent,
        reason: 'reward_redemption_refund',
        entityType: 'reward_redemption',
        entityId: redemption.id,
        idempotencyKey: `reward_redemption_refund:${redemption.id}`,
      })
      .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })
  }

  // Void the auto-created settlement (family) so a parent isn't asked to fulfill a rejected reward.
  await db
    .update(schema.settlement)
    .set({ status: 'declined' })
    .where(
      and(
        eq(schema.settlement.organizationId, ctx.orgId),
        eq(schema.settlement.sourceType, 'reward_redemption'),
        eq(schema.settlement.sourceId, redemption.id),
        eq(schema.settlement.status, 'pending'),
      ),
    )

  await audit(c, { entityType: 'reward_redemption', entityId: redemption.id, action: 'reward.redemption_rejected', metadata: { refunded: redemption.pointsSpent } })
  return c.json({ ok: true })
})
