import { Hono } from 'hono'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { getDb, schema, type DB } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'

/**
 * Org messaging — team chat on the `message` / `message_cursor` tables. Same authorization shape
 * as notifications.ts (the canonical org-scoped resource route): `requireOrg` gates every
 * endpoint, every query filters by organizationId, and read/cursor state is scoped to the
 * session user.
 *
 *   GET  /api/organizations/:orgId/messages?channel=general&cursor=
 *        → newest-first page of messages (sender embedded) + the caller's read cursor
 *   POST /api/organizations/:orgId/messages       { channel?, content }
 *        → create a message (sender = session user; advances the sender's own cursor)
 *   POST /api/organizations/:orgId/messages/read  { channel? }
 *        → advance the caller's read cursor to the channel's latest message
 *
 * CHANNELS: the API's `channel` is the `message.threadId` column — a short slug partitioning the
 * org's chat ('general' is the app-level default; the column's schema default 'default' never
 * fires because these routes always write threadId explicitly). Minted apps add channels by
 * passing other slugs; no channel registry table is needed until channels carry metadata.
 *
 * READ STATE is per-reader CURSORS, not per-message flags (see schema.ts message_cursor): one
 * row per (org, user, channel) holding lastReadAt. "Unread" = rows with createdAt strictly newer
 * than the caller's cursor, excluding their own sends (sending advances the sender's cursor, so
 * own messages are never unread). Per-message read flags only work for two-member tenants.
 *
 * MESSAGES ARE IMMUTABLE — no edit or delete routes, BY DESIGN (court-ready/audit messaging and
 * a good default everywhere; see the schema.ts `message` header before adding either).
 *
 * DELIVERY IS POLLING: the client convention is a 15s refetchInterval on the GET
 * (src/lib/query/hooks/useMessages.ts) — plain Workers can't hold WebSocket connections open.
 * UPGRADE PATH: a Durable Object per (org, channel) using the WebSocket Hibernation API gives
 * real-time fan-out without keeping a Worker hot; adopt it only when an app outgrows polling.
 *
 * RATE LIMITS: POST /messages is a cheap-to-spam write — worker/index.ts mounts an abuse cap on
 * this route group (generous for a human chatting, ruinous for a script).
 */
export const messageRoutes = new Hono<AuthEnv>()

/**
 * The app-level default channel. Mirrored in src/lib/query/hooks/useMessages.ts
 * (DEFAULT_CHANNEL) — the client can't import worker code, so keep the two in sync.
 */
const DEFAULT_CHANNEL = 'general'

/** Channel slugs: lowercase alphanumeric with '-'/'_' separators, 1–64 chars (cap per spec). */
const CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Content cap — `message.content` is TEXT; unbounded client strings are a database-bloat vector. */
const CONTENT_MAX = 4000

/** Matches the client's PAGE_SIZE in useMessages.ts — a short page means we've reached the end. */
const PAGE_SIZE = 50

/**
 * Normalize + validate a channel slug; absent/blank/null means the default channel. Takes
 * `unknown` because POST bodies are untrusted at runtime — a non-string channel is invalid
 * (the caller 400s on null), never a thrown .trim().
 */
function parseChannel(raw: unknown): string | null {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return null
  const channel = (typeof raw === 'string' && raw.trim()) || DEFAULT_CHANNEL
  return CHANNEL_RE.test(channel) ? channel : null
}

/**
 * Upsert the caller's read cursor, ADVANCE-ONLY: GREATEST keeps a stale write (e.g. a slow
 * mark-read racing a newer send's auto-advance) from regressing the cursor and resurrecting
 * "unread" state the reader already cleared. The exact contract: the stored cursor is the MAX of
 * every lastReadAt ever written for the (org, user, channel) — concurrent mark-read and send
 * requests have no total ordering, so the newest TIMESTAMP wins regardless of arrival order.
 */
async function advanceCursor(
  db: DB,
  scope: { organizationId: string; userId: string; threadId: string },
  lastReadAt: Date,
) {
  const [row] = await db
    .insert(schema.messageCursor)
    .values({ ...scope, lastReadAt })
    .onConflictDoUpdate({
      target: [
        schema.messageCursor.organizationId,
        schema.messageCursor.userId,
        schema.messageCursor.threadId,
      ],
      set: {
        // The excluded.* column name is derived from the schema object (drizzle's Column.name is
        // the DB name, 'last_read_at'), so a schema rename can never silently desync this raw SQL.
        lastReadAt: sql`GREATEST(${schema.messageCursor.lastReadAt}, excluded.${sql.raw(schema.messageCursor.lastReadAt.name)})`,
      },
    })
    .returning()
  return row ?? null
}

messageRoutes.get('/:orgId/messages', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const channel = parseChannel(c.req.query('channel'))
  if (!channel) return c.json({ error: 'invalid channel' }, 400)

  // Cursor pagination, same shape (and same boundary caveat) as notifications.ts:
  // ?cursor=<ISO createdAt of the last row seen> → rows strictly older.
  const cursor = c.req.query('cursor')
  const cursorDate = cursor ? new Date(cursor) : null
  const scope = and(
    eq(schema.message.organizationId, orgId),
    eq(schema.message.threadId, channel),
  )

  const db = getDb(c.env.DATABASE_URL)
  const [rows, [readCursor]] = await Promise.all([
    // Sender joined in (left — senderId is set-null on account deletion, rows outlive senders)
    // so the client renders name + avatar without N+1 profile fetches.
    db
      .select({
        id: schema.message.id,
        organizationId: schema.message.organizationId,
        threadId: schema.message.threadId,
        senderId: schema.message.senderId,
        content: schema.message.content,
        mediaId: schema.message.mediaId,
        createdAt: schema.message.createdAt,
        senderName: schema.user.name,
        senderImage: schema.user.image,
      })
      .from(schema.message)
      .leftJoin(schema.user, eq(schema.message.senderId, schema.user.id))
      .where(
        cursorDate && !Number.isNaN(cursorDate.getTime())
          ? and(scope, lt(schema.message.createdAt, cursorDate))
          : scope,
      )
      // id desc as the tiebreaker — keeps the order stable when createdAt collides.
      .orderBy(desc(schema.message.createdAt), desc(schema.message.id))
      .limit(PAGE_SIZE),
    // The caller's cursor rides along on every page (one indexed point read) so the client's
    // unread math never needs a second request; it reads the first page's copy.
    db
      .select()
      .from(schema.messageCursor)
      .where(
        and(
          eq(schema.messageCursor.organizationId, orgId),
          eq(schema.messageCursor.userId, session.user.id),
          eq(schema.messageCursor.threadId, channel),
        ),
      )
      .limit(1),
  ])

  const messages = rows.map(({ senderName, senderImage, ...m }) => ({
    ...m,
    // null sender = deleted account (set-null FK); the client shows a "former member" fallback.
    sender:
      m.senderId && senderName !== null
        ? { id: m.senderId, name: senderName, image: senderImage }
        : null,
  }))
  return c.json({ messages, readCursor: readCursor ?? null })
})

messageRoutes.post('/:orgId/messages', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const body = await c.req.json<{ channel?: string; content?: string }>().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'a JSON object body is required' }, 400)
  const channel = parseChannel(body.channel)
  if (!channel) return c.json({ error: 'invalid channel' }, 400)
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return c.json({ error: 'content is required' }, 400)
  if (content.length > CONTENT_MAX) return c.json({ error: 'content too long' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  const [row] = await db
    .insert(schema.message)
    .values({
      organizationId: orgId,
      threadId: channel,
      // Sender comes from the SESSION, never the body — golden rule 4.
      senderId: session.user.id,
      content,
    })
    .returning()
  if (!row) return c.json({ error: 'failed to send message' }, 500)

  // Sending implies having read up to your own message — advance the sender's cursor so their
  // own sends never count as unread on their other devices.
  await advanceCursor(
    db,
    { organizationId: orgId, userId: session.user.id, threadId: channel },
    row.createdAt,
  )

  // Echo the sender embedded, same shape as GET rows, so the client can swap its optimistic
  // append for the server row without a refetch.
  return c.json(
    { ...row, sender: { id: session.user.id, name: session.user.name, image: session.user.image ?? null } },
    201,
  )
})

messageRoutes.post('/:orgId/messages/read', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const body = await c.req.json<{ channel?: string }>().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'a JSON object body is required' }, 400)
  const channel = parseChannel(body.channel)
  if (!channel) return c.json({ error: 'invalid channel' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  // Anchor on the channel's latest message time — NOT now(): a clock-skewed "now" could mark
  // messages read before they're fetched. An empty channel falls back to now() so the cursor
  // row still exists for future unread math.
  const [latest] = await db
    .select({ createdAt: schema.message.createdAt })
    .from(schema.message)
    .where(and(eq(schema.message.organizationId, orgId), eq(schema.message.threadId, channel)))
    .orderBy(desc(schema.message.createdAt), desc(schema.message.id))
    .limit(1)

  const row = await advanceCursor(
    db,
    { organizationId: orgId, userId: session.user.id, threadId: channel },
    latest?.createdAt ?? new Date(),
  )
  if (!row) return c.json({ error: 'failed to update read cursor' }, 500)
  return c.json(row)
})
