import { useCallback, useState } from 'react'
import { Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { apiFetch, ApiError } from '@/lib/api/client'
import { exportHtmlToPdf } from '@/lib/pdf/export'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * useExportData — the client half of the org data export (worker/routes/export.ts): fetch the
 * org's export in the chosen shape and hand it to the platform's "get it off this device" flow.
 *
 *   exportJson()   one JSON document → web: browser download · native: share sheet (expo-sharing)
 *   exportCsv()    per-entity CSV files from ONE request — `format=csv&entity=_all` returns the
 *                  whole csvByEntity map as JSON and the client splits it into files (the worker
 *                  is deliberately zip-free). One request matters: the export mount is
 *                  rate-limited to 5 req/300s, so a request-per-entity flow 429s the moment an
 *                  app registers serializers past the chassis defaults. A worker that predates
 *                  the bundle mode 400s on `_all` — we fall back to the legacy per-entity loop
 *                  (version skew: a store build can be newer than the deployed worker)
 *   exportPrint()  print-ready HTML → the existing exportHtmlToPdf recipe (web: print dialog →
 *                  "Save as PDF" · native: PDF file → share sheet)
 *
 * All three throw on failure — the calling screen owns the toast (account.tsx idiom). The hook
 * exposes which format is in flight so buttons can show their own spinner. Export is free on
 * every plan (server law) — nothing here checks tiers.
 */

/** The in-flight format, or null when idle. */
export type ExportingFormat = 'json' | 'csv' | 'print' | null

/** Slugified filename stem, mirroring the worker's Content-Disposition naming. */
function filenameStem(): string {
  return `${APP_CONFIG.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-export`
}

/** Web: Blob + anchor download. Native: cache file + share sheet (a file the user can't reach in
 *  the app sandbox is not an export). */
async function deliverFile(filename: string, content: string, mimeType: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return
  }
  const file = new File(Paths.cache, filename)
  file.write(content) // creates or replaces — re-exports must not append
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename })
  }
}

export function useExportData(orgId: string) {
  const [exporting, setExporting] = useState<ExportingFormat>(null)

  /** The complete JSON document, one tap. */
  const exportJson = useCallback(async () => {
    setExporting('json')
    try {
      const payload = await apiFetch<Record<string, unknown>>(
        `/api/organizations/${orgId}/export`,
      )
      await deliverFile(
        `${filenameStem()}.json`,
        JSON.stringify(payload, null, 2),
        'application/json',
      )
    } finally {
      setExporting(null)
    }
  }, [orgId])

  /** Per-entity CSV files, ONE request: the `_all` bundle (JSON map of entity → CSV text) split
   *  client-side. The per-entity loop below is version-skew fallback only. */
  const exportCsv = useCallback(async () => {
    setExporting('csv')
    try {
      let csvByEntity: Record<string, string>
      try {
        csvByEntity = await apiFetch<Record<string, string>>(
          `/api/organizations/${orgId}/export?format=csv&entity=_all`,
        )
      } catch (e) {
        // A pre-bundle worker rejects `_all` as an unknown entity (400) and helpfully echoes the
        // entity manifest in the error body — iterate the legacy per-entity path with it. This
        // burns the rate-limit window like the old flow did, but stays functional against a
        // deployed worker older than this client. Anything other than a 400 is a real failure.
        if (!(e instanceof ApiError) || e.status !== 400) throw e
        const echoed = (e.data as { entities?: string[] } | undefined)?.entities
        const entities =
          echoed ??
          (
            await apiFetch<{ entities: string[] }>(
              `/api/organizations/${orgId}/export?format=csv`,
            )
          ).entities
        csvByEntity = {}
        for (const entity of entities) {
          // apiFetch returns text for non-JSON responses — the CSV body arrives as a string.
          csvByEntity[entity] = await apiFetch<string>(
            `/api/organizations/${orgId}/export?format=csv&entity=${encodeURIComponent(entity)}`,
          )
        }
      }
      for (const [entity, csv] of Object.entries(csvByEntity)) {
        await deliverFile(`${filenameStem()}-${entity}.csv`, csv, 'text/csv')
      }
    } finally {
      setExporting(null)
    }
  }, [orgId])

  /** Print-ready report: fetch the worker-composed HTML, hand it to the proven print recipe. */
  const exportPrint = useCallback(async () => {
    setExporting('print')
    try {
      const html = await apiFetch<string>(`/api/organizations/${orgId}/export?format=html`)
      await exportHtmlToPdf(html, {
        filename: filenameStem(),
        dialogTitle: `${APP_CONFIG.name} export`,
      })
    } finally {
      setExporting(null)
    }
  }, [orgId])

  return { exportJson, exportCsv, exportPrint, exporting }
}
