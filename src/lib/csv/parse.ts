/**
 * CSV parsing — a small RFC-4180 state machine, no dependency. Handles quoted fields, embedded
 * commas/quotes/newlines, CRLF and LF line endings, and a trailing newline. Runs anywhere
 * (Worker, native, web); for files beyond a few MB do the parsing Worker-side.
 *
 * Not a streaming parser — it materializes the whole input. That is the right trade for import
 * flows ("upload a spreadsheet of members/transactions"); revisit only if an app needs huge files.
 */

/** Parse CSV text into rows of fields. Empty input → []. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"' // escaped quote
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++ // CRLF
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  // Final field/row unless the input ended exactly on a row break (or was empty).
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Parse CSV with the first row as the header. Each row becomes a record keyed by header name;
 * short rows leave missing keys as '' and extra fields are dropped.
 */
export function parseCsvWithHeader(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  return rows.map((row) =>
    Object.fromEntries(header.map((name, i) => [name, row[i] ?? ''])),
  )
}
