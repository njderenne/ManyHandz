import { Hono } from 'hono'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { requireOrg, requireCapability, audit, type AuthEnv } from '../middleware/org'

/**
 * Catalog — the org-scoped surface over `catalog_item`: GLOBAL seeded reference rows
 * (organizationId NULL, written only by worker/engines/catalog-seed.ts) plus the org's own
 * custom rows, served as ONE list (grindline's drills shape, generalized).
 *
 * ── SANCTIONED GOLDEN-RULE-4 EXCEPTION ──────────────────────────────────────────────────────
 * The list read's tenant fence is `organization_id = $activeOrg OR organization_id IS NULL` —
 * NOT the plain equality every other route uses. This is BY DESIGN and drift-reviewed as such:
 * NULL-org rows are the seeded global catalog, readable by every tenant (they contain no tenant
 * data by construction — the seeder only writes app-authored content). The union never widens
 * to another org's rows, and every WRITE below fences on strict equality, so global rows are
 * immutable via this API. Do not "fix" this WHERE clause.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   GET   /:orgId/catalog?kind=&includeArchived=  → global ∪ org rows, name order
 *   POST  /:orgId/catalog                         → create an org custom row
 *   PATCH /:orgId/catalog/:id                     → edit an org custom row
 *   POST  /:orgId/catalog/:id/archive             → soft-remove an org custom row
 *
 * Reads are plain requireOrg (browsing the library is every member's job); writes gate with
 * requireCapability('content:write') — the B-1 law: no role literals in chassis routes.
 *
 * Mounted by worker/index.ts ONLY when APP_CONFIG.features.catalog (stage-0 wiring); the
 * internal guard below is defense-in-depth so a stray mount can never expose the surface.
 */
export const catalogRoutes = new Hono<AuthEnv>()

/** Feature-off ⇒ 404 (not 403): the surface should not exist, and its absence isn't an oracle. */
catalogRoutes.use('*', async (c, next) => {
  if (!APP_CONFIG.features.catalog) return c.json({ error: 'not found' }, 404)
  return next()
})

/** Big enough for a real reference library in one read; an app outgrowing it paginates. */
const LIST_LIMIT = 500

const KIND_MAX_LENGTH = 64
const KIND_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i
const NAME_MAX_LENGTH = 200
/** `data` is client-authored jsonb — cap the serialized size like any user payload. */
const MAX_DATA_JSON_CHARS = 8 * 1024

/** id-shaped params land in eq() — cap + charset-guard them like any client input. Seed ids
 *  are dot-namespaced slugs and org ids are UUIDs; one pattern covers both. */
const ID_MAX_LENGTH = 128
const ID_PATTERN = /^[a-zA-Z0-9._-]+$/

function parseId(raw: unknown): string | null | 'invalid' {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return 'invalid'
  const id = raw.trim()
  if (!id) return null
  if (id.length > ID_MAX_LENGTH || !ID_PATTERN.test(id)) return 'invalid'
  return id
}

function parseKind(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const kind = raw.trim()
  if (!kind || kind.length > KIND_MAX_LENGTH || !KIND_PATTERN.test(kind)) return null
  return kind
}

/** Plain-object check — catalog `data` must be an object, never an array or primitive. */
function parseData(raw: unknown): Record<string, unknown> | null | 'invalid' {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid'
  if (JSON.stringify(raw).length > MAX_DATA_JSON_CHARS) return 'invalid'
  return raw as Record<string, unknown>
}

/** The visible-set fence: global rows ∪ THIS org's rows (the sanctioned exception, header). */
function visibleTo(orgId: string) {
  return or(isNull(schema.catalogItem.organizationId), eq(schema.catalogItem.organizationId, orgId))
}

/**
 * GET /:orgId/catalog?kind=&includeArchived= — the browsable library. Active rows by default
 * (archived customs stay queryable for history screens via includeArchived=true; global rows
 * are never archived — the seeder doesn't write archivedAt).
 */
catalogRoutes.get('/:orgId/catalog', requireOrg, async (c) => {
  const orgId = c.get('orgId')

  const kindRaw = c.req.query('kind')
  const kind = kindRaw === undefined ? null : parseKind(kindRaw)
  if (kindRaw !== undefined && kind === null) return c.json({ error: 'invalid kind' }, 400)

  const includeArchived = ['true', '1'].includes((c.req.query('includeArchived') ?? '').toLowerCase())

  const conditions = [visibleTo(orgId)]
  if (kind) conditions.push(eq(schema.catalogItem.kind, kind))
  if (!includeArchived) conditions.push(isNull(schema.catalogItem.archivedAt))

  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.catalogItem)
    .where(and(...conditions))
    // Name order mixes seeded + custom naturally (grindline's browse order); id as the stable
    // tiebreaker so pagination-by-eye doesn't shuffle between fetches.
    .orderBy(asc(schema.catalogItem.name), asc(schema.catalogItem.id))
    .limit(LIST_LIMIT)
  return c.json(rows)
})

/**
 * POST /:orgId/catalog — { kind, name, parentId?, data? } → an ORG custom row. The row id is
 * server-minted (customs get UUIDs; stable human ids belong to the seeder). parentId may point
 * at a global OR own-org row — a custom drill under a seeded category is the whole point.
 */
catalogRoutes.post(
  '/:orgId/catalog',
  requireOrg,
  requireCapability('content:write'),
  async (c) => {
    const orgId = c.get('orgId')
    const db = getDb(c.env.DATABASE_URL)
    const body = await c.req.json<Record<string, unknown>>().catch(() => null)
    if (!body) return c.json({ error: 'invalid body' }, 400)

    const kind = parseKind(body.kind)
    if (!kind) return c.json({ error: 'invalid kind' }, 400)

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > NAME_MAX_LENGTH) return c.json({ error: 'invalid name' }, 400)

    const data = parseData(body.data)
    if (data === 'invalid') return c.json({ error: 'data must be a small JSON object' }, 400)

    const parentId = parseId(body.parentId)
    if (parentId === 'invalid') return c.json({ error: 'invalid parentId' }, 400)
    if (parentId !== null) {
      // The parent must be VISIBLE to this org (global or own row) and live — a dangling or
      // cross-org parent would leak structure across tenants.
      const [parent] = await db
        .select({ id: schema.catalogItem.id })
        .from(schema.catalogItem)
        .where(
          and(
            eq(schema.catalogItem.id, parentId),
            visibleTo(orgId),
            isNull(schema.catalogItem.archivedAt),
          ),
        )
        .limit(1)
      if (!parent) return c.json({ error: 'parent not found' }, 404)
    }

    const [created] = await db
      .insert(schema.catalogItem)
      .values({ organizationId: orgId, kind, parentId, name, data })
      .returning()

    await audit(c, {
      entityType: 'catalogItem',
      entityId: created.id,
      action: 'catalog.item_created',
      metadata: { kind, name },
    })
    return c.json(created, 201)
  },
)

/**
 * PATCH /:orgId/catalog/:id — { name?, parentId?, data? } — ORG rows only. Global rows are
 * immutable via the API by construction: the strict-equality org fence simply never matches
 * them, so a PATCH against a seeded id 404s (not 403 — their editability isn't an oracle).
 * kind is immutable after create (rows are referenced by kind-filtered screens).
 */
catalogRoutes.patch(
  '/:orgId/catalog/:id',
  requireOrg,
  requireCapability('content:write'),
  async (c) => {
    const orgId = c.get('orgId')
    const id = c.req.param('id')
    const db = getDb(c.env.DATABASE_URL)
    const body = await c.req.json<Record<string, unknown>>().catch(() => null)
    if (!body) return c.json({ error: 'invalid body' }, 400)

    const patch: { name?: string; parentId?: string | null; data?: Record<string, unknown> | null } = {}

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > NAME_MAX_LENGTH) return c.json({ error: 'invalid name' }, 400)
      patch.name = name
    }
    if (body.data !== undefined) {
      const data = parseData(body.data)
      if (data === 'invalid') return c.json({ error: 'data must be a small JSON object' }, 400)
      patch.data = data
    }
    if (body.parentId !== undefined) {
      const parentId = parseId(body.parentId)
      if (parentId === 'invalid') return c.json({ error: 'invalid parentId' }, 400)
      if (parentId !== null) {
        if (parentId === id) return c.json({ error: 'an item cannot be its own parent' }, 400)
        const [parent] = await db
          .select({ id: schema.catalogItem.id })
          .from(schema.catalogItem)
          .where(
            and(
              eq(schema.catalogItem.id, parentId),
              visibleTo(orgId),
              isNull(schema.catalogItem.archivedAt),
            ),
          )
          .limit(1)
        if (!parent) return c.json({ error: 'parent not found' }, 404)
      }
      patch.parentId = parentId
    }

    if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400)

    const [updated] = await db
      .update(schema.catalogItem)
      .set(patch)
      // Strict equality — NOT visibleTo(): writes never touch global rows (header exception
      // applies to the read union only).
      .where(and(eq(schema.catalogItem.organizationId, orgId), eq(schema.catalogItem.id, id)))
      .returning()
    if (!updated) return c.json({ error: 'not found' }, 404)

    await audit(c, { entityType: 'catalogItem', entityId: id, action: 'catalog.item_updated' })
    return c.json(updated)
  },
)

/**
 * POST /:orgId/catalog/:id/archive — soft-remove an ORG custom row (drops from active lists;
 * history keeps resolving the id). Global rows can't be archived via the API — an org that
 * wants to hide seeded content does it app-side (a prefs/exclusion list), not by mutating the
 * shared catalog. Idempotent: archiving an archived row re-stamps and returns 200.
 */
catalogRoutes.post(
  '/:orgId/catalog/:id/archive',
  requireOrg,
  requireCapability('content:write'),
  async (c) => {
    const orgId = c.get('orgId')
    const id = c.req.param('id')
    const db = getDb(c.env.DATABASE_URL)

    const [archived] = await db
      .update(schema.catalogItem)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.catalogItem.organizationId, orgId), eq(schema.catalogItem.id, id)))
      .returning()
    if (!archived) return c.json({ error: 'not found' }, 404)

    await audit(c, { entityType: 'catalogItem', entityId: id, action: 'catalog.item_archived' })
    return c.json(archived)
  },
)
