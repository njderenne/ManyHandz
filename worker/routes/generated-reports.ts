import { Hono } from 'hono'
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm'
import { getDb, schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { requireOrg, requireCapability, audit, type AuthEnv } from '../middleware/org'
import { computeRangeMetrics, type RangeMetricsInput } from '../engines/range-metrics'

/**
 * Generated reports — the org-scoped surface over the range-metrics engine (RxMndr's
 * doctor-report contract, generalized). NAMED `generated-reports` BECAUSE `/reports` IS TAKEN:
 * moderation owns `/api/organizations/:orgId/reports` — never rename either side (STAGE0 §0).
 *
 *   POST  /:orgId/generated-reports              → run a loader + engine, store the snapshot
 *   GET   /:orgId/generated-reports?subjectId=   → list, newest first
 *   GET   /:orgId/generated-reports/:id          → one report
 *   PATCH /:orgId/generated-reports/:id/summary  → edit/clear the prose (≤ 8 KB)
 *
 * The split that makes this shippable without an AI dependency (RxMndr's lesson): `data` is the
 * DETERMINISTIC engine output, stored at generate time; `summary` is prose (AI pass or human),
 * null on generate and editable after — the deterministic half never blocks on a model call.
 *
 * Writes gate with requireCapability('content:write') — the B-1 law: no role literals in
 * chassis routes (the default matrix grants content:write to owner/admin, byte-identical to the
 * old requireRole('owner','admin'), but kinds with custom vocabularies keep working). Reads are
 * plain requireOrg: any live member may view their org's reports.
 *
 * Mounted by worker/index.ts ONLY when APP_CONFIG.features.reports (stage-0 wiring); the
 * internal guard below is defense-in-depth so a stray mount can never expose the surface.
 */
export const generatedReportRoutes = new Hono<AuthEnv>()

/** Feature-off ⇒ 404 (not 403): the surface should not exist, and its absence isn't an oracle. */
generatedReportRoutes.use('*', async (c, next) => {
  if (!APP_CONFIG.features.reports) return c.json({ error: 'not found' }, 404)
  return next()
})

// ---------------------------------------------------------------------------
// Loader registry — how an app teaches the chassis to load its rows
// ---------------------------------------------------------------------------

export type ReportRange = { start: Date; end: Date }

/**
 * A report loader: fetch + org-scope the rows one report kind needs and shape them into the
 * engine's input. The LOADER owns rule 4 (org-scope every query) and any subject fencing; the
 * engine only does math. Loaders are the "thin loaders live with their caller" rule from
 * worker/engines/README.md — they do I/O, so they live here, not in engines/.
 */
export type ReportLoader = (
  db: DB,
  orgId: string,
  subjectId: string | null,
  range: ReportRange,
) => Promise<RangeMetricsInput>

/**
 * kind → loader. A MUTABLE-PROPERTY registry (the same pattern law as escalation's
 * smsRecipientResolver, M-6): apps register at module load in their own files —
 *
 *   import { reportLoaders } from '../routes/generated-reports'   // or the app's route barrel
 *   reportLoaders['workout-summary'] = async (db, orgId, subjectId, range) => ({ ... })
 *
 * — because ESM importers cannot write another module's live `let` binding, but they CAN set a
 * property on an exported object. The registered kinds ARE the API's kind vocabulary: an
 * unregistered kind 400s at POST.
 */
export const reportLoaders: Record<string, ReportLoader> = {}

/** Loader reads are bounded — a report is a summary, not an export (features.export owns bulk). */
const LOADER_ROW_LIMIT = 5000

/**
 * The template's demo loader: activity volume over `activity_log` (every app has audit rows
 * from day one, so the module demos end to end before any domain table exists). One series,
 * count-only rows, kind = the audit action. subjectId is accepted-and-ignored — activity_log
 * has no subject column; a real app's loaders fence by subject where their domain rows do.
 */
reportLoaders['activity'] = async (db, orgId, _subjectId, range) => {
  const rows = await db
    .select({ at: schema.activityLog.createdAt, action: schema.activityLog.action })
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.organizationId, orgId),
        gte(schema.activityLog.createdAt, range.start),
        lte(schema.activityLog.createdAt, range.end),
      ),
    )
    .orderBy(asc(schema.activityLog.createdAt))
    .limit(LOADER_ROW_LIMIT)

  return {
    rangeStart: range.start,
    rangeEnd: range.end,
    series: [
      {
        key: 'activity',
        label: 'Activity',
        rows: rows.map((r) => ({ at: r.at, value: null, kind: r.action })),
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Summary cap — 8 KB of prose is a report note, not a novel (RxMndr's cap, tightened to spec). */
const MAX_SUMMARY_CHARS = 8 * 1024

/** Longest allowed range — a "report" spanning years is an export wearing a costume. */
const MAX_RANGE_DAYS = 366

const KIND_MAX_LENGTH = 64
const KIND_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

/** Accept ISO datetimes or YYYY-MM-DD (parsed as UTC midnight) — the columns are timestamptz. */
function parseWhen(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseId(raw: unknown): string | null | 'invalid' {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return 'invalid'
  const id = raw.trim()
  if (!id) return null
  if (id.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(id)) return 'invalid'
  return id
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /:orgId/generated-reports — { kind, subjectId?, rangeStart, rangeEnd }. Runs the app's
 * registered loader, reduces through computeRangeMetrics (deterministic: re-generating the same
 * inputs over unchanged rows yields an identical `data`), inserts with summary null.
 */
generatedReportRoutes.post(
  '/:orgId/generated-reports',
  requireOrg,
  requireCapability('content:write'),
  async (c) => {
    const orgId = c.get('orgId')
    const db = getDb(c.env.DATABASE_URL)
    const body = await c.req.json<Record<string, unknown>>().catch(() => null)
    if (!body) return c.json({ error: 'invalid body' }, 400)

    const kind = typeof body.kind === 'string' ? body.kind.trim() : ''
    if (!kind || kind.length > KIND_MAX_LENGTH || !KIND_PATTERN.test(kind)) {
      return c.json({ error: 'invalid kind' }, 400)
    }
    const loader = reportLoaders[kind]
    if (!loader) return c.json({ error: `unknown report kind: ${kind}` }, 400)

    const rangeStart = parseWhen(body.rangeStart)
    const rangeEnd = parseWhen(body.rangeEnd)
    if (!rangeStart || !rangeEnd) {
      return c.json({ error: 'rangeStart and rangeEnd must be ISO dates' }, 400)
    }
    if (rangeStart.getTime() > rangeEnd.getTime()) {
      return c.json({ error: 'rangeStart must be on or before rangeEnd' }, 400)
    }
    if (rangeEnd.getTime() - rangeStart.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      return c.json({ error: `range too long (max ${MAX_RANGE_DAYS} days)` }, 400)
    }

    // Optional subject pin — must be a live org-scoped subject (never a client-trusted id).
    const subjectId = parseId(body.subjectId)
    if (subjectId === 'invalid') return c.json({ error: 'invalid subjectId' }, 400)
    if (subjectId !== null) {
      const [subject] = await db
        .select({ id: schema.subject.id })
        .from(schema.subject)
        .where(
          and(
            eq(schema.subject.organizationId, orgId),
            eq(schema.subject.id, subjectId),
            isNull(schema.subject.archivedAt),
          ),
        )
        .limit(1)
      if (!subject) return c.json({ error: 'subject not found' }, 404)
    }

    const input = await loader(db, orgId, subjectId, { start: rangeStart, end: rangeEnd })
    const data = computeRangeMetrics(input)

    const [created] = await db
      .insert(schema.generatedReport)
      .values({
        organizationId: orgId,
        subjectId,
        kind,
        rangeStart,
        rangeEnd,
        data,
        summary: null, // prose comes later (AI pass or PATCH) — never blocks generation
        createdByMemberId: c.get('orgMemberId'),
      })
      .returning()

    await audit(c, {
      entityType: 'generatedReport',
      entityId: created.id,
      action: 'generated_report.created',
      metadata: { kind, subjectId, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString() },
    })
    return c.json(created, 201)
  },
)

/** Bounded list read — reports are a review surface; deep history can paginate later. */
const LIST_LIMIT = 100

generatedReportRoutes.get('/:orgId/generated-reports', requireOrg, async (c) => {
  const orgId = c.get('orgId')

  const subjectId = parseId(c.req.query('subjectId'))
  if (subjectId === 'invalid') return c.json({ error: 'invalid subjectId' }, 400)

  const conditions = [eq(schema.generatedReport.organizationId, orgId)]
  if (subjectId !== null) conditions.push(eq(schema.generatedReport.subjectId, subjectId))

  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.generatedReport)
    .where(and(...conditions))
    .orderBy(desc(schema.generatedReport.createdAt))
    .limit(LIST_LIMIT)
  return c.json(rows)
})

generatedReportRoutes.get('/:orgId/generated-reports/:id', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  const [row] = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.generatedReport)
    .where(and(eq(schema.generatedReport.organizationId, orgId), eq(schema.generatedReport.id, id)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})

/**
 * PATCH /:orgId/generated-reports/:id/summary — { summary: string | null }. Set, edit, or
 * clear the prose before sharing/printing (RxMndr reports.ts:288 rule: null and '' both clear;
 * non-empty is trimmed and capped). The engine `data` is immutable — only prose is editable.
 */
generatedReportRoutes.patch(
  '/:orgId/generated-reports/:id/summary',
  requireOrg,
  requireCapability('content:write'),
  async (c) => {
    const orgId = c.get('orgId')
    const id = c.req.param('id')
    const db = getDb(c.env.DATABASE_URL)
    const body = await c.req.json<Record<string, unknown>>().catch(() => null)
    if (!body || !('summary' in body)) return c.json({ error: 'summary is required' }, 400)

    let summary: string | null
    if (body.summary === null) {
      summary = null
    } else if (typeof body.summary === 'string') {
      const t = body.summary.trim()
      if (t.length > MAX_SUMMARY_CHARS) {
        return c.json({ error: `summary too long (max ${MAX_SUMMARY_CHARS} characters)` }, 400)
      }
      summary = t.length > 0 ? t : null
    } else {
      return c.json({ error: 'summary must be a string or null' }, 400)
    }

    const [updated] = await db
      .update(schema.generatedReport)
      .set({ summary })
      .where(
        and(eq(schema.generatedReport.organizationId, orgId), eq(schema.generatedReport.id, id)),
      )
      .returning()
    if (!updated) return c.json({ error: 'not found' }, 404)

    await audit(c, {
      entityType: 'generatedReport',
      entityId: id,
      action: 'generated_report.summary_edited',
    })
    return c.json(updated)
  },
)
