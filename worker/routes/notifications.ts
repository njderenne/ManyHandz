import { Hono } from 'hono'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'

/**
 * Notifications — THE canonical org-scoped resource route: the reference implementation of golden
 * rule 4 (app-layer authorization). Every product resource route copies this exact shape:
 *
 *   1. `requireOrg` middleware — session gate + the URL's :orgId must equal the session's ACTIVE
 *      organization (Better-Auth enforces membership when the active org is set, so this one
 *      check is sufficient). See worker/middleware/org.ts.
 *   2. Every query filters by organizationId — and by userId where the resource is per-user.
 *
 * Pairs with the canonical client hook (src/lib/query/hooks/useNotifications.ts) and the
 * org-scoped query keys (src/lib/query/keys.ts).
 *
 *   GET  /api/organizations/:orgId/notifications           → caller's notifications, newest first
 *   POST /api/organizations/:orgId/notifications/read      { ids: string[] } → mark read
 *   POST /api/organizations/:orgId/notifications/read-all  → mark everything read
 */
export const notificationRoutes = new Hono<AuthEnv>()

/** Caps on POST /read ids — notification ids are short tokens; an unbounded array is an abuse vector. */
const MAX_READ_IDS = 100
const MAX_ID_LENGTH = 64

notificationRoutes.get('/:orgId/notifications', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  // Cursor pagination: ?cursor=<ISO createdAt of the last row seen> → rows strictly older.
  // Boundary caveat: lt() means rows sharing the cursor's EXACT timestamp are skipped on the
  // next page. Acceptable for insert-time notification rows (collisions are rare); a composite
  // (createdAt, id) cursor is the upgrade path if a minted app bulk-inserts notifications.
  const cursor = c.req.query('cursor')
  const cursorDate = cursor ? new Date(cursor) : null
  const scope = and(
    eq(schema.notification.organizationId, orgId),
    eq(schema.notification.userId, session.user.id),
  )
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.notification)
    .where(
      cursorDate && !Number.isNaN(cursorDate.getTime())
        ? and(scope, lt(schema.notification.createdAt, cursorDate))
        : scope,
    )
    // id desc as the tiebreaker — keeps the order stable when createdAt collides.
    .orderBy(desc(schema.notification.createdAt), desc(schema.notification.id))
    .limit(50)
  return c.json(rows)
})

notificationRoutes.post('/:orgId/notifications/read', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  // The JSON body is untrusted at runtime — ids must be a real string array before inArray().
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const ids = body?.ids
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'ids is required' }, 400)
  if (ids.length > MAX_READ_IDS) {
    return c.json({ error: `too many ids (max ${MAX_READ_IDS})` }, 400)
  }
  if (!ids.every((id) => typeof id === 'string' && id.length <= MAX_ID_LENGTH)) {
    return c.json({ error: `ids must be strings of at most ${MAX_ID_LENGTH} chars` }, 400)
  }

  await getDb(c.env.DATABASE_URL)
    .update(schema.notification)
    .set({ isRead: true })
    .where(
      and(
        inArray(schema.notification.id, ids),
        // Scoping on the WRITE too — ids from the client are never trusted on their own.
        eq(schema.notification.organizationId, orgId),
        eq(schema.notification.userId, session.user.id),
      ),
    )
  return c.json({ ok: true })
})

notificationRoutes.post('/:orgId/notifications/read-all', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  await getDb(c.env.DATABASE_URL)
    .update(schema.notification)
    .set({ isRead: true })
    .where(
      and(
        eq(schema.notification.organizationId, orgId),
        eq(schema.notification.userId, session.user.id),
        eq(schema.notification.isRead, false),
      ),
    )
  return c.json({ ok: true })
})
