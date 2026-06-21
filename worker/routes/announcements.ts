import { Hono } from 'hono'
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { requirePermission, type HouseholdEnv } from '../household'

/**
 * Announcements — pinned household notices (the dashboard banner). Org-scoped reads (every member
 * sees active notices); writes are gated by `editHouseholdSettings` (== isAdmin), which is exactly
 * "parents or roommates / office managers" and never kids — matching the brief ("created by parents
 * or roommates"). Soft delete is un-pinning (`pinned = false`); GET returns only active notices
 * (pinned AND not expired), ordered urgent → important → normal, then newest first. Pairs with
 * src/lib/query/hooks/useAnnouncements.ts.
 *
 *   GET    /api/organizations/:orgId/announcements                 → active, priority then recency
 *   POST   /api/organizations/:orgId/announcements                 → create   (editHouseholdSettings)
 *   PATCH  /api/organizations/:orgId/announcements/:announcementId → edit     (editHouseholdSettings)
 *   DELETE /api/organizations/:orgId/announcements/:announcementId → un-pin   (editHouseholdSettings)
 */
export const announcementRoutes = new Hono<HouseholdEnv>()

const PRIORITIES = ['normal', 'important', 'urgent'] as const

const announcementCreate = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(2000).nullish(),
  priority: z.enum(PRIORITIES).optional(),
  // ISO-8601 instant; null clears any existing expiry. Omit to leave unchanged on PATCH.
  expiresAt: z.string().datetime().nullish(),
})
const announcementUpdate = announcementCreate.partial()

/** urgent → important → normal: lower rank sorts first. */
const PRIORITY_RANK = sql`case ${schema.announcement.priority}
  when 'urgent' then 0
  when 'important' then 1
  else 2 end`

announcementRoutes.get('/:orgId/announcements', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const now = new Date()
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.announcement)
    .where(
      and(
        eq(schema.announcement.organizationId, orgId),
        eq(schema.announcement.pinned, true),
        or(isNull(schema.announcement.expiresAt), gt(schema.announcement.expiresAt, now)),
      ),
    )
    .orderBy(PRIORITY_RANK, desc(schema.announcement.createdAt))
  return c.json(rows)
})

announcementRoutes.post(
  '/:orgId/announcements',
  requireOrg,
  requirePermission('editHouseholdSettings'),
  async (c) => {
    const { orgId, memberId } = c.get('household')
    const parsed = announcementCreate.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
    const d = parsed.data

    const [row] = await getDb(c.env.DATABASE_URL)
      .insert(schema.announcement)
      .values({
        organizationId: orgId,
        authorMemberId: memberId,
        title: d.title,
        body: d.body ?? null,
        priority: d.priority ?? 'normal',
        pinned: true,
        expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
      })
      .returning()
    await audit(c, {
      entityType: 'announcement',
      entityId: row.id,
      action: 'announcement.created',
      metadata: { priority: row.priority },
    })
    return c.json(row, 201)
  },
)

announcementRoutes.patch(
  '/:orgId/announcements/:announcementId',
  requireOrg,
  requirePermission('editHouseholdSettings'),
  async (c) => {
    const { orgId } = c.get('household')
    const announcementId = c.req.param('announcementId')
    const parsed = announcementUpdate.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
    const d = parsed.data

    // Build the update from only the keys the client actually sent (PATCH semantics).
    const updates: Partial<typeof schema.announcement.$inferInsert> = {}
    if (d.title !== undefined) updates.title = d.title
    if (d.body !== undefined) updates.body = d.body ?? null
    if (d.priority !== undefined) updates.priority = d.priority
    if (d.expiresAt !== undefined) updates.expiresAt = d.expiresAt ? new Date(d.expiresAt) : null
    if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

    const [row] = await getDb(c.env.DATABASE_URL)
      .update(schema.announcement)
      .set(updates)
      .where(
        and(
          eq(schema.announcement.id, announcementId),
          eq(schema.announcement.organizationId, orgId),
          eq(schema.announcement.pinned, true),
        ),
      )
      .returning()
    if (!row) return c.json({ error: 'not found' }, 404)
    await audit(c, { entityType: 'announcement', entityId: row.id, action: 'announcement.updated' })
    return c.json(row)
  },
)

announcementRoutes.delete(
  '/:orgId/announcements/:announcementId',
  requireOrg,
  requirePermission('editHouseholdSettings'),
  async (c) => {
    const { orgId } = c.get('household')
    const announcementId = c.req.param('announcementId')
    const [row] = await getDb(c.env.DATABASE_URL)
      .update(schema.announcement)
      .set({ pinned: false })
      .where(
        and(
          eq(schema.announcement.id, announcementId),
          eq(schema.announcement.organizationId, orgId),
          eq(schema.announcement.pinned, true),
        ),
      )
      .returning({ id: schema.announcement.id })
    if (!row) return c.json({ error: 'not found' }, 404)
    await audit(c, { entityType: 'announcement', entityId: announcementId, action: 'announcement.deleted' })
    return c.json({ ok: true })
  },
)
