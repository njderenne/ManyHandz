import { Hono } from 'hono'
import { and, asc, eq, gt, gte, ilike, lte, type SQL } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'

/**
 * Events — THIS IS THE CANONICAL RESOURCE ROUTE TO COPY (alongside notifications.ts for the
 * read-side basics). The worked example of a PRODUCT resource: org-scoped CRUD over
 * calendar_event with search, date-range filters, cursor pagination, validation with length
 * caps, and audit-trail writes. When a minted app adds its own resource ("plants", "workouts",
 * "listings", …), copy this file and rename — every convention is demonstrated on a handler:
 *
 *   1. `requireOrg` on EVERY endpoint (worker/middleware/org.ts) — session gate + the URL's
 *      :orgId must equal the session's active organization.
 *   2. Every query — reads AND writes — filters by organizationId. The middleware authenticates
 *      the caller; the WHERE clause is what actually fences the data (golden rule 4).
 *   3. Identity comes from the SESSION (`createdByUserId`), never from the request body.
 *   4. Every client string is validated with an explicit length cap (moderation.ts rigor) —
 *      TEXT columns accept unbounded input, so the route is the only guard against bloat.
 *   5. Pagination is cursor-based over a STABLE order (startsAt asc, id asc tiebreaker), so
 *      pages never shift under the reader the way offset pagination does.
 *
 * Pairs with the canonical client hook (src/lib/query/hooks/useEvents.ts) and the worked-example
 * screens (app/events/). Query keys: src/lib/query/keys.ts → organizations.events/eventDetail.
 *
 *   GET    /api/organizations/:orgId/events?search=&from=&to=&cursor=  → page, soonest first
 *   POST   /api/organizations/:orgId/events                            → create
 *   GET    /api/organizations/:orgId/events/:id                        → one event
 *   PATCH  /api/organizations/:orgId/events/:id                        → partial update
 *   DELETE /api/organizations/:orgId/events/:id                        → delete
 *
 * Authorization model: calendar_event is an ORG-WIDE resource — any member may create, edit, or
 * delete (createdByUserId is attribution, not ownership). If your app wants creator-only edits,
 * add `eq(calendarEvent.createdByUserId, session.user.id)` to the write WHEREs; for admin-only
 * writes, mount `requireRole('owner', 'admin')` after requireOrg on the write handlers.
 */
export const eventRoutes = new Hono<AuthEnv>()

/** One page per request — matches PAGE_SIZE in useEvents.ts (a short page = end of the list). */
const PAGE_SIZE = 50

// Length caps for client-sent strings (convention 4 above). TEXT columns enforce nothing, so
// these numbers — generous for humans, ruinous for scripts — are the schema's real limits.
const MAX_TITLE = 300
const MAX_LOCATION = 500
const MAX_DESCRIPTION = 5000
const MAX_KIND = 64
const MAX_SEARCH = 200

/**
 * Escape LIKE/ILIKE wildcards so user input matches LITERALLY: searching "50%" must match the
 * string "50%", not "everything starting with 50". Postgres' default escape character is the
 * backslash, so escaping `%`, `_`, and `\` itself is sufficient — no ESCAPE clause needed.
 * (Injection is already impossible — Drizzle parameterizes — this is about match CORRECTNESS.)
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** Parse an optional ISO date query param: absent → null, unparseable → 'invalid' (a 400). */
function parseDateParam(value: string | undefined): Date | null | 'invalid' {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'invalid' : date
}

/** Raw write payload — every field `unknown` so POST and PATCH share one validator. */
type EventBody = {
  title?: unknown
  startsAt?: unknown
  endsAt?: unknown
  allDay?: unknown
  location?: unknown
  description?: unknown
  kind?: unknown
}

/**
 * Validated write fields — contains ONLY the keys the caller actually sent, so PATCH can pass
 * it straight to `.set(fields)` (absent keys stay untouched). `null` clears a nullable column;
 * `undefined` never appears as a value.
 */
type EventWrite = {
  title?: string
  startsAt?: Date
  endsAt?: Date | null
  allDay?: boolean
  location?: string | null
  description?: string | null
  kind?: string | null
}

/** Optional TEXT field: a string (trimmed, capped) or null to clear ('' also clears to null). */
function parseOptionalText(
  value: unknown,
  field: string,
  max: number,
): { error: string } | { value: string | null } {
  if (value === null) return { value: null }
  if (typeof value !== 'string') return { error: `${field} must be a string or null` }
  if (value.length > max) return { error: `${field} must be at most ${max} characters` }
  return { value: value.trim() || null }
}

/**
 * Validate + normalize a write body — the single validator both POST and PATCH run (POST then
 * additionally requires title/startsAt). First error wins: clients get one precise message at a
 * time instead of an error-array contract the template would have to maintain forever.
 */
function parseEventWrite(body: EventBody): { error: string } | { fields: EventWrite } {
  const fields: EventWrite = {}

  if ('title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return { error: 'title is required' }
    }
    const title = body.title.trim()
    if (title.length > MAX_TITLE) return { error: `title must be 1-${MAX_TITLE} characters` }
    fields.title = title
  }

  if ('startsAt' in body) {
    const startsAt = typeof body.startsAt === 'string' ? new Date(body.startsAt) : null
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      return { error: 'startsAt must be an ISO timestamp' }
    }
    fields.startsAt = startsAt
  }

  if ('endsAt' in body) {
    if (body.endsAt === null) {
      fields.endsAt = null // explicit null clears the end time
    } else {
      const endsAt = typeof body.endsAt === 'string' ? new Date(body.endsAt) : null
      if (!endsAt || Number.isNaN(endsAt.getTime())) {
        return { error: 'endsAt must be an ISO timestamp or null' }
      }
      fields.endsAt = endsAt
    }
  }

  if ('allDay' in body) {
    if (typeof body.allDay !== 'boolean') return { error: 'allDay must be a boolean' }
    fields.allDay = body.allDay
  }

  if ('location' in body) {
    const parsed = parseOptionalText(body.location, 'location', MAX_LOCATION)
    if ('error' in parsed) return parsed
    fields.location = parsed.value
  }
  // `description` is the schema column; the screens label it "Notes" (UI copy ≠ API contract).
  if ('description' in body) {
    const parsed = parseOptionalText(body.description, 'description', MAX_DESCRIPTION)
    if ('error' in parsed) return parsed
    fields.description = parsed.value
  }
  if ('kind' in body) {
    const parsed = parseOptionalText(body.kind, 'kind', MAX_KIND)
    if ('error' in parsed) return parsed
    fields.kind = parsed.value
  }

  return { fields }
}

/** Cross-field invariant — checked on the MERGED row in PATCH, so a partial update can't sneak
 *  endsAt before startsAt by moving only one of the pair. */
function endsBeforeStarts(startsAt: Date, endsAt: Date | null): boolean {
  return endsAt !== null && endsAt.getTime() <= startsAt.getTime()
}

/**
 * List — THE searchable-list read shape to copy. Org scope + three optional narrows + cursor:
 *
 *   ?search=  case-insensitive substring match on title (wildcards escaped → input is literal)
 *   ?from=    ISO timestamp → events starting AT or AFTER it   (the screen's "Upcoming" chip)
 *   ?to=      ISO timestamp → events starting AT or BEFORE it  (the screen's "Past" chip)
 *   ?cursor=  ISO startsAt of the last row seen → rows strictly after it
 *
 * Ordering: startsAt ASC — soonest first, the natural read for a calendar — with id ASC as the
 * tiebreaker so pages stay deterministic when two events share a timestamp. Boundary caveat
 * (same as notifications.ts): gt() skips rows sharing the cursor's EXACT timestamp; fine for
 * hand-created events, and a composite (startsAt, id) cursor is the upgrade path. If your app
 * wants a newest-first feed (e.g. a "Past" tab read backwards), add ?order=desc and flip
 * asc/gt to desc/lt — notifications.ts shows the desc shape.
 */
eventRoutes.get('/:orgId/events', requireOrg, async (c) => {
  const orgId = c.get('orgId')

  // Org scope FIRST — every other condition only narrows within the tenant fence.
  const conditions: SQL[] = [eq(schema.calendarEvent.organizationId, orgId)]

  const searchParam = c.req.query('search')
  if (searchParam !== undefined) {
    const search = searchParam.trim()
    if (search.length > MAX_SEARCH) {
      return c.json({ error: `search must be at most ${MAX_SEARCH} characters` }, 400)
    }
    if (search) {
      // ilike + leading wildcard = sequential scan beyond a few thousand rows per org. Fine
      // here; the upgrade path is a pg_trgm GIN index on title, not a search service.
      conditions.push(ilike(schema.calendarEvent.title, `%${escapeLike(search)}%`))
    }
  }

  // Range filters target startsAt — the column the org index covers (calendar_event_org_time_idx).
  const from = parseDateParam(c.req.query('from'))
  if (from === 'invalid') return c.json({ error: 'from must be an ISO timestamp' }, 400)
  if (from) conditions.push(gte(schema.calendarEvent.startsAt, from))

  const to = parseDateParam(c.req.query('to'))
  if (to === 'invalid') return c.json({ error: 'to must be an ISO timestamp' }, 400)
  if (to) conditions.push(lte(schema.calendarEvent.startsAt, to))

  // Cursor: client-generated, so an unparseable value is ignored (first page), not a 400 —
  // a stale persisted cache must never wedge the list.
  const cursor = c.req.query('cursor')
  const cursorDate = cursor ? new Date(cursor) : null
  if (cursorDate && !Number.isNaN(cursorDate.getTime())) {
    conditions.push(gt(schema.calendarEvent.startsAt, cursorDate))
  }

  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.calendarEvent)
    .where(and(...conditions))
    // id asc as the tiebreaker — keeps the order stable when startsAt collides.
    .orderBy(asc(schema.calendarEvent.startsAt), asc(schema.calendarEvent.id))
    .limit(PAGE_SIZE)
  return c.json(rows)
})

/**
 * Create — validate first (the caps above), identity from the SESSION, audit after. Returns 201
 * with the full row so the client can seed its detail cache without a follow-up GET.
 */
eventRoutes.post('/:orgId/events', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const parsed = parseEventWrite(await c.req.json<EventBody>())
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const { fields } = parsed

  // POST requires what the business logic can't default; everything else has a sane fallback.
  if (fields.title === undefined) return c.json({ error: 'title is required' }, 400)
  if (fields.startsAt === undefined) {
    return c.json({ error: 'startsAt is required (ISO timestamp)' }, 400)
  }
  if (endsBeforeStarts(fields.startsAt, fields.endsAt ?? null)) {
    return c.json({ error: 'endsAt must be after startsAt' }, 400)
  }

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.calendarEvent)
    .values({
      organizationId: orgId,
      // Attribution comes from the SESSION, never the body — golden rule 4.
      createdByUserId: session.user.id,
      title: fields.title,
      startsAt: fields.startsAt,
      endsAt: fields.endsAt ?? null,
      allDay: fields.allDay ?? false,
      location: fields.location ?? null,
      description: fields.description ?? null,
      kind: fields.kind ?? null,
    })
    .returning()
  if (!row) return c.json({ error: 'failed to create event' }, 500)

  // Org activity trail — audit() swallows its own failures, so logging can't fail the create.
  await audit(c, {
    entityType: 'calendar_event',
    entityId: row.id,
    action: 'event.created',
    metadata: { title: row.title },
  })
  return c.json(row, 201)
})

/** Detail — same fence as the list: the id alone is NEVER trusted; the org scope rides along. */
eventRoutes.get('/:orgId/events/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')

  const [row] = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.calendarEvent)
    .where(and(eq(schema.calendarEvent.id, id), eq(schema.calendarEvent.organizationId, orgId)))
    .limit(1)
  // A row that exists in ANOTHER org returns the same 404 as a missing row — never leak existence.
  if (!row) return c.json({ error: 'event not found' }, 404)
  return c.json(row)
})

/**
 * Partial update — only the keys present in the body change. Reads the existing row first so
 * the startsAt/endsAt invariant is checked against the MERGED result (a PATCH that only moves
 * startsAt past the stored endsAt must fail too). updatedAt bumps itself ($onUpdate, schema.ts).
 */
eventRoutes.patch('/:orgId/events/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')

  const parsed = parseEventWrite(await c.req.json<EventBody>())
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const { fields } = parsed
  if (Object.keys(fields).length === 0) return c.json({ error: 'nothing to update' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  const [existing] = await db
    .select()
    .from(schema.calendarEvent)
    .where(and(eq(schema.calendarEvent.id, id), eq(schema.calendarEvent.organizationId, orgId)))
    .limit(1)
  if (!existing) return c.json({ error: 'event not found' }, 404)

  // Merge patch onto the stored row, then re-check the invariant on the result.
  const nextStartsAt = fields.startsAt ?? existing.startsAt
  const nextEndsAt = 'endsAt' in fields ? (fields.endsAt ?? null) : existing.endsAt
  if (endsBeforeStarts(nextStartsAt, nextEndsAt)) {
    return c.json({ error: 'endsAt must be after startsAt' }, 400)
  }

  const [row] = await db
    .update(schema.calendarEvent)
    .set(fields)
    .where(
      and(
        eq(schema.calendarEvent.id, id),
        // Scoping on the WRITE too — the read above could race; this WHERE is the guarantee.
        eq(schema.calendarEvent.organizationId, orgId),
      ),
    )
    .returning()
  if (!row) return c.json({ error: 'event not found' }, 404)

  await audit(c, {
    entityType: 'calendar_event',
    entityId: row.id,
    action: 'event.updated',
    metadata: { changed: Object.keys(fields) },
  })
  return c.json(row)
})

/** Delete — org-scoped WHERE on the write, honest 404 when nothing matched, audit after. */
eventRoutes.delete('/:orgId/events/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')

  const [deleted] = await getDb(c.env.DATABASE_URL)
    .delete(schema.calendarEvent)
    .where(and(eq(schema.calendarEvent.id, id), eq(schema.calendarEvent.organizationId, orgId)))
    .returning({ id: schema.calendarEvent.id, title: schema.calendarEvent.title })
  if (!deleted) return c.json({ error: 'event not found' }, 404)

  await audit(c, {
    entityType: 'calendar_event',
    entityId: deleted.id,
    action: 'event.deleted',
    metadata: { title: deleted.title },
  })
  return c.json({ ok: true })
})
