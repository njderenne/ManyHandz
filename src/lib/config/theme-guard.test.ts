import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Theming guard — enforces the AGENTS.md rule: "never a hardcoded hex (it won't flip with the
 * theme)". Raw colors must come from `useColors()` / the palette in `src/lib/config/theme.ts`,
 * or semantic Tailwind classes. Scans every .ts/.tsx under app/ and src/.
 *
 * Exemptions are files where a fixed color is the point — add a path here only with a comment
 * saying why the color must not flip with the theme.
 */
const EXEMPT_FILES = new Set([
  'src/lib/config/theme.ts', // the palette itself — the one place hex values live
  'src/components/charts/palette.ts', // chartPalette series ramps — the sanctioned chart-hex home (STAGE0 §6.5): categorical series colors are scheme-stable by design, and the Okabe-Ito CB-safe set is a fixed standard
  'src/lib/pdf/html-report.ts', // printed PDF is a fixed light-palette document — it must NOT flip with the app theme, so print colors are hardcoded on purpose
  'src/lib/manyhandz/accents.ts', // the member accent palette — fixed identity colors (avatar rings) that intentionally do NOT flip with the theme
  'app/(dev)/components/style.tsx', // dev gallery: previews alternative brand ramps + gradient demos
  'src/components/native/qr-code.tsx', // QR must stay dark-on-white for scan contrast
  'app/+html.tsx', // static web HTML shell: runs in Node pre-hydration, before the theme/NativeWind load — raw hex sets the anti-flash body background
])

// Shadows are black in both schemes by design — a `shadowColor: '#000000'` line is allowed.
const EXEMPT_LINE = /shadowColor/

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('no hardcoded hex colors outside the palette', () => {
  const root = process.cwd()
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'src'))]

  it('every raw color comes from useColors()/theme.ts (see exemptions in this file)', () => {
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(root, file).replaceAll('\\', '/')
      if (EXEMPT_FILES.has(rel)) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (HEX_RE.test(line) && !EXEMPT_LINE.test(line)) {
          violations.push(`${rel}:${i + 1}  ${line.trim()}`)
        }
      })
    }
    expect(violations, `hardcoded hex colors found:\n${violations.join('\n')}`).toEqual([])
  })

  it('exempt file list stays current (no stale entries)', () => {
    const rels = new Set(files.map((f) => relative(root, f).replaceAll('\\', '/')))
    for (const exempt of EXEMPT_FILES) {
      expect(rels.has(exempt), `exempt file no longer exists: ${exempt}`).toBe(true)
    }
  })
})
