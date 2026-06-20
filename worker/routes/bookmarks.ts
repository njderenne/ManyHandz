import { Hono } from 'hono'
import { and, desc, eq, lt } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'

/**
 * Bookmarks — the universal "save this" primitive, polymorphic over entityType+entityId (same
 * convention as report/notification), so a minted app can make ANY domain row saveable without
 * new tables or new endpoints. Same shape as notifications.ts (the canonical org-scoped resource
 * route): `requireOrg` gates every endpoint, and every query scopes by organizationId AND the
 * session user — a member only ever sees and edits their OWN saves.
 *
 *   GET    /api/organizations/:orgId/bookmarks?kind=&entityType=&cursor=  → caller's saves, newest first
 *   PUT    /api/organizations/:orgId/bookmarks    { entityType, entityId, kind? } → idempotent save
 *   DELETE /api/organizations/:orgId/bookmarks    { entityType, entityId, kind? } → unsave
 *
 * PUT (not POST) because saving is idempotent by contract: the (org, user, entityType, entityId,
 * kind) unique index plus `onConflictDoNothing` make re-saving a no-op — double-taps and optimistic
 * retries can never create duplicates. `kind` defaults to 'favorite' (the column default) and
 * namespaces flavors when an app has more than one save concept ('pin', 'watchlist', …).
 *
 * Pairs with the client hook (src/lib/query/hooks/useBookmarks.ts) and the drop-in toggle UI
 * (src/components/engagement/bookmark-button.tsx). A minted app wires a new saveable entity by
 * choosing an entityType slug (e.g. 'recipe') and rendering <BookmarkButton> on its cards — no
 * Worker change needed.
 */
export const bookmarkRoutes = new Hono<AuthEnv>()

/** Length caps — these are TEXT columns; unbounded client strings are a database-bloat vector. */
const MAX_ENTITY_TYPE = 255
const MAX_ENTITY_ID = 255
const MAX_KIND = 64

/** Mirrors the schema column default — body/query omitting kind always means this namespace. */
const DEFAULT_KIND = 'favorite'

/**
 * Slug-shaped kinds only ('favorite', 'pin', 'watchlist', per-app vocab) — same rationale as
 * worker/routes/credits.ts: eq() is injection-safe today, but a charset whitelist keeps the value
 * safe against future refactors that might interpolate it, and keeps client query keys clean.
 * Kinds are lowercased BEFORE this test (the column is case-sensitive — without normalization,
 * 'Favorite' and 'favorite' would be two distinct saves), so the pattern needs no /i flag.
 */
const KIND_PATTERN = /^[a-z0-9_-]+$/

type EntityRef = { entityType: string; entityId: string; kind: string }

/**
 * Shared body validation for PUT and DELETE — both take the same { entityType, entityId, kind? }
 * shape, and the unique index spans all three, so save and unsave must resolve `kind` identically
 * (an omitted kind on DELETE must remove the 'favorite' row that an omitted kind on PUT created).
 */
function parseEntityRef(body: {
  entityType?: unknown
  entityId?: unknown
  kind?: unknown
}): { ref: EntityRef } | { error: string } {
  // typeof guards first — the JSON body is untrusted at runtime, and .trim() on a non-string
  // would surface as a 500. Absent/null mean "not provided".
  if (body.entityType !== undefined && body.entityType !== null && typeof body.entityType !== 'string') {
    return { error: 'entityType must be a string' }
  }
  if (body.entityId !== undefined && body.entityId !== null && typeof body.entityId !== 'string') {
    return { error: 'entityId must be a string' }
  }
  if (body.kind !== undefined && body.kind !== null && typeof body.kind !== 'string') {
    return { error: 'kind must be a string' }
  }
  const entityType = typeof body.entityType === 'string' ? body.entityType.trim() : undefined
  const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : undefined
  if (!entityType) return { error: 'entityType is required' }
  if (!entityId) return { error: 'entityId is required' }
  if (entityType.length > MAX_ENTITY_TYPE) return { error: 'entityType too long' }
  if (entityId.length > MAX_ENTITY_ID) return { error: 'entityId too long' }
  // Lowercase so save/unsave/list always resolve the SAME row regardless of caller casing.
  const kind = ((typeof body.kind === 'string' && body.kind.trim()) || DEFAULT_KIND).toLowerCase()
  if (kind.length > MAX_KIND) return { error: 'kind too long' }
  if (!KIND_PATTERN.test(kind)) {
    return { error: `kind must be letters, digits, '_' or '-'` }
  }
  return { ref: { entityType, entityId, kind } }
}

bookmarkRoutes.get('/:orgId/bookmarks', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  // Optional ?kind= narrows to one save namespace; absent = the 'favorite' default, matching the
  // PUT/DELETE resolution above (and the client's query-key normalization in keys.ts) so the three
  // verbs always talk about the same rows.
  const kindParam = c.req.query('kind')?.trim()
  // Same lowercase normalization as parseEntityRef — list must see what save/unsave wrote.
  const kind = (kindParam || DEFAULT_KIND).toLowerCase()
  if (kind.length > MAX_KIND || !KIND_PATTERN.test(kind)) {
    return c.json({ error: `kind must be 1-${MAX_KIND} characters of letters, digits, '_' or '-'` }, 400)
  }

  // Optional ?entityType= narrows to one entity family (e.g. only saved 'recipe' rows).
  const entityTypeParam = c.req.query('entityType')?.trim()
  if (entityTypeParam && entityTypeParam.length > MAX_ENTITY_TYPE) {
    return c.json({ error: 'entityType too long' }, 400)
  }

  const scope = and(
    eq(schema.bookmark.organizationId, orgId),
    eq(schema.bookmark.userId, session.user.id),
    eq(schema.bookmark.kind, kind),
    ...(entityTypeParam ? [eq(schema.bookmark.entityType, entityTypeParam)] : []),
  )

  // Cursor pagination: ?cursor=<ISO createdAt of the last row seen> → rows strictly older.
  // Boundary caveat (same as notifications.ts): lt() skips rows sharing the cursor's EXACT
  // timestamp on the next page. Acceptable for tap-created bookmark rows; a composite
  // (createdAt, id) cursor is the upgrade path if a minted app ever bulk-inserts saves.
  const cursor = c.req.query('cursor')
  const cursorDate = cursor ? new Date(cursor) : null
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.bookmark)
    .where(
      cursorDate && !Number.isNaN(cursorDate.getTime())
        ? and(scope, lt(schema.bookmark.createdAt, cursorDate))
        : scope,
    )
    // id desc as the tiebreaker — keeps the order stable when createdAt collides.
    .orderBy(desc(schema.bookmark.createdAt), desc(schema.bookmark.id))
    .limit(50)
  return c.json(rows)
})

bookmarkRoutes.put('/:orgId/bookmarks', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const body = await c.req.json<Partial<EntityRef>>().catch(() => null)
  if (!body) return c.json({ error: 'a JSON object body is required' }, 400)
  const parsed = parseEntityRef(body)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const { entityType, entityId, kind } = parsed.ref

  // Idempotent: the (org, user, entityType, entityId, kind) unique index plus onConflictDoNothing
  // make a repeat save a no-op — the optimistic client can fire-and-retry safely. entityId is NOT
  // existence-checked against a table (it's polymorphic — the Worker can't know which table it
  // names), so a save is intentionally a soft reference: deleting the entity later just leaves a
  // dangling save the product list resolves (and skips) at render time.
  await getDb(c.env.DATABASE_URL)
    .insert(schema.bookmark)
    .values({
      organizationId: orgId,
      // Owner comes from the SESSION, never the body — golden rule 4.
      userId: session.user.id,
      entityType,
      entityId,
      kind,
    })
    .onConflictDoNothing()
  return c.json({ ok: true })
})

bookmarkRoutes.delete('/:orgId/bookmarks', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const body = await c.req.json<Partial<EntityRef>>().catch(() => null)
  if (!body) return c.json({ error: 'a JSON object body is required' }, 400)
  const parsed = parseEntityRef(body)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const { entityType, entityId, kind } = parsed.ref

  // Scoping on the WRITE too — callers can only remove their own saves. Deleting a row that does
  // not exist is a no-op, so unsave is as idempotent as save.
  await getDb(c.env.DATABASE_URL)
    .delete(schema.bookmark)
    .where(
      and(
        eq(schema.bookmark.organizationId, orgId),
        eq(schema.bookmark.userId, session.user.id),
        eq(schema.bookmark.entityType, entityType),
        eq(schema.bookmark.entityId, entityId),
        eq(schema.bookmark.kind, kind),
      ),
    )
  return c.json({ ok: true })
})
