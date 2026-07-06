/**
 * Generic printable-HTML builders for tamper-evident document/report export. These compose a clean,
 * paginated HTML document that expo-print rasterizes to PDF identically on web (printAsync) and
 * native (printToFileAsync) — pure + dependency-light, no React, no theme.
 *
 * The proven print recipe baked in here:
 *   - `@page` margins reserve room for a repeating footer.
 *   - The footer is `position: fixed` so it repeats on EVERY printed page — pair it with an integrity
 *     stamp (verification code + hash, see worker/lib/integrity.ts) and any single page is
 *     independently verifiable.
 *   - `page-break-inside: avoid` on table rows keeps a row from splitting across a page boundary.
 *
 * COLORS ARE HARDCODED ON PURPOSE. A printed PDF is a fixed light-palette document — it must read the
 * same on paper and in a court filing regardless of the app's light/dark theme, so it must NOT flip
 * with `useColors()`. This file is therefore listed in EXEMPT_FILES in
 * src/lib/config/theme-guard.test.ts.
 */

/** A printed integrity stamp — the shape worker/lib/integrity.ts `stampContent` returns. */
export type IntegrityStamp = {
  algorithm: string
  hash: string
  verificationCode: string
}

/** One section of the report: a titled, counted table (or an empty-state line when no rows). */
export type ReportSection = {
  title: string
  /** Shown as a pill next to the title; defaults to `rows.length` when omitted. */
  count?: number
  headers: string[]
  /**
   * Cell values are inserted AS-IS into the HTML, so escape any user-supplied text with `esc()`
   * before building a row. (This lets callers emit trusted inline markup like <strong> when needed.)
   */
  rows: string[][]
}

export type ReportDocument = {
  title: string
  subtitle?: string
  /** Optional highlighted lead paragraph (e.g. the tamper-evidence explanation). */
  leadNote?: string
  sections: ReportSection[]
  /** Footer left text (repeats on every page) — e.g. the document name / range. */
  footerLeft?: string
  /** Footer right text (repeats on every page) — e.g. the verification code + hash. */
  footerRight?: string
}

/** Escape user-supplied text so a value can never break (or inject into) the generated HTML. */
export const esc = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  )

/** Render one section as `<section>` with a counted heading and a table (or an empty-state line). */
export function renderTableSection({ title, count, headers, rows }: ReportSection): string {
  const n = count ?? rows.length
  const heading = `<h2>${esc(title)} <span class="count">${esc(n)}</span></h2>`
  if (rows.length === 0) return `<section>${heading}<p class="empty">None in this period.</p></section>`
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')
  return `<section>${heading}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`
}

/**
 * Build a full, printable HTML document from a title/subtitle/lead + sections, wrapped in the proven
 * print CSS (fixed repeating footer, `@page` margins, `page-break-inside: avoid`). Feed the result to
 * `exportHtmlToPdf` (src/lib/pdf/export.ts).
 */
export function buildReportDocument({
  title,
  subtitle,
  leadNote,
  sections,
  footerLeft,
  footerRight,
}: ReportDocument): string {
  const body = sections.map(renderTableSection).join('\n')
  const lead = leadNote ? `<p class="lead">${esc(leadNote)}</p>` : ''
  const sub = subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''
  const footer =
    footerLeft || footerRight
      ? `<div class="footer"><span>${esc(footerLeft ?? '')}</span><span>${footerRight ?? ''}</span></div>`
      : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { margin: 56px 40px 84px; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #14181f; font-size: 12px; line-height: 1.45; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 2px; color: #0f766e; }
  .sub { color: #5b6470; font-size: 11px; margin: 0; }
  .lead { margin: 14px 0 24px; padding: 12px 14px; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; color: #134e4a; font-size: 11px; }
  section { margin: 0 0 22px; page-break-inside: auto; }
  h2 { font-size: 14px; color: #0f766e; border-bottom: 2px solid #0f766e; padding-bottom: 4px; margin: 0 0 8px; }
  h2 .count { float: right; background: #0f766e; color: #fff; border-radius: 10px; padding: 1px 9px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: #5b6470; border-bottom: 1px solid #d4d9e0; padding: 5px 6px; }
  td { padding: 6px; border-bottom: 1px solid #eef1f4; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .empty { color: #8a929c; font-style: italic; margin: 4px 0; }
  .muted { color: #8a929c; }
  .badge { display: inline-block; background: #eef1f4; border-radius: 4px; padding: 1px 6px; font-size: 10px; text-transform: capitalize; }
  .footer { position: fixed; bottom: -64px; left: 0; right: 0; border-top: 1px solid #d4d9e0; padding-top: 6px; font-size: 9px; color: #5b6470; display: flex; justify-content: space-between; }
  .footer code { font-family: "SF Mono", Consolas, monospace; color: #14181f; }
</style></head>
<body>
  <header>
    <h1>${esc(title)}</h1>
    ${sub}
  </header>
  ${lead}
  ${body}
  ${footer}
</body></html>`
}
