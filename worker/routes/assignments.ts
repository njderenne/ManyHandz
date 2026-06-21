import { Hono } from 'hono'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { requirePermission, resolveHousehold, type HouseholdEnv } from '../household'
import { can } from '@/lib/config/modes'

/**
 * Assignments — dated instances of a chore tied to one member; the core unit of work. Creating one
 * (one-off) needs `assignChores`; the assignee can start/skip/progress THEIR OWN without a special
 * permission; admins can reassign or change any. The chore basics are embedded in list/detail so the
 * board renders without a second round-trip. Completion + approval live in routes/completions.ts.
 *
 *   POST  /api/organizations/:orgId/assignments           → create one-off            (assignChores)
 *   GET   /api/organizations/:orgId/assignments           → list (?from&?to&?status&?assignedToMemberId)
 *   GET   /api/organizations/:orgId/assignments/:id       → detail (+ chore basics)
 *   PATCH /api/organizations/:orgId/assignments/:id       → status / checklist / reassign / due
 */
export const assignmentRoutes = new Hono<HouseholdEnv>()

const choreCols = {
  choreName: schema.chore.name,
  choreIcon: schema.chore.icon,
  difficulty: schema.chore.difficulty,
  estimatedMinutes: schema.chore.estimatedMinutes,
  requiresApproval: schema.chore.requiresApproval,
  aiVerificationEnabled: schema.chore.aiVerificationEnabled,
  categoryId: schema.chore.categoryId,
  checklist: schema.chore.checklist,
  referencePhotoMediaId: schema.chore.referencePhotoMediaId,
}

const createInput = z.object({
  choreId: z.string().min(1).max(64),
  assignedToMemberId: z.string().min(1).max(64),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
})

const ASSIGNMENT_STATUSES = ['pending', 'in_progress', 'completed', 'overdue', 'skipped', 'pending_review', 'snoozed_pending_approval'] as const
const patchInput = z.object({
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  checklistProgress: z.array(z.object({ label: z.string().max(120), done: z.boolean() })).max(30).optional(),
  skipReason: z.string().trim().max(300).nullish(),
  assignedToMemberId: z.string().min(1).max(64).optional(), // reassign (admin)
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // (admin)
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(), // (admin)
})

/** Both the chore and the assignee must belong to this household. */
async function refsOk(env: HouseholdEnv['Bindings'], orgId: string, choreId: string, memberId: string) {
  const db = getDb(env.DATABASE_URL)
  const [ch] = await db.select({ id: schema.chore.id }).from(schema.chore)
    .where(and(eq(schema.chore.id, choreId), eq(schema.chore.organizationId, orgId), eq(schema.chore.isActive, true))).limit(1)
  const [m] = await db.select({ id: schema.member.id }).from(schema.member)
    .where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, orgId))).limit(1)
  return Boolean(ch && m)
}

assignmentRoutes.post('/:orgId/assignments', requireOrg, requirePermission('assignChores'), async (c) => {
  const { orgId } = c.get('household')
  const parsed = createInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data
  if (!(await refsOk(c.env, orgId, d.choreId, d.assignedToMemberId))) return c.json({ error: 'invalid chore or member' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.assignment)
    .values({
      organizationId: orgId,
      choreId: d.choreId,
      assignedToMemberId: d.assignedToMemberId,
      dueDate: d.dueDate,
      dueTime: d.dueTime ?? null,
      originalDueDate: d.dueDate,
      status: 'pending',
    })
    .returning()
  await audit(c, { entityType: 'assignment', entityId: row.id, action: 'assignment.created' })
  return c.json(row, 201)
})

assignmentRoutes.get('/:orgId/assignments', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const q = c.req.query()
  const filters = [eq(schema.assignment.organizationId, orgId)]
  if (q.assignedToMemberId) filters.push(eq(schema.assignment.assignedToMemberId, q.assignedToMemberId))
  if (q.status && (ASSIGNMENT_STATUSES as readonly string[]).includes(q.status)) filters.push(eq(schema.assignment.status, q.status))
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) filters.push(gte(schema.assignment.dueDate, q.from))
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) filters.push(lte(schema.assignment.dueDate, q.to))

  const rows = await getDb(c.env.DATABASE_URL)
    .select({
      id: schema.assignment.id,
      choreId: schema.assignment.choreId,
      assignedToMemberId: schema.assignment.assignedToMemberId,
      rotationGroupId: schema.assignment.rotationGroupId,
      dueDate: schema.assignment.dueDate,
      dueTime: schema.assignment.dueTime,
      snoozeCount: schema.assignment.snoozeCount,
      checklistProgress: schema.assignment.checklistProgress,
      status: schema.assignment.status,
      createdAt: schema.assignment.createdAt,
      ...choreCols,
    })
    .from(schema.assignment)
    .innerJoin(schema.chore, eq(schema.chore.id, schema.assignment.choreId))
    .where(and(...filters))
    .orderBy(asc(schema.assignment.dueDate), asc(schema.assignment.dueTime))
    .limit(500)
  return c.json(rows)
})

assignmentRoutes.get('/:orgId/assignments/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .select({
      id: schema.assignment.id,
      choreId: schema.assignment.choreId,
      assignedToMemberId: schema.assignment.assignedToMemberId,
      rotationGroupId: schema.assignment.rotationGroupId,
      dueDate: schema.assignment.dueDate,
      dueTime: schema.assignment.dueTime,
      originalDueDate: schema.assignment.originalDueDate,
      snoozeCount: schema.assignment.snoozeCount,
      checklistProgress: schema.assignment.checklistProgress,
      status: schema.assignment.status,
      skipReason: schema.assignment.skipReason,
      createdAt: schema.assignment.createdAt,
      ...choreCols,
    })
    .from(schema.assignment)
    .innerJoin(schema.chore, eq(schema.chore.id, schema.assignment.choreId))
    .where(and(eq(schema.assignment.id, c.req.param('id')), eq(schema.assignment.organizationId, orgId)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})

assignmentRoutes.patch('/:orgId/assignments/:id', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const id = c.req.param('id')
  const db = getDb(c.env.DATABASE_URL)
  const [current] = await db
    .select({ id: schema.assignment.id, assignedToMemberId: schema.assignment.assignedToMemberId })
    .from(schema.assignment)
    .where(and(eq(schema.assignment.id, id), eq(schema.assignment.organizationId, ctx.orgId)))
    .limit(1)
  if (!current) return c.json({ error: 'not found' }, 404)

  const isAssignee = current.assignedToMemberId === ctx.memberId
  const isManager = can(ctx.mode, ctx.householdRole, 'assignChores')
  if (!isAssignee && !isManager) return c.json({ error: 'forbidden' }, 403)

  const parsed = patchInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  const updates: Record<string, unknown> = {}
  // Assignee self-service: progress their own work (start/skip + checklist).
  if (d.checklistProgress !== undefined) updates.checklistProgress = d.checklistProgress
  if (d.status !== undefined) {
    const selfStatuses = ['in_progress', 'skipped', 'pending']
    if (isManager || selfStatuses.includes(d.status)) updates.status = d.status
    else return c.json({ error: 'forbidden — that status change needs an admin' }, 403)
  }
  if (d.skipReason !== undefined) updates.skipReason = d.skipReason ?? null
  // Admin-only: reassign / reschedule.
  if (isManager) {
    if (d.assignedToMemberId !== undefined) {
      const [m] = await db
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(and(eq(schema.member.id, d.assignedToMemberId), eq(schema.member.organizationId, ctx.orgId)))
        .limit(1)
      if (!m) return c.json({ error: 'invalid member' }, 400)
      updates.assignedToMemberId = d.assignedToMemberId
    }
    if (d.dueDate !== undefined) updates.dueDate = d.dueDate
    if (d.dueTime !== undefined) updates.dueTime = d.dueTime ?? null
  } else if (d.assignedToMemberId !== undefined || d.dueDate !== undefined || d.dueTime !== undefined) {
    return c.json({ error: 'forbidden — reassign/reschedule needs an admin' }, 403)
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'no permitted fields to update' }, 400)

  const [row] = await db
    .update(schema.assignment)
    .set(updates)
    .where(and(eq(schema.assignment.id, id), eq(schema.assignment.organizationId, ctx.orgId)))
    .returning()
  await audit(c, { entityType: 'assignment', entityId: id, action: 'assignment.updated', metadata: { fields: Object.keys(updates) } })
  return c.json(row)
})
