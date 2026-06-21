import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { resolveHousehold, type HouseholdEnv } from '../household'
import { can } from '@/lib/config/modes'
import { compareDate, shiftDate } from '@/lib/manyhandz/dates'

/**
 * Requests — snooze (postpone) + swap (trade) for assignments. Two human-in-the-loop flows on top of
 * the board:
 *
 *   SNOOZE  (postpone an assignment's due date). The actor must hold `markOwnComplete` (every working
 *   member, kids included). A family KID's request becomes a `snoozeRequest` (status=pending) that a
 *   parent (`approveCompletions`) approves/denies; an adult/roommate applies it IMMEDIATELY. Applying
 *   preserves `originalDueDate`, bumps `snoozeCount`, and re-dates the assignment. Guardrails: max 3
 *   snoozes, and the new due date may not land more than 7 days past the ORIGINAL due date.
 *
 *   SWAP    (trade an assignment with another member). The requester (owner of `requesterAssignmentId`)
 *   creates a `swapRequest` to a target member — optionally naming a specific `targetAssignmentId` to
 *   trade for, or a "free swap" (just hand it over). The target member accepts (swap the assigned_to
 *   fields) or declines. Free swap = reassign the requester's assignment to the target.
 *
 *   POST /api/organizations/:orgId/assignments/:assignmentId/snooze  → snooze (apply or request)
 *   GET  /api/organizations/:orgId/snooze-requests?status=pending    → pending snooze requests
 *   POST /api/organizations/:orgId/snooze-requests/:id/approve       → approve   (approveCompletions)
 *   POST /api/organizations/:orgId/snooze-requests/:id/deny {reason} → deny      (approveCompletions)
 *   POST /api/organizations/:orgId/swap-requests                     → create a swap request
 *   GET  /api/organizations/:orgId/swap-requests?status=pending      → pending swap requests
 *   POST /api/organizations/:orgId/swap-requests/:id/accept          → accept (target member)
 *   POST /api/organizations/:orgId/swap-requests/:id/decline         → decline (target member)
 */
export const requestRoutes = new Hono<HouseholdEnv>()

const MAX_SNOOZES = 3
const MAX_DAYS_PAST_ORIGINAL = 7

const snoozeInput = z.object({
  reason: z.string().trim().max(300).optional(),
  newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newDueTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
})

const swapCreateInput = z.object({
  requesterAssignmentId: z.string().min(1).max(64),
  targetAssignmentId: z.string().min(1).max(64).nullish(), // omitted → free swap (hand it over)
  targetMemberId: z.string().min(1).max(64), // who receives / trades with the requester
  message: z.string().trim().max(500).nullish(),
})

const denyInput = z.object({ reason: z.string().trim().min(1).max(300) })

// --- SNOOZE -------------------------------------------------------------------------------------

requestRoutes.post('/:orgId/assignments/:assignmentId/snooze', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'markOwnComplete')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const assignmentId = c.req.param('assignmentId')

  const parsed = snoozeInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  const [a] = await db
    .select({
      id: schema.assignment.id,
      assignedToMemberId: schema.assignment.assignedToMemberId,
      dueDate: schema.assignment.dueDate,
      originalDueDate: schema.assignment.originalDueDate,
      snoozeCount: schema.assignment.snoozeCount,
      status: schema.assignment.status,
    })
    .from(schema.assignment)
    .where(and(eq(schema.assignment.id, assignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
    .limit(1)
  if (!a) return c.json({ error: 'not found' }, 404)
  if (a.status === 'completed' || a.status === 'pending_review') {
    return c.json({ error: 'cannot snooze a completed assignment' }, 409)
  }
  if (a.status === 'snoozed_pending_approval') {
    return c.json({ error: 'a snooze request is already pending for this assignment' }, 409)
  }

  // The assignee snoozes their own; an admin (assignChores) may snooze on their behalf.
  const isAssignee = a.assignedToMemberId === ctx.memberId
  if (!isAssignee && !can(ctx.mode, ctx.householdRole, 'assignChores')) return c.json({ error: 'forbidden' }, 403)

  // Guardrails are anchored to the ORIGINAL due date (the first snooze records it).
  const original = a.originalDueDate ?? a.dueDate
  if (a.snoozeCount >= MAX_SNOOZES) {
    return c.json({ error: `already snoozed the maximum of ${MAX_SNOOZES} times` }, 409)
  }
  if (compareDate(d.newDueDate, original) <= 0) {
    return c.json({ error: 'the new due date must be later than the current due date' }, 400)
  }
  if (compareDate(d.newDueDate, shiftDate(original, MAX_DAYS_PAST_ORIGINAL)) > 0) {
    return c.json({ error: `cannot snooze more than ${MAX_DAYS_PAST_ORIGINAL} days past the original due date` }, 400)
  }

  // Family kids route through a parent's approval queue; everyone else applies immediately.
  const needsApproval = ctx.mode === 'family' && ctx.householdRole === 'kid'

  if (needsApproval) {
    const [req] = await db
      .insert(schema.snoozeRequest)
      .values({
        organizationId: ctx.orgId,
        assignmentId: a.id,
        requestedByMemberId: ctx.memberId,
        reason: d.reason ?? '',
        newDueDate: d.newDueDate,
        newDueTime: d.newDueTime ?? null,
        status: 'pending',
      })
      .returning()
    await db
      .update(schema.assignment)
      .set({ status: 'snoozed_pending_approval' })
      .where(and(eq(schema.assignment.id, a.id), eq(schema.assignment.organizationId, ctx.orgId)))
    await audit(c, {
      entityType: 'snooze_request',
      entityId: req.id,
      action: 'snooze.requested',
      metadata: { assignmentId: a.id, newDueDate: d.newDueDate },
    })
    return c.json({ snoozeRequest: req, needsApproval: true }, 201)
  }

  // Immediate apply: preserve the original due date, re-date, bump the count.
  const [row] = await db
    .update(schema.assignment)
    .set({
      dueDate: d.newDueDate,
      dueTime: d.newDueTime ?? null,
      originalDueDate: original,
      snoozeCount: a.snoozeCount + 1,
      status: 'pending',
    })
    .where(and(eq(schema.assignment.id, a.id), eq(schema.assignment.organizationId, ctx.orgId)))
    .returning()
  await audit(c, {
    entityType: 'assignment',
    entityId: a.id,
    action: 'snooze.applied',
    metadata: { newDueDate: d.newDueDate, snoozeCount: a.snoozeCount + 1 },
  })
  return c.json({ assignment: row, needsApproval: false })
})

requestRoutes.get('/:orgId/snooze-requests', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const status = c.req.query('status') ?? 'pending'
  const rows = await getDb(c.env.DATABASE_URL)
    .select({
      id: schema.snoozeRequest.id,
      assignmentId: schema.snoozeRequest.assignmentId,
      requestedByMemberId: schema.snoozeRequest.requestedByMemberId,
      reason: schema.snoozeRequest.reason,
      newDueDate: schema.snoozeRequest.newDueDate,
      newDueTime: schema.snoozeRequest.newDueTime,
      status: schema.snoozeRequest.status,
      denialReason: schema.snoozeRequest.denialReason,
      createdAt: schema.snoozeRequest.createdAt,
      choreName: schema.chore.name,
      choreIcon: schema.chore.icon,
      memberName: schema.member.displayName,
    })
    .from(schema.snoozeRequest)
    .innerJoin(schema.assignment, eq(schema.assignment.id, schema.snoozeRequest.assignmentId))
    .innerJoin(schema.chore, eq(schema.chore.id, schema.assignment.choreId))
    .leftJoin(schema.member, eq(schema.member.id, schema.snoozeRequest.requestedByMemberId))
    .where(and(eq(schema.snoozeRequest.organizationId, orgId), eq(schema.snoozeRequest.status, status)))
    .orderBy(desc(schema.snoozeRequest.createdAt))
    .limit(200)
  return c.json(rows)
})

/** Load a pending snooze request + its assignment's snooze state, scoped to the org. */
async function loadPendingSnooze(env: HouseholdEnv['Bindings'], orgId: string, requestId: string) {
  const [row] = await getDb(env.DATABASE_URL)
    .select({
      id: schema.snoozeRequest.id,
      assignmentId: schema.snoozeRequest.assignmentId,
      newDueDate: schema.snoozeRequest.newDueDate,
      newDueTime: schema.snoozeRequest.newDueTime,
      status: schema.snoozeRequest.status,
      dueDate: schema.assignment.dueDate,
      originalDueDate: schema.assignment.originalDueDate,
      snoozeCount: schema.assignment.snoozeCount,
    })
    .from(schema.snoozeRequest)
    .innerJoin(schema.assignment, eq(schema.assignment.id, schema.snoozeRequest.assignmentId))
    .where(and(eq(schema.snoozeRequest.id, requestId), eq(schema.snoozeRequest.organizationId, orgId)))
    .limit(1)
  return row
}

requestRoutes.post('/:orgId/snooze-requests/:id/approve', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'approveCompletions')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const req = await loadPendingSnooze(c.env, ctx.orgId, c.req.param('id'))
  if (!req) return c.json({ error: 'not found' }, 404)
  if (req.status !== 'pending') return c.json({ error: 'not pending' }, 409)

  const original = req.originalDueDate ?? req.dueDate
  await db
    .update(schema.snoozeRequest)
    .set({ status: 'approved', reviewedByMemberId: ctx.memberId, reviewedAt: new Date() })
    .where(and(eq(schema.snoozeRequest.id, req.id), eq(schema.snoozeRequest.organizationId, ctx.orgId)))
  await db
    .update(schema.assignment)
    .set({
      dueDate: req.newDueDate,
      dueTime: req.newDueTime ?? null,
      originalDueDate: original,
      snoozeCount: req.snoozeCount + 1,
      status: 'pending',
    })
    .where(and(eq(schema.assignment.id, req.assignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
  await audit(c, { entityType: 'snooze_request', entityId: req.id, action: 'snooze.approved' })
  return c.json({ ok: true })
})

requestRoutes.post('/:orgId/snooze-requests/:id/deny', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'approveCompletions')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const parsed = denyInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'a denial reason is required' }, 400)

  const req = await loadPendingSnooze(c.env, ctx.orgId, c.req.param('id'))
  if (!req) return c.json({ error: 'not found' }, 404)
  if (req.status !== 'pending') return c.json({ error: 'not pending' }, 409)

  await db
    .update(schema.snoozeRequest)
    .set({ status: 'denied', reviewedByMemberId: ctx.memberId, reviewedAt: new Date(), denialReason: parsed.data.reason })
    .where(and(eq(schema.snoozeRequest.id, req.id), eq(schema.snoozeRequest.organizationId, ctx.orgId)))
  // Restore the assignment to a workable state — the original due date is unchanged.
  await db
    .update(schema.assignment)
    .set({ status: 'pending' })
    .where(and(eq(schema.assignment.id, req.assignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
  await audit(c, { entityType: 'snooze_request', entityId: req.id, action: 'snooze.denied' })
  return c.json({ ok: true })
})

// --- SWAP ---------------------------------------------------------------------------------------

requestRoutes.post('/:orgId/swap-requests', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'markOwnComplete')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const parsed = swapCreateInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // The requester must own the assignment they're offering up.
  const [requesterA] = await db
    .select({ id: schema.assignment.id, assignedToMemberId: schema.assignment.assignedToMemberId, status: schema.assignment.status })
    .from(schema.assignment)
    .where(and(eq(schema.assignment.id, d.requesterAssignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
    .limit(1)
  if (!requesterA) return c.json({ error: 'requester assignment not found' }, 404)
  if (requesterA.assignedToMemberId !== ctx.memberId) {
    return c.json({ error: 'you can only swap your own assignment' }, 403)
  }
  if (requesterA.status === 'completed' || requesterA.status === 'pending_review') {
    return c.json({ error: 'cannot swap a completed assignment' }, 409)
  }

  // The target member must belong to this household.
  if (d.targetMemberId === ctx.memberId) return c.json({ error: 'cannot swap with yourself' }, 400)
  const [targetM] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.id, d.targetMemberId), eq(schema.member.organizationId, ctx.orgId)))
    .limit(1)
  if (!targetM) return c.json({ error: 'target member not found' }, 404)

  // If a specific target assignment is named, it must belong to the target member (and the household).
  if (d.targetAssignmentId) {
    const [targetA] = await db
      .select({ id: schema.assignment.id, assignedToMemberId: schema.assignment.assignedToMemberId, status: schema.assignment.status })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.id, d.targetAssignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
      .limit(1)
    if (!targetA) return c.json({ error: 'target assignment not found' }, 404)
    if (targetA.assignedToMemberId !== d.targetMemberId) {
      return c.json({ error: 'target assignment does not belong to the target member' }, 400)
    }
    if (targetA.status === 'completed' || targetA.status === 'pending_review') {
      return c.json({ error: 'cannot swap for a completed assignment' }, 409)
    }
  }

  const [req] = await db
    .insert(schema.swapRequest)
    .values({
      organizationId: ctx.orgId,
      requesterAssignmentId: d.requesterAssignmentId,
      targetAssignmentId: d.targetAssignmentId ?? null,
      requesterMemberId: ctx.memberId,
      targetMemberId: d.targetMemberId,
      message: d.message ?? null,
      status: 'pending',
    })
    .returning()
  await audit(c, {
    entityType: 'swap_request',
    entityId: req.id,
    action: 'swap.requested',
    metadata: { targetMemberId: d.targetMemberId, free: !d.targetAssignmentId },
  })
  return c.json(req, 201)
})

requestRoutes.get('/:orgId/swap-requests', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const status = c.req.query('status') ?? 'pending'
  const rows = await getDb(c.env.DATABASE_URL)
    .select({
      id: schema.swapRequest.id,
      requesterAssignmentId: schema.swapRequest.requesterAssignmentId,
      targetAssignmentId: schema.swapRequest.targetAssignmentId,
      requesterMemberId: schema.swapRequest.requesterMemberId,
      targetMemberId: schema.swapRequest.targetMemberId,
      message: schema.swapRequest.message,
      status: schema.swapRequest.status,
      createdAt: schema.swapRequest.createdAt,
      resolvedAt: schema.swapRequest.resolvedAt,
    })
    .from(schema.swapRequest)
    .where(and(eq(schema.swapRequest.organizationId, orgId), eq(schema.swapRequest.status, status)))
    .orderBy(desc(schema.swapRequest.createdAt))
    .limit(200)
  return c.json(rows)
})

/** Load a pending swap + both assignments' current assignees, scoped to the org. */
async function loadPendingSwap(env: HouseholdEnv['Bindings'], orgId: string, requestId: string) {
  const [row] = await getDb(env.DATABASE_URL)
    .select({
      id: schema.swapRequest.id,
      requesterAssignmentId: schema.swapRequest.requesterAssignmentId,
      targetAssignmentId: schema.swapRequest.targetAssignmentId,
      requesterMemberId: schema.swapRequest.requesterMemberId,
      targetMemberId: schema.swapRequest.targetMemberId,
      status: schema.swapRequest.status,
    })
    .from(schema.swapRequest)
    .where(and(eq(schema.swapRequest.id, requestId), eq(schema.swapRequest.organizationId, orgId)))
    .limit(1)
  return row
}

requestRoutes.post('/:orgId/swap-requests/:id/accept', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const req = await loadPendingSwap(c.env, ctx.orgId, c.req.param('id'))
  if (!req) return c.json({ error: 'not found' }, 404)
  if (req.status !== 'pending') return c.json({ error: 'not pending' }, 409)
  // Only the target member may accept (an admin can reassign directly instead).
  if (req.targetMemberId !== ctx.memberId) return c.json({ error: 'forbidden — only the target member can accept' }, 403)

  // Hand the requester's assignment to the target member.
  await db
    .update(schema.assignment)
    .set({ assignedToMemberId: req.targetMemberId })
    .where(and(eq(schema.assignment.id, req.requesterAssignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
  // A specific trade also hands the target's assignment back to the requester.
  if (req.targetAssignmentId) {
    await db
      .update(schema.assignment)
      .set({ assignedToMemberId: req.requesterMemberId })
      .where(and(eq(schema.assignment.id, req.targetAssignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
  }
  await db
    .update(schema.swapRequest)
    .set({ status: 'accepted', resolvedAt: new Date() })
    .where(and(eq(schema.swapRequest.id, req.id), eq(schema.swapRequest.organizationId, ctx.orgId)))
  await audit(c, { entityType: 'swap_request', entityId: req.id, action: 'swap.accepted' })
  return c.json({ ok: true })
})

requestRoutes.post('/:orgId/swap-requests/:id/decline', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const req = await loadPendingSwap(c.env, ctx.orgId, c.req.param('id'))
  if (!req) return c.json({ error: 'not found' }, 404)
  if (req.status !== 'pending') return c.json({ error: 'not pending' }, 409)
  // The target declines; the requester may also cancel their own outstanding request.
  if (req.targetMemberId !== ctx.memberId && req.requesterMemberId !== ctx.memberId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  await db
    .update(schema.swapRequest)
    .set({ status: 'declined', resolvedAt: new Date() })
    .where(and(eq(schema.swapRequest.id, req.id), eq(schema.swapRequest.organizationId, ctx.orgId)))
  await audit(c, { entityType: 'swap_request', entityId: req.id, action: 'swap.declined' })
  return c.json({ ok: true })
})
