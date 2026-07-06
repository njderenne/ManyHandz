import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Confirmation guard — enforces the AGENTS.md rule: NEVER use native `Alert.alert(…)` or
 * `window.confirm(…)` for confirmations. On web `Alert.alert` is a no-op and `window.confirm` renders
 * the browser's unthemeable "<host> says…" chrome; on native `Alert` looks nothing like the app. Use
 * the themed promise-based `useConfirm()` (src/components/ui/confirm.tsx) instead. Scans every
 * .ts/.tsx under app/ and src/ for the CALL forms (the doc comment in confirm.tsx has no parens, so
 * it isn't flagged).
 */
const FORBIDDEN: { re: RegExp; use: string }[] = [
  { re: /\bAlert\.alert\s*\(/, use: 'useConfirm()' },
  { re: /\bwindow\.confirm\s*\(/, use: 'useConfirm()' },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('no native Alert.alert / window.confirm (use useConfirm)', () => {
  const root = process.cwd()
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'src'))]

  it('every confirmation goes through useConfirm(), not native alerts', () => {
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(root, file).replaceAll('\\', '/')
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const { re, use } of FORBIDDEN) {
          if (re.test(line)) violations.push(`${rel}:${i + 1}  use ${use} →  ${line.trim()}`)
        }
      })
    }
    expect(violations, `native confirmation calls found:\n${violations.join('\n')}`).toEqual([])
  })
})
