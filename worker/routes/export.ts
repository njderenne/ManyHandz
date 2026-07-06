import { Hono } from 'hono'
import { getDb } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { requireOrg, requireCapability, audit, type AuthEnv } from '../middleware/org'
import {
  composeExport,
  exportEntityNames,
  exportPrintHtml,
  exportSerializers,
  rowsToCsv,
} from '../lib/export'

/**
 * Export — the org's one-tap data export (worker/lib/export.ts registry). NEVER tier-gated: the
 * marketing page promises free full export forever (data-ownership law) — do not add requireTier/
 * requireFeature here, on any plan, ever. It IS capability-gated (`org:export`, default matrix:
 * owner/admin) because the payload includes the member roster with emails, and rate-limited to
 * 5 req / 5 min at the mount (stage-0 §3.3 — full-org serialization is the most expensive read
 * in the chassis).
 *
 *   GET /:orgId/export                        → the complete JSON document (download headers)
 *   GET /:orgId/export?format=csv             → { entities: [...] } — the CSV iteration manifest
 *   GET /:orgId/export?format=csv&entity=_all → the WHOLE csvByEntity map as JSON — the ONE-request
 *                                               bundle the client splits into files
 *   GET /:orgId/export?format=csv&entity=X    → ONE entity as CSV (download headers)
 *   GET /:orgId/export?format=html            → print-ready HTML (client → Print.printAsync → PDF)
 *
 * CSV is deliberately a JSON bundle split client-side (src/lib/query/hooks/useExport.ts) instead
 * of a zip: the chassis stays dependency-free, and each file lands spreadsheet-ready. The
 * manifest + per-entity routes remain for older clients (version skew: a deployed store build can
 * be older than this worker) — new clients MUST use `_all`, because the mount's 5 req / 5 min cap
 * makes a request-per-entity loop 429 as soon as an app registers serializers past the defaults.
 */
export const exportRoutes = new Hono<AuthEnv>()

/** Feature-off ⇒ 404 (features.export ships ON in the template; an app may still turn it off). */
exportRoutes.use('*', async (c, next) => {
  if (!APP_CONFIG.features.export) return c.json({ error: 'not found' }, 404)
  return next()
})

/** Filename stem: the app name, slugified ("Pet Pilot" → pet-pilot-export.json). */
function filenameStem(): string {
  return `${APP_CONFIG.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-export`
}

exportRoutes.get('/:orgId/export', requireOrg, requireCapability('org:export'), async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)
  const format = c.req.query('format') ?? 'json'

  if (format === 'csv') {
    const entity = c.req.query('entity')
    if (!entity) {
      // The iteration manifest: which per-entity CSVs exist. The client fetches each in turn.
      return c.json({ entities: exportEntityNames() })
    }
    if (entity === '_all') {
      // The one-request bundle (useExport.ts primary path): every entity's CSV in ONE JSON map,
      // split into files client-side. This exists because the mount is capped at 5 req / 5 min —
      // the legacy request-per-entity loop 429s the moment an app registers a sixth serializer.
      // composeExport runs the registry exactly once. `_all` is reserved: the leading underscore
      // keeps it out of the space of real entity names (registry names are plain identifiers).
      const payload = await composeExport(db, orgId)
      await audit(c, {
        entityType: 'export',
        action: 'export.csv',
        metadata: { entity: '_all', entities: Object.keys(payload.csvByEntity) },
      })
      // JSON envelope, not a CSV body — no Content-Disposition; the client names each file.
      return c.json(payload.csvByEntity, 200, { 'Cache-Control': 'no-store' })
    }
    // ONE serializer, not composeExport: legacy clients issue one request PER entity
    // (useExport.ts version-skew fallback), so composing the full registry here would turn an
    // N-entity export into N² serializer runs of the most expensive read in the chassis.
    const serializer = exportSerializers.find((s) => s.entity === entity)
    if (!serializer) {
      return c.json({ error: 'unknown entity', entities: exportEntityNames() }, 400)
    }
    const csv = rowsToCsv(await serializer.toRows(db, orgId))
    await audit(c, { entityType: 'export', action: 'export.csv', metadata: { entity } })
    // CRLF + nosniff per the keepsey CSV recipe; no-store — this is the org's whole archive.
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameStem()}-${entity}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
  }

  if (format === 'html') {
    const payload = await composeExport(db, orgId)
    await audit(c, { entityType: 'export', action: 'export.html' })
    // Served for the in-app print flow (fetched with the session, fed to Print.printAsync) — the
    // document is built from esc()-escaped cells (worker/lib/export.ts), never raw user markup.
    return c.html(exportPrintHtml(payload), 200, { 'Cache-Control': 'no-store' })
  }

  if (format !== 'json') {
    return c.json({ error: "format must be 'json', 'csv', or 'html'" }, 400)
  }

  const payload = await composeExport(db, orgId)
  const entities = payload.json.entities as Record<string, unknown[]>
  await audit(c, {
    entityType: 'export',
    action: 'export.json',
    metadata: Object.fromEntries(
      Object.entries(entities).map(([name, rows]) => [name, rows.length]),
    ),
  })
  return c.json(payload.json, 200, {
    'Content-Disposition': `attachment; filename="${filenameStem()}.json"`,
    'Cache-Control': 'no-store',
  })
})
