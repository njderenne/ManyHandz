import { Hono } from 'hono'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, requireCapability, type AuthEnv } from '../middleware/org'


/**
 * Rotations — recurring chores that rotate themselves among an ordered set of members and skip
 * whoever's away (the vacation-safe rotation; engine in src/lib/manyhandz/rotation.ts, advanced by
 * worker/manyhandz/cron-jobs.ts). This route is the SETUP surface: create/list/stop a rotation
 * group. Creating one also mints the FIRST assignment immediately (to member_order[0]) so the
 * rotation is useful today, not on the next cron boundary. Writes need `assignChores`.
 *
 *   GET    /api/organizations/:orgId/rotations        → active groups (+ chore basics)
 *   POST   /api/organizations/:orgId/rotations        → create + seed the first assignment   (assignChores)
 *   DELETE /api/organizations/:orgId/rotations/:id    → stop (soft, isActive=false)           (assignChores)
 */
export const rotationRoutes = new Hono<AuthEnv>()

const createInput = z.object({
  choreId: z.string().min(1).max(64),
  memberOrder: z.array(z.string().min(1).max(64)).min(1).max(20),
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  rotationType: z.enum(['round_robin', 'fixed']).default('round_robin'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

rotationRoutes.get('/:orgId/rotations', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select({
      id: schema.rotationGroup.id,
      choreId: schema.rotationGroup.choreId,
      memberOrder: schema.rotationGroup.memberOrder,
      currentIndex: schema.rotationGroup.currentIndex,
      rotationType: schema.rotationGroup.rotationType,
      frequency: schema.rotationGroup.frequency,
      startDate: schema.rotationGroup.startDate,
      choreName: schema.chore.name,
      choreIcon: schema.chore.icon,
    })
    .from(schema.rotationGroup)
    .innerJoin(schema.chore, eq(schema.chore.id, schema.rotationGroup.choreId))
    .where(and(eq(schema.rotationGroup.organizationId, orgId), eq(schema.rotationGroup.isActive, true)))
    .orderBy(desc(schema.rotationGroup.createdAt))
  return c.json(rows)
})

rotationRoutes.post('/:orgId/rotations', requireOrg, requireCapability('chore:assign'), async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)
  const parsed = createInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // The chore must belong to this household and still be active.
  const [chore] = await db
    .select({ id: schema.chore.id })
    .from(schema.chore)
    .where(and(eq(schema.chore.id, d.choreId), eq(schema.chore.organizationId, orgId), eq(schema.chore.isActive, true)))
    .limit(1)
  if (!chore) return c.json({ error: 'invalid chore' }, 400)

  // Every member in the order must belong to this household (de-duped so a repeat can't pass the count).
  const uniqueMembers = [...new Set(d.memberOrder)]
  const found = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), inArray(schema.member.id, uniqueMembers)))
  if (found.length !== uniqueMembers.length) return c.json({ error: 'one or more members are not in this household' }, 400)

  const [group] = await db
    .insert(schema.rotationGroup)
    .values({
      organizationId: orgId,
      choreId: d.choreId,
      memberOrder: d.memberOrder,
      currentIndex: 0,
      rotationType: d.rotationType,
      frequency: d.frequency,
      startDate: d.startDate,
      isActive: true,
    })
    .returning()

  // Seed the first assignment now (to member_order[0]) so the rotation does something today; the
  // cron advances it on each interval boundary thereafter (skipping away members).
  const [first] = await db
    .insert(schema.assignment)
    .values({
      organizationId: orgId,
      choreId: d.choreId,
      assignedToMemberId: d.memberOrder[0],
      rotationGroupId: group.id,
      dueDate: d.startDate,
      originalDueDate: d.startDate,
      status: 'pending',
    })
    .returning({ id: schema.assignment.id })

  await audit(c, { entityType: 'rotation_group', entityId: group.id, action: 'rotation.created', metadata: { choreId: d.choreId, members: d.memberOrder.length } })
  return c.json({ group, firstAssignmentId: first?.id ?? null }, 201)
})

rotationRoutes.delete('/:orgId/rotations/:id', requireOrg, requireCapability('chore:assign'), async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.rotationGroup)
    .set({ isActive: false })
    .where(and(eq(schema.rotationGroup.id, id), eq(schema.rotationGroup.organizationId, orgId), eq(schema.rotationGroup.isActive, true)))
    .returning({ id: schema.rotationGroup.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'rotation_group', entityId: id, action: 'rotation.stopped' })
  return c.json({ ok: true })
})
