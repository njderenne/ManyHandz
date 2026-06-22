import { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { can } from '@/lib/config/modes'
import { requireOrg, audit } from '../middleware/org'
import { resolveHousehold, type HouseholdEnv } from '../household'

/**
 * Settle-Up ledger — the who-owes-whom record for BOTH money and non-money obligations (treat / gift
 * / privilege / experience / custom). Reads are available to every member; writes are actor-specific
 * (not a flat matrix permission), so the route resolves the household and checks the actor directly,
 * the way completions.ts does:
 *
 *   - create   any member may file an IOU/promise — EXCEPT family mode, where only a PARENT may
 *              (a kid can't unilaterally invent an obligation in a parented household);
 *   - settle   ONLY the debtor (from_member) marks it settled, recording how (settledVia);
 *   - forgive  the creditor (to_member) OR a parent waives the obligation.
 *
 * The balance summary NETS money per member-pair (amountCents) and COUNTS non-money obligations by
 * direction — there is no stored balance. Every query scopes by organizationId. Points are NOT
 * touched here: a settlement is the real-world hand-off after points were already spent.
 *
 *   GET  /api/organizations/:orgId/settlements[?payoutType=&status=]  → balances + pending + settled
 *   POST /api/organizations/:orgId/settlements                        → manual entry
 *   POST /api/organizations/:orgId/settlements/:id/settle             → debtor marks settled
 *   POST /api/organizations/:orgId/settlements/:id/forgive            → creditor or parent forgives
 */
export const settlementRoutes = new Hono<HouseholdEnv>()

const PAYOUT_TYPES = ['money', 'treat', 'gift', 'privilege', 'experience', 'custom'] as const
const SETTLED_VIA = ['venmo', 'paypal', 'cashapp', 'apple_cash', 'cash', 'in_person', 'other'] as const

/** A row joined with both members' display names — what the ledger UI renders. */
const settlementSelect = {
  id: schema.settlement.id,
  fromMemberId: schema.settlement.fromMemberId,
  toMemberId: schema.settlement.toMemberId,
  payoutType: schema.settlement.payoutType,
  amountCents: schema.settlement.amountCents,
  payoutDescription: schema.settlement.payoutDescription,
  description: schema.settlement.description,
  sourceType: schema.settlement.sourceType,
  sourceId: schema.settlement.sourceId,
  status: schema.settlement.status,
  settledAt: schema.settlement.settledAt,
  settledVia: schema.settlement.settledVia,
  settledNote: schema.settlement.settledNote,
  createdByMemberId: schema.settlement.createdByMemberId,
  createdAt: schema.settlement.createdAt,
}

/** Confirm a member id belongs to this household. Returns false on a foreign / missing id. */
async function memberOk(env: HouseholdEnv['Bindings'], orgId: string, memberId: string): Promise<boolean> {
  const [m] = await getDb(env.DATABASE_URL)
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, orgId)))
    .limit(1)
  return Boolean(m)
}

/** Ordered, stable key for a member-pair so A↔B nets to one bucket regardless of direction. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

settlementRoutes.get('/:orgId/settlements', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)

  // Optional filters: a payout type (the All/Money/Treats/… tabs) and/or a single status.
  const payoutTypeParam = c.req.query('payoutType')
  const statusParam = c.req.query('status')
  const payoutType = (PAYOUT_TYPES as readonly string[]).includes(payoutTypeParam ?? '') ? payoutTypeParam : undefined
  const status = ['pending', 'settled', 'forgiven', 'declined'].includes(statusParam ?? '') ? statusParam : undefined

  const where = [eq(schema.settlement.organizationId, orgId)]
  if (payoutType) where.push(eq(schema.settlement.payoutType, payoutType))
  if (status) where.push(eq(schema.settlement.status, status))

  const rows = await db
    .select(settlementSelect)
    .from(schema.settlement)
    .where(and(...where))
    .orderBy(desc(schema.settlement.createdAt))
    .limit(500)

  // Member display names for both endpoints of each settlement (one query, then map).
  const memberIds = Array.from(
    new Set(rows.flatMap((r) => [r.fromMemberId, r.toMemberId])),
  )
  const names = memberIds.length
    ? await db
        .select({ id: schema.member.id, displayName: schema.member.displayName })
        .from(schema.member)
        .where(and(eq(schema.member.organizationId, orgId), inArray(schema.member.id, memberIds)))
    : []
  const nameOf = new Map(names.map((m) => [m.id, m.displayName]))

  const decorated = rows.map((r) => ({
    ...r,
    fromMemberName: nameOf.get(r.fromMemberId) ?? null,
    toMemberName: nameOf.get(r.toMemberId) ?? null,
  }))

  const pending = decorated.filter((r) => r.status === 'pending')
  const settled = decorated.filter((r) => r.status === 'settled' || r.status === 'forgiven')

  // Balance summary per member-pair: NET money (amountCents) by direction, plus a non-money COUNT by
  // direction. Only PENDING obligations count toward what's currently owed.
  const balances = new Map<
    string,
    { memberA: string; memberB: string; netCentsAOwesB: number; nonMoneyAToB: number; nonMoneyBToA: number }
  >()
  for (const r of pending) {
    const key = pairKey(r.fromMemberId, r.toMemberId)
    const [memberA, memberB] = r.fromMemberId < r.toMemberId
      ? [r.fromMemberId, r.toMemberId]
      : [r.toMemberId, r.fromMemberId]
    const b = balances.get(key) ?? { memberA, memberB, netCentsAOwesB: 0, nonMoneyAToB: 0, nonMoneyBToA: 0 }
    const aOwesB = r.fromMemberId === memberA
    if (r.payoutType === 'money') {
      const cents = r.amountCents ?? 0
      b.netCentsAOwesB += aOwesB ? cents : -cents
    } else if (aOwesB) {
      b.nonMoneyAToB += 1
    } else {
      b.nonMoneyBToA += 1
    }
    balances.set(key, b)
  }

  return c.json({ balances: Array.from(balances.values()), pending, settled })
})

const createInput = z
  .object({
    toMemberId: z.string().min(1).max(64),
    payoutType: z.enum(PAYOUT_TYPES),
    amountCents: z.number().int().min(1).max(100000000).optional(),
    payoutDescription: z.string().trim().max(300).nullish(),
    description: z.string().trim().min(1).max(300),
    /** Who OWES. Defaults to the caller, but an admin may file on another member's behalf. */
    fromMemberId: z.string().min(1).max(64).optional(),
  })
  .refine((d) => d.payoutType !== 'money' || (d.amountCents !== undefined && d.amountCents > 0), {
    message: 'amountCents is required for a money settlement',
    path: ['amountCents'],
  })

settlementRoutes.post('/:orgId/settlements', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  // Family mode: only a parent may file a settlement (a kid can't invent an obligation). Roommate /
  // office: any member may create an IOU / promise.
  if (ctx.mode === 'family' && ctx.householdRole !== 'parent') {
    return c.json({ error: 'forbidden — only a parent can create a settlement in family mode' }, 403)
  }

  const parsed = createInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  const fromMemberId = d.fromMemberId ?? ctx.memberId
  // Filing a debt against SOMEONE ELSE is an admin action. (Family already blocks non-parents above
  // and roommates are all peers; this defends the on-behalf path for non-admin roles in other modes.)
  if (d.fromMemberId && d.fromMemberId !== ctx.memberId && !can(ctx.mode, ctx.householdRole, 'changeRoles')) {
    return c.json({ error: 'forbidden — only an admin can file on another member’s behalf' }, 403)
  }
  if (fromMemberId === d.toMemberId) return c.json({ error: 'a member cannot owe themselves' }, 400)
  if (!(await memberOk(c.env, ctx.orgId, fromMemberId))) return c.json({ error: 'invalid from member' }, 400)
  if (!(await memberOk(c.env, ctx.orgId, d.toMemberId))) return c.json({ error: 'invalid to member' }, 400)

  // amountCents is meaningful only for money; null it out for non-money payouts.
  const amountCents = d.payoutType === 'money' ? d.amountCents ?? null : null

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.settlement)
    .values({
      organizationId: ctx.orgId,
      fromMemberId,
      toMemberId: d.toMemberId,
      payoutType: d.payoutType,
      amountCents,
      payoutDescription: d.payoutDescription ?? null,
      description: d.description,
      sourceType: 'manual',
      status: 'pending',
      createdByMemberId: ctx.memberId,
    })
    .returning()
  await audit(c, {
    entityType: 'settlement',
    entityId: row.id,
    action: 'settlement.created',
    metadata: { payoutType: row.payoutType, amountCents: row.amountCents, sourceType: 'manual' },
  })
  return c.json(row, 201)
})

/** Load a settlement scoped to the org (the from/to members are needed for the actor checks). */
async function loadSettlement(env: HouseholdEnv['Bindings'], orgId: string, id: string) {
  const [row] = await getDb(env.DATABASE_URL)
    .select({
      id: schema.settlement.id,
      fromMemberId: schema.settlement.fromMemberId,
      toMemberId: schema.settlement.toMemberId,
      payoutType: schema.settlement.payoutType,
      status: schema.settlement.status,
    })
    .from(schema.settlement)
    .where(and(eq(schema.settlement.id, id), eq(schema.settlement.organizationId, orgId)))
    .limit(1)
  return row
}

const settleInput = z.object({
  settledVia: z.enum(SETTLED_VIA),
  settledNote: z.string().trim().max(300).nullish(),
})

settlementRoutes.post('/:orgId/settlements/:id/settle', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const parsed = settleInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)

  const s = await loadSettlement(c.env, ctx.orgId, c.req.param('id'))
  if (!s) return c.json({ error: 'not found' }, 404)
  if (s.status !== 'pending') return c.json({ error: 'not pending' }, 409)
  // Only the debtor (from_member) may mark their own obligation settled.
  if (s.fromMemberId !== ctx.memberId) {
    return c.json({ error: 'forbidden — only the debtor can mark this settled' }, 403)
  }

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.settlement)
    .set({
      status: 'settled',
      settledAt: new Date(),
      settledVia: parsed.data.settledVia,
      settledNote: parsed.data.settledNote ?? null,
    })
    .where(
      and(
        eq(schema.settlement.id, s.id),
        eq(schema.settlement.organizationId, ctx.orgId),
        eq(schema.settlement.status, 'pending'),
      ),
    )
    .returning()
  if (!row) return c.json({ error: 'not pending' }, 409)
  await audit(c, {
    entityType: 'settlement',
    entityId: row.id,
    action: 'settlement.settled',
    metadata: { settledVia: row.settledVia },
  })
  return c.json(row)
})

const forgiveInput = z.object({ settledNote: z.string().trim().max(300).nullish() })

settlementRoutes.post('/:orgId/settlements/:id/forgive', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const parsed = forgiveInput.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)

  const s = await loadSettlement(c.env, ctx.orgId, c.req.param('id'))
  if (!s) return c.json({ error: 'not found' }, 404)
  if (s.status !== 'pending') return c.json({ error: 'not pending' }, 409)
  // The creditor (to_member) waives what they're owed; a parent may also forgive on anyone's behalf.
  const isCreditor = s.toMemberId === ctx.memberId
  const isParent = ctx.mode === 'family' && ctx.householdRole === 'parent'
  if (!isCreditor && !isParent) {
    return c.json({ error: 'forbidden — only the creditor or a parent can forgive' }, 403)
  }

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.settlement)
    .set({
      status: 'forgiven',
      settledAt: new Date(),
      settledVia: 'other',
      settledNote: parsed.data.settledNote ?? null,
    })
    .where(
      and(
        eq(schema.settlement.id, s.id),
        eq(schema.settlement.organizationId, ctx.orgId),
        eq(schema.settlement.status, 'pending'),
      ),
    )
    .returning()
  if (!row) return c.json({ error: 'not pending' }, 409)
  await audit(c, { entityType: 'settlement', entityId: row.id, action: 'settlement.forgiven' })
  return c.json(row)
})
