import { Hono } from 'hono'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'
import { householdContext } from '../lib/household-context'
import { canWithHousehold } from '@/lib/config/modes'
import { POINTS_KIND } from './household'

/**
 * Point gifting — member-to-member point transfers (brief §"Point Gifting"). Points always flow
 * through the credit ledger (a NEGATIVE delta for the sender, a POSITIVE delta for the receiver,
 * reason=`point_gift`); a balance is NEVER stored. The write is gated by `giftPoints` via
 * `canWithHousehold` (a family kid additionally needs the household's `allowKidGifting` toggle).
 *
 * Family: parents free, kids to siblings (toggle-able). Roommate: anyone. You cannot gift to
 * yourself, and you cannot gift more than your current ledger balance (= SUM(delta) for POINTS_KIND).
 *
 * Pairs with src/lib/query/hooks/useGifts.ts.
 *
 *   GET  /api/organizations/:orgId/gifts        → recent gifts in the household, newest first
 *   POST /api/organizations/:orgId/gifts        → send a gift   (giftPoints)
 */
export const giftRoutes = new Hono<AuthEnv>()

const GIFT_TYPES = ['general', 'thank_you', 'birthday', 'bonus'] as const

const giftSend = z.object({
  toMemberId: z.string().min(1).max(64),
  points: z.number().int().positive().max(1_000_000),
  note: z.string().trim().max(300).nullish(),
  giftType: z.enum(GIFT_TYPES).optional(),
})

/** Current point balance for a user in this household = SUM(creditLedger.delta) for POINTS_KIND. */
async function pointBalance(
  db: ReturnType<typeof getDb>,
  orgId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
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

giftRoutes.get('/:orgId/gifts', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select({
      id: schema.pointGift.id,
      fromMemberId: schema.pointGift.fromMemberId,
      toMemberId: schema.pointGift.toMemberId,
      points: schema.pointGift.points,
      note: schema.pointGift.note,
      giftType: schema.pointGift.giftType,
      createdAt: schema.pointGift.createdAt,
    })
    .from(schema.pointGift)
    .where(eq(schema.pointGift.organizationId, orgId))
    .orderBy(desc(schema.pointGift.createdAt))
    .limit(100)
  return c.json(rows)
})

giftRoutes.post('/:orgId/gifts', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  if (!canWithHousehold(ctx.mode, ctx.householdRole, 'points:gift', ctx.policy)) {
    return c.json({ error: 'forbidden — insufficient household permission' }, 403)
  }

  const parsed = giftSend.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const { toMemberId, points, note, giftType } = parsed.data

  if (toMemberId === ctx.memberId) return c.json({ error: 'cannot gift to yourself' }, 400)

  const db = getDb(c.env.DATABASE_URL)

  // The sender's own member row carries the userId that keys the ledger balance.
  const [sender] = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(and(eq(schema.member.id, ctx.memberId), eq(schema.member.organizationId, ctx.orgId)))
    .limit(1)
  if (!sender?.userId) return c.json({ error: 'sender not found' }, 404)

  // The recipient must be a live member of THIS household.
  const [receiver] = await db
    .select({ id: schema.member.id, userId: schema.member.userId, isActive: schema.member.isActive })
    .from(schema.member)
    .where(and(eq(schema.member.id, toMemberId), eq(schema.member.organizationId, ctx.orgId)))
    .limit(1)
  if (!receiver) return c.json({ error: 'recipient not found' }, 404)
  if (!receiver.userId) return c.json({ error: 'recipient has no account' }, 400)
  if (!receiver.isActive) return c.json({ error: 'recipient is not active' }, 400)

  // Balance check: you can't gift more than you hold (balance = SUM of your POINTS_KIND deltas).
  const balance = await pointBalance(db, ctx.orgId, sender.userId)
  if (balance < points) {
    return c.json({ error: 'insufficient balance', balance, requested: points }, 400)
  }

  // Atomic-ish transfer: a NEGATIVE ledger entry for the sender + a POSITIVE one for the receiver,
  // then the point_gift record + an activity-feed entry. Points only ever move through the ledger.
  const [gift] = await db
    .insert(schema.pointGift)
    .values({
      organizationId: ctx.orgId,
      fromMemberId: ctx.memberId,
      toMemberId: receiver.id,
      points,
      note: note ?? null,
      giftType: giftType ?? 'general',
    })
    .returning()

  await db.insert(schema.creditLedger).values([
    {
      organizationId: ctx.orgId,
      userId: sender.userId,
      kind: POINTS_KIND,
      delta: -points,
      reason: 'point_gift',
      entityType: 'point_gift',
      entityId: gift.id,
    },
    {
      organizationId: ctx.orgId,
      userId: receiver.userId,
      kind: POINTS_KIND,
      delta: points,
      reason: 'point_gift',
      entityType: 'point_gift',
      entityId: gift.id,
    },
  ])

  await db.insert(schema.activityLog).values({
    organizationId: ctx.orgId,
    userId: sender.userId,
    entityType: 'point_gift',
    entityId: gift.id,
    action: 'points_gifted',
    metadata: { toMemberId: receiver.id, points, giftType: gift.giftType },
  })

  await audit(c, {
    entityType: 'point_gift',
    entityId: gift.id,
    action: 'gift.sent',
    metadata: { toMemberId: receiver.id, points, giftType: gift.giftType },
  })
  return c.json(gift, 201)
})
