import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'
import { householdContext } from '../lib/household-context'

/**
 * Quick tasks — lightweight one-off to-dos. Deliberately OUTSIDE the points/gamification system:
 * there is no chore, no assignment, no creditLedger write, no approval — just a checkable item with
 * an optional assignee + due date (brief §"Quick Tasks / One-Off To-Dos").
 *
 * Authorization is intentionally flat: any household member may create, edit, complete, reopen, or
 * delete a quick task (these are shared household to-dos, not gamified work), so writes gate on
 * `requireOrg` + a resolved household member only — there is no mode-permission key for them. Every
 * query still scopes by organizationId itself. Pairs with src/lib/query/hooks/useQuickTasks.ts.
 *
 *   GET    /api/organizations/:orgId/quick-tasks              → all tasks, open first, newest first
 *   POST   /api/organizations/:orgId/quick-tasks              → create
 *   PATCH  /api/organizations/:orgId/quick-tasks/:taskId      → edit fields
 *   POST   /api/organizations/:orgId/quick-tasks/:taskId/complete  → single-tap complete
 *   POST   /api/organizations/:orgId/quick-tasks/:taskId/reopen    → un-complete
 *   DELETE /api/organizations/:orgId/quick-tasks/:taskId      → delete
 */
export const quickTaskRoutes = new Hono<AuthEnv>()

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:MM')

const quickTaskCreate = z.object({
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(1000).nullish(),
  assignedToMemberId: z.string().max(64).nullish(),
  dueDate: dateString.nullish(),
  dueTime: timeString.nullish(),
})
const quickTaskUpdate = quickTaskCreate.partial()

/** Confirm an assignee member belongs to this household (or is cleared). Returns false on a foreign id. */
async function assigneeOk(
  env: AuthEnv['Bindings'],
  orgId: string,
  memberId: string | null | undefined,
): Promise<boolean> {
  if (!memberId) return true
  const [m] = await getDb(env.DATABASE_URL)
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, orgId)))
    .limit(1)
  return Boolean(m)
}

quickTaskRoutes.get('/:orgId/quick-tasks', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.quickTask)
    .where(eq(schema.quickTask.organizationId, orgId))
    .orderBy(schema.quickTask.isCompleted, desc(schema.quickTask.createdAt))
  return c.json(rows)
})

quickTaskRoutes.post('/:orgId/quick-tasks', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const parsed = quickTaskCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data
  if (!(await assigneeOk(c.env, ctx.orgId, d.assignedToMemberId))) {
    return c.json({ error: 'invalid assignee' }, 400)
  }

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.quickTask)
    .values({
      organizationId: ctx.orgId,
      title: d.title,
      note: d.note ?? null,
      assignedToMemberId: d.assignedToMemberId ?? null,
      dueDate: d.dueDate ?? null,
      dueTime: d.dueTime ?? null,
      createdByMemberId: ctx.memberId,
    })
    .returning()
  await audit(c, { entityType: 'quick_task', entityId: row.id, action: 'quick_task.created', metadata: { title: row.title } })
  return c.json(row, 201)
})

quickTaskRoutes.patch('/:orgId/quick-tasks/:taskId', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const taskId = c.req.param('taskId')
  const parsed = quickTaskUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data
  if (!(await assigneeOk(c.env, ctx.orgId, d.assignedToMemberId))) {
    return c.json({ error: 'invalid assignee' }, 400)
  }

  // PATCH semantics: only write the keys the client actually sent.
  const updates: Partial<typeof schema.quickTask.$inferInsert> = {}
  if (d.title !== undefined) updates.title = d.title
  if (d.note !== undefined) updates.note = d.note ?? null
  if (d.assignedToMemberId !== undefined) updates.assignedToMemberId = d.assignedToMemberId ?? null
  if (d.dueDate !== undefined) updates.dueDate = d.dueDate ?? null
  if (d.dueTime !== undefined) updates.dueTime = d.dueTime ?? null
  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.quickTask)
    .set(updates)
    .where(and(eq(schema.quickTask.id, taskId), eq(schema.quickTask.organizationId, ctx.orgId)))
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'quick_task', entityId: row.id, action: 'quick_task.updated' })
  return c.json(row)
})

quickTaskRoutes.post('/:orgId/quick-tasks/:taskId/complete', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const taskId = c.req.param('taskId')
  // Single-tap complete — credit goes to whoever tapped. Idempotent: only flips an open task.
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.quickTask)
    .set({ isCompleted: true, completedByMemberId: ctx.memberId, completedAt: new Date() })
    .where(
      and(
        eq(schema.quickTask.id, taskId),
        eq(schema.quickTask.organizationId, ctx.orgId),
        eq(schema.quickTask.isCompleted, false),
      ),
    )
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'quick_task', entityId: row.id, action: 'quick_task.completed' })
  return c.json(row)
})

quickTaskRoutes.post('/:orgId/quick-tasks/:taskId/reopen', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const taskId = c.req.param('taskId')
  // Un-complete: clear the completion fields. Idempotent: only flips a completed task.
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.quickTask)
    .set({ isCompleted: false, completedByMemberId: null, completedAt: null })
    .where(
      and(
        eq(schema.quickTask.id, taskId),
        eq(schema.quickTask.organizationId, ctx.orgId),
        eq(schema.quickTask.isCompleted, true),
      ),
    )
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'quick_task', entityId: row.id, action: 'quick_task.reopened' })
  return c.json(row)
})

quickTaskRoutes.delete('/:orgId/quick-tasks/:taskId', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const taskId = c.req.param('taskId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .delete(schema.quickTask)
    .where(and(eq(schema.quickTask.id, taskId), eq(schema.quickTask.organizationId, ctx.orgId)))
    .returning({ id: schema.quickTask.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'quick_task', entityId: taskId, action: 'quick_task.deleted' })
  return c.json({ ok: true })
})
