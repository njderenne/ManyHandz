import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { buildReportDocument, esc, type ReportSection } from '@/lib/pdf/html-report'

/**
 * Org data export — the trust wedge (keepsey/pet-pilot chassis generalization): one-tap full
 * export of everything the org owns, as JSON (the complete document), per-entity CSV
 * (spreadsheet-friendly), and print-ready HTML (the client feeds it to Print.printAsync →
 * "Save as PDF"). NEVER tier-gated — exporting your own data is never charged, never blocked,
 * on every plan, forever (the marketing page promises it; data-ownership law).
 *
 * The chassis doesn't know an app's domain tables, so the export is a REGISTRY: each entity ships
 * a serializer (`entity` name + org-scoped `toRows`), and a minted app pushes its own — the same
 * mutable-registry pattern as onSubjectArchived / reportLoaders:
 *
 *   exportSerializers.push({ entity: 'workouts', toRows: (db, orgId) => …org-fenced select… })
 *
 * Every serializer carries its own organizationId WHERE clause (golden rule 4 — the route's
 * requireOrg authenticates; the fence is here), and joins are fenced on BOTH sides.
 */

export type ExportSerializer = {
  /** Stable entity name — the JSON key, the `?entity=` CSV selector, and the CSV filename stem. */
  entity: string
  /** Org-fenced rows, oldest-first unless the entity says otherwise. Flat records serialize best. */
  toRows: (db: DB, orgId: string) => Promise<Record<string, unknown>[]>
}

/**
 * Chassis defaults. Deliberate inclusions/exclusions:
 *  - organization: identity fields only — Stripe/billing internals are operator data, not the
 *    org's own records.
 *  - members: name/role/joined AND email — DECIDED (MINOR-12): this is a capability-gated export
 *    of the org's own roster, run by its owner/admin; the roster is data the org owns (keepsey
 *    precedent). archivedAt rides along (completeness promise — an importer can filter).
 *  - subjects: rides the SubjectDto privacy rule — `selfUserId` NEVER leaves the server raw, even
 *    to an owner/admin export; `selfLinked` carries the product signal (SUBJECT_SPEC §7).
 *  - media: the INDEX (keys + sizes), not the bytes — the R2 key is the durable name that pairs
 *    this document with a media archive; knowing it grants nothing (bucket not publicly
 *    addressable; GET /api/media/:id stays the only org-fenced door to the bytes).
 *  - activity_log: bounded to the newest 1000 — the audit tail, not an unbounded table scan.
 */
export const exportSerializers: ExportSerializer[] = [
  {
    entity: 'organization',
    toRows: async (db, orgId) => {
      const rows = await db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          kind: schema.organization.kind,
          logo: schema.organization.logo,
          createdAt: schema.organization.createdAt,
        })
        .from(schema.organization)
        .where(eq(schema.organization.id, orgId))
        .limit(1)
      return rows
    },
  },
  {
    entity: 'members',
    toRows: async (db, orgId) => {
      const rows = await db
        .select({
          id: schema.member.id,
          name: schema.member.displayName,
          userName: schema.user.name,
          email: schema.user.email,
          role: schema.member.role,
          joinedAt: schema.member.createdAt,
          archivedAt: schema.member.archivedAt,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(eq(schema.member.organizationId, orgId))
        .orderBy(asc(schema.member.createdAt), asc(schema.member.id))
      // Per-org display name falls back to the account name (the roster convention).
      return rows.map(({ userName, ...row }) => ({ ...row, name: row.name ?? userName }))
    },
  },
  // Subjects ship only when the app runs the module — a feature-off app exports no empty section.
  ...(APP_CONFIG.features.subjects
    ? [
        {
          entity: 'subjects',
          toRows: async (db: DB, orgId: string) => {
            const rows = await db
              .select()
              .from(schema.subject)
              .where(eq(schema.subject.organizationId, orgId))
              .orderBy(asc(schema.subject.createdAt), asc(schema.subject.id))
            // SubjectDto privacy rule: the raw user id never serializes — not even here.
            return rows.map(({ selfUserId, ...rest }) => ({
              ...rest,
              selfLinked: selfUserId != null,
            }))
          },
        } satisfies ExportSerializer,
      ]
    : []),
  {
    entity: 'media',
    toRows: (db, orgId) =>
      db
        .select({
          id: schema.media.id,
          key: schema.media.key,
          name: schema.media.name,
          kind: schema.media.kind,
          mimeType: schema.media.mimeType,
          sizeBytes: schema.media.sizeBytes,
          width: schema.media.width,
          height: schema.media.height,
          alt: schema.media.alt,
          createdAt: schema.media.createdAt,
        })
        .from(schema.media)
        .where(eq(schema.media.organizationId, orgId))
        .orderBy(asc(schema.media.createdAt), asc(schema.media.id)),
  },
  {
    entity: 'activity_log',
    toRows: (db, orgId) =>
      db
        .select({
          id: schema.activityLog.id,
          entityType: schema.activityLog.entityType,
          entityId: schema.activityLog.entityId,
          action: schema.activityLog.action,
          userId: schema.activityLog.userId,
          metadata: schema.activityLog.metadata,
          createdAt: schema.activityLog.createdAt,
        })
        .from(schema.activityLog)
        .where(eq(schema.activityLog.organizationId, orgId))
        .orderBy(desc(schema.activityLog.createdAt), desc(schema.activityLog.id))
        .limit(1000),
  },
]

/** The registered entity names, in export order — the route's `?entity=` vocabulary. */
export function exportEntityNames(): string[] {
  return exportSerializers.map((s) => s.entity)
}

/**
 * RFC 4180 CSV quoting (keepsey donor): wrap the cell when it contains a comma, quote, or line
 * break; double embedded quotes. Everything else passes through literally — an export helper must
 * never alter the user's data. (src/lib/csv/parse.ts is parse-only, so the writer lives here.)
 */
function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Spreadsheet formula-injection (a.k.a. CSV/DDE injection) neutralizer. A string cell beginning
 * with =, +, -, @, TAB, or CR can be evaluated as a live formula when the exported .csv is opened
 * in Excel/Sheets (a user-typed displayName like `=cmd|...` is the classic vector). Prefix a
 * single quote — the well-known neutralizer — so the client renders the literal text, then let
 * escapeCsv() handle RFC-4180 quoting. Plain-text surface ONLY: exportPrintHtml is esc()-escaped
 * and never spreadsheet-interpreted, so it needs no equivalent (HTML vs plain-text distinction).
 */
function neutralizeCsvFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

/** One export cell: Dates → ISO, objects → JSON, null/undefined → '', everything else → String. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  // JSON.stringify output opens with {, [, ", or a digit — never a formula lead — so the object
  // branch needs no neutralizer; only free-form string cells can carry an attacker-chosen lead.
  if (typeof value === 'object') return escapeCsv(JSON.stringify(value))
  // The neutralizer applies to STRINGS ONLY. Numbers/booleans cannot carry a formula payload, and
  // prefixing a negative number (-5 → '-5) would turn every money delta / temperature / balance
  // adjustment in the org's export into text — violating the law above: an export helper must
  // never alter the user's data.
  if (typeof value === 'string') return escapeCsv(neutralizeCsvFormula(value))
  return escapeCsv(String(value))
}

/**
 * Rows → one RFC-4180 CSV document. Columns are the union of every row's keys in first-seen order
 * (registry rows are hand-shaped selects, so row 0 usually carries them all — the union guards
 * sparse app serializers). CRLF line endings — what spreadsheet apps expect on every platform.
 */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  const lines = [columns.map(escapeCsv).join(',')]
  for (const row of rows) {
    lines.push(columns.map((col) => csvCell(row[col])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

export type ExportPayload = {
  /** One self-contained JSON document: { exportedAt, entities: { <entity>: rows } }. */
  json: Record<string, unknown>
  /** entity name → complete CSV document (header + rows). */
  csvByEntity: Record<string, string>
}

/**
 * Run every registered serializer for the org and compose both wire shapes in one pass. One
 * document, no pagination — the whole point is that an owner leaves with EVERYTHING in one tap
 * (keepsey completeness promise). Serializers run in parallel; order in the output follows the
 * registry.
 */
export async function composeExport(db: DB, orgId: string): Promise<ExportPayload> {
  const rowsets = await Promise.all(exportSerializers.map((s) => s.toRows(db, orgId)))
  const entities: Record<string, unknown> = {}
  const csvByEntity: Record<string, string> = {}
  exportSerializers.forEach((s, i) => {
    entities[s.entity] = rowsets[i]
    csvByEntity[s.entity] = rowsToCsv(rowsets[i])
  })
  return {
    json: { exportedAt: new Date().toISOString(), entities },
    csvByEntity,
  }
}

/** Human heading for an entity section ('activity_log' → 'Activity log'). */
function sectionTitle(entity: string): string {
  const words = entity.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Print-friendly HTML document over the composed payload — reuses the proven print recipe in
 * src/lib/pdf/html-report.ts (fixed repeating footer, @page margins, page-break-inside: avoid),
 * so the client can hand it straight to Print.printAsync / printToFileAsync for a PDF. Every cell
 * is esc()-escaped here — the payload is user data, never trusted markup.
 */
export function exportPrintHtml(payload: ExportPayload): string {
  const entities = (payload.json.entities ?? {}) as Record<string, Record<string, unknown>[]>
  const exportedAt = String(payload.json.exportedAt ?? new Date().toISOString())
  const sections: ReportSection[] = Object.entries(entities).map(([entity, rows]) => {
    const columns: string[] = []
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!columns.includes(key)) columns.push(key)
      }
    }
    return {
      title: sectionTitle(entity),
      headers: columns,
      rows: rows.map((row) =>
        columns.map((col) => {
          const v = row[col]
          if (v === null || v === undefined) return ''
          if (v instanceof Date) return esc(v.toISOString())
          if (typeof v === 'object') return esc(JSON.stringify(v))
          return esc(String(v))
        }),
      ),
    }
  })
  return buildReportDocument({
    title: `${APP_CONFIG.name} data export`,
    subtitle: `Exported ${exportedAt}`,
    sections,
    footerLeft: `${APP_CONFIG.name} export`,
    footerRight: esc(exportedAt),
  })
}
