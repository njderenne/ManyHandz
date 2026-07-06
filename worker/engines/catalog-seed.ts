import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'

/**
 * Catalog seeder — idempotent, VERSION-WATERMARKED upserts of GLOBAL catalog rows (grindline's
 * seed mechanism, generalized onto the chassis `catalog_item` table). Global rows have
 * organizationId NULL and a STABLE, human-readable id the app authors by hand
 * ('basketball.shooting.form-shots') — the id IS the idempotence key across runs and deploys.
 *
 * The contract, in order of importance:
 *
 *   - IDEMPOTENT: running the same items + version twice returns { inserted: 0, updated: 0 }
 *     the second time. Safe from a route guard, a one-off script, or a deploy hook.
 *   - VERSIONED: a row is only rewritten when the incoming `version` is NEWER than the row's
 *     watermark — so editing seed content means bumping the version, and a stale Worker
 *     re-running an old seed can never clobber newer content.
 *   - NEVER TOUCHES ORG ROWS: updates are fenced `organization_id IS NULL`; an org custom row
 *     that somehow collides with a seed id is skipped loudly, never rewritten. User content
 *     outranks seed content, always.
 *
 * This is one of the two sanctioned I/O shells in worker/engines/ (README.md): planSeed() is
 * the pure, tested core; seedCatalog() only reads existing watermarks and writes the plan.
 * NOT a cron job — seeding runs on demand (grindline ran it as a node script; the chassis
 * default is a guarded dev route or a mint-time script).
 *
 * Apps with richer catalog needs (grindline's own sport/category/drill triple) keep their own
 * tables and reuse this MECHANISM — the plan/watermark/org-fence shape — not this table.
 */

/** One seed row. `id` is the stable human id (write-once); `parentId` builds in-table hierarchy. */
export type SeedItem = {
  id: string
  /** App vocab: 'drill' | 'exercise' | 'recipe' … (catalog_item.kind, TEXT). */
  kind: string
  /** Optional hierarchy — the id of another catalog item (typically a category row). */
  parentId?: string
  name: string
  /** App-shaped payload (instructions, difficulty, media keys…). */
  data?: Record<string, unknown>
}

export type SeedResult = { inserted: number; updated: number; skipped: number }

/** What planSeed needs to know about a row already in the table. */
export type ExistingSeedRow = {
  id: string
  version: number
  organizationId: string | null
}

export type SeedPlan = {
  toInsert: SeedItem[]
  toUpdate: SeedItem[]
  /** Rows already at (or past) this version, plus org-row id collisions — untouched. */
  skipped: number
}

/** Stable ids are slugs, not free text — they live forever in rows and app deep links. */
const ID_MAX_LENGTH = 128
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i
const NAME_MAX_LENGTH = 200

/**
 * Validate the seed set — throws on programmer error (a seed file is code; a malformed entry
 * should fail the run loudly, not half-seed). Duplicate ids are the classic copy-paste bug.
 */
function assertValidItems(items: SeedItem[], version: number): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`seedCatalog: version must be a positive integer (got ${version})`)
  }
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.id || item.id.length > ID_MAX_LENGTH || !ID_PATTERN.test(item.id)) {
      throw new Error(`seedCatalog: invalid seed id ${JSON.stringify(item.id)}`)
    }
    if (seen.has(item.id)) throw new Error(`seedCatalog: duplicate seed id '${item.id}'`)
    seen.add(item.id)
    if (!item.kind?.trim()) throw new Error(`seedCatalog: '${item.id}' has an empty kind`)
    if (!item.name?.trim() || item.name.length > NAME_MAX_LENGTH) {
      throw new Error(`seedCatalog: '${item.id}' has an invalid name`)
    }
    if (item.parentId !== undefined && !seen.has(item.parentId)) {
      // Parents must precede children IN THE SEED ARRAY — guarantees a fresh DB can insert in
      // order and a dangling parentId is caught at author time, not at render time.
      throw new Error(
        `seedCatalog: '${item.id}' references parentId '${item.parentId}' which does not precede it`,
      )
    }
  }
}

/**
 * The PURE planning core: classify every item against the existing rows. Tested directly
 * (catalog-seed.test.ts) — seedCatalog() just executes the plan.
 */
export function planSeed(
  existing: ExistingSeedRow[],
  items: SeedItem[],
  version: number,
): SeedPlan {
  assertValidItems(items, version)
  const byId = new Map(existing.map((row) => [row.id, row]))

  const plan: SeedPlan = { toInsert: [], toUpdate: [], skipped: 0 }
  for (const item of items) {
    const row = byId.get(item.id)
    if (!row) {
      plan.toInsert.push(item)
    } else if (row.organizationId !== null) {
      // An ORG row wearing a seed id — never touch user content (header contract). Loud log:
      // this means an app minted custom rows with seed-shaped ids, which is worth fixing.
      plan.skipped++
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'catalog_seed.org_row_collision',
          id: item.id,
          organizationId: row.organizationId,
        }),
      )
    } else if (row.version < version) {
      plan.toUpdate.push(item)
    } else {
      plan.skipped++ // already at or past this version — the idempotence path
    }
  }
  return plan
}

/** inArray() has practical parameter limits — read existing watermarks in slices. */
const SELECT_CHUNK = 200

/**
 * Seed the global catalog: read watermarks → planSeed → execute. Returns counts for the
 * caller's log line. Concurrency-safe: inserts are ON CONFLICT DO NOTHING (a racing run's
 * insert wins, ours counts nothing) and updates re-check the version fence IN SQL, so two
 * concurrent runs of the same seed converge on the same rows.
 */
export async function seedCatalog(
  db: DB,
  items: SeedItem[],
  version: number,
): Promise<SeedResult> {
  // Read the existing watermarks for exactly the ids we're seeding. GLOBAL rows only would be
  // wrong here — we need to SEE org-row collisions to skip them, so no org fence on the read.
  const existing: ExistingSeedRow[] = []
  for (let i = 0; i < items.length; i += SELECT_CHUNK) {
    const ids = items.slice(i, i + SELECT_CHUNK).map((item) => item.id)
    const rows = await db
      .select({
        id: schema.catalogItem.id,
        version: schema.catalogItem.version,
        organizationId: schema.catalogItem.organizationId,
      })
      .from(schema.catalogItem)
      .where(inArray(schema.catalogItem.id, ids))
    existing.push(...rows)
  }

  const plan = planSeed(existing, items, version)
  const result: SeedResult = { inserted: 0, updated: 0, skipped: plan.skipped }

  if (plan.toInsert.length > 0) {
    const inserted = await db
      .insert(schema.catalogItem)
      .values(
        plan.toInsert.map((item) => ({
          id: item.id,
          organizationId: null, // global seeded row — readable by every org
          kind: item.kind,
          parentId: item.parentId ?? null,
          name: item.name,
          data: item.data ?? null,
          version,
        })),
      )
      // A racing run may have inserted the same stable id between our read and this write —
      // their row is our row; count only what WE landed.
      .onConflictDoNothing()
      .returning({ id: schema.catalogItem.id })
    result.inserted = inserted.length
  }

  for (const item of plan.toUpdate) {
    const updated = await db
      .update(schema.catalogItem)
      .set({
        kind: item.kind,
        parentId: item.parentId ?? null,
        name: item.name,
        data: item.data ?? null,
        version,
        updatedAt: new Date(), // $onUpdate fires on .update(), but explicit beats implicit here
      })
      .where(
        and(
          eq(schema.catalogItem.id, item.id),
          // The org fence AND the version fence re-checked in SQL — the plan can be stale
          // under concurrency; the WHERE cannot.
          isNull(schema.catalogItem.organizationId),
          lt(schema.catalogItem.version, version),
        ),
      )
      .returning({ id: schema.catalogItem.id })
    if (updated.length > 0) result.updated++
    else result.skipped++
  }

  console.log(
    JSON.stringify({ level: 'info', event: 'catalog_seed.completed', version, ...result }),
  )
  return result
}
