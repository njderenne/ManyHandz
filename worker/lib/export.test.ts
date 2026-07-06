import { describe, it, expect, vi } from 'vitest'
import type { DB } from '@/lib/db'
import { parseCsv } from '@/lib/csv/parse'

/**
 * Export-lib tests — the CSV writer's RFC-4180 quoting (round-tripped through the template's own
 * parser: what src/lib/csv/parse.ts reads back must equal what rowsToCsv wrote), the JSON
 * document round-trip, the registry composition, and exportPrintHtml's escaping (user data must
 * never become markup in the printable document).
 */
vi.mock('@/lib/config/app', () => ({
  APP_CONFIG: {
    name: 'Template',
    features: { subjects: true, export: true },
  },
}))

import { composeExport, exportSerializers, exportPrintHtml, rowsToCsv } from './export'

describe('rowsToCsv (RFC 4180)', () => {
  it('quotes commas/quotes/newlines and round-trips through the template CSV parser', () => {
    const rows = [
      { name: 'Plain', note: 'a,b', quote: 'say "hi"', multi: 'line1\nline2' },
      { name: 'Røw 2', note: '', quote: 'ok', multi: 'x' },
    ]
    const csv = rowsToCsv(rows)
    // CRLF line endings — what spreadsheet apps expect on every platform (keepsey recipe).
    expect(csv.endsWith('\r\n')).toBe(true)
    const parsed = parseCsv(csv)
    expect(parsed[0]).toEqual(['name', 'note', 'quote', 'multi'])
    expect(parsed[1]).toEqual(['Plain', 'a,b', 'say "hi"', 'line1\nline2'])
    expect(parsed[2]).toEqual(['Røw 2', '', 'ok', 'x'])
  })

  it('serializes Dates to ISO, objects to JSON, null/undefined to empty', () => {
    const at = new Date('2026-07-05T12:00:00Z')
    const csv = rowsToCsv([{ at, meta: { a: 1 }, gone: null, missing: undefined, n: 7 }])
    const [, row] = parseCsv(csv)
    expect(row).toEqual([at.toISOString(), '{"a":1}', '', '', '7'])
  })

  it('columns are the union of every row (sparse app serializers stay lossless)', () => {
    const csv = rowsToCsv([{ a: 1 }, { b: 2 }])
    const [header, r1, r2] = parseCsv(csv)
    expect(header).toEqual(['a', 'b'])
    expect(r1).toEqual(['1', ''])
    expect(r2).toEqual(['', '2'])
  })

  it('neutralizes spreadsheet formula leads (=,+,-,@,TAB,CR) on string cells', () => {
    // A user-typed cell beginning with a formula char must be de-fanged with a leading quote so
    // Excel/Sheets render the literal text instead of evaluating a live formula (CSV/DDE injection).
    const csv = rowsToCsv([
      { name: '=SUM(A1)', plus: '+1+1', minus: '-2', at: '@cmd', ok: 'safe' },
    ])
    const [, row] = parseCsv(csv)
    expect(row).toEqual(["'=SUM(A1)", "'+1+1", "'-2", "'@cmd", 'safe'])
  })

  it('never neutralizes non-string scalars — negative numbers round-trip intact', () => {
    // Formula injection is only possible via attacker-controlled STRINGS; a numeric -5 must
    // serialize as -5 (prefixing it would corrupt every negative value in an app's export).
    const csv = rowsToCsv([{ n: -5, f: -2.5, ok: true, s: '-2' }])
    const [, row] = parseCsv(csv)
    expect(row).toEqual(['-5', '-2.5', 'true', "'-2"])
  })

  it('leaves JSON-serialized object cells alone (they never open with a formula lead)', () => {
    // The object branch stringifies to {…}/[…] — never a =,+,-,@ lead — so no neutralizer applies.
    const csv = rowsToCsv([{ meta: { formula: '=SUM(A1)' } }])
    const [, row] = parseCsv(csv)
    expect(row).toEqual(['{"formula":"=SUM(A1)"}'])
  })
})

describe('composeExport (registry composition)', () => {
  it('one JSON document + one CSV per entity; the JSON round-trips through JSON.parse', async () => {
    // The registry is a mutable app-extension point — swap it for a stub and restore after.
    const saved = exportSerializers.splice(0, exportSerializers.length)
    try {
      exportSerializers.push({
        entity: 'demo',
        toRows: async () => [{ id: 'd1', when: new Date('2026-07-01T00:00:00Z'), note: 'a,b' }],
      })
      const payload = await composeExport({} as DB, 'org1')

      const entities = payload.json.entities as Record<string, unknown[]>
      expect(Object.keys(entities)).toEqual(['demo'])
      expect(typeof payload.json.exportedAt).toBe('string')

      // Round-trip: the document survives serialization (Dates become ISO strings — stable).
      const rehydrated = JSON.parse(JSON.stringify(payload.json)) as typeof payload.json
      expect((rehydrated.entities as Record<string, unknown[]>).demo).toEqual([
        { id: 'd1', when: '2026-07-01T00:00:00.000Z', note: 'a,b' },
      ])

      expect(Object.keys(payload.csvByEntity)).toEqual(['demo'])
      expect(parseCsv(payload.csvByEntity.demo)[1]).toEqual([
        'd1',
        '2026-07-01T00:00:00.000Z',
        'a,b',
      ])
    } finally {
      exportSerializers.splice(0, exportSerializers.length, ...saved)
    }
  })
})

describe('exportPrintHtml', () => {
  it('escapes user data — a value can never inject markup into the printable document', () => {
    const html = exportPrintHtml({
      json: {
        exportedAt: '2026-07-05T00:00:00.000Z',
        entities: { demo: [{ name: '<script>alert(1)</script>', note: 'a & b' }] },
      },
      csvByEntity: {},
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; b')
    // The proven print recipe rides along (fixed footer + page-break rules from html-report.ts).
    expect(html).toContain('page-break-inside: avoid')
    expect(html).toContain('Template data export')
  })
})
