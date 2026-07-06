import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Purity enforcement — the README convention as a test (cheap and durable): engine modules are
 * PURE (no DB, no Env, no Hono, no network), with exactly two sanctioned I/O shells whose entry
 * points are contract-pinned to this directory (STAGE0 §9: sendPromptNudges; the seeder).
 *
 * A new app engine added at mint is picked up AUTOMATICALLY and held to the pure rules — extend
 * IO_SHELLS only when a contract genuinely pins an I/O entry point here (prefer routes/cron).
 */

const ENGINES_DIR = path.dirname(fileURLToPath(import.meta.url))

/** The sanctioned I/O shells (README "Sanctioned exceptions") — may import db/env, never hono. */
const IO_SHELLS = new Set(['nudge.ts', 'catalog-seed.ts'])

/** Import specifiers that make an engine impure. Matched against import/require statements. */
const BANNED_EVERYWHERE = [/from\s+['"]hono/, /require\(\s*['"]hono/]
const BANNED_IN_PURE = [
  /from\s+['"]@\/lib\/db/,
  /from\s+['"]drizzle-orm/,
  /from\s+['"]\.\.?\/env['"]/, // worker/env.ts (the Env type/bindings)
  /from\s+['"]\.\.\/notify['"]/,
  /\bfetch\s*\(/, // network I/O hiding without an import
]

const engineFiles = readdirSync(ENGINES_DIR).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
)

describe('worker/engines purity (README convention)', () => {
  it('the directory has engine files (the glob is not silently empty)', () => {
    expect(engineFiles.length).toBeGreaterThanOrEqual(6)
  })

  it.each(engineFiles)('%s never imports hono (routes do not live here)', (file) => {
    const source = readFileSync(path.join(ENGINES_DIR, file), 'utf8')
    for (const pattern of BANNED_EVERYWHERE) {
      expect(source).not.toMatch(pattern)
    }
  })

  it.each(engineFiles.filter((f) => !IO_SHELLS.has(f)))(
    '%s is pure: no db / drizzle / env / notify / fetch',
    (file) => {
      const source = readFileSync(path.join(ENGINES_DIR, file), 'utf8')
      for (const pattern of BANNED_IN_PURE) {
        expect(source).not.toMatch(pattern)
      }
    },
  )

  it.each(engineFiles)('%s ships a .test.ts sibling (rule 4: tested)', (file) => {
    const sibling = file.replace(/\.ts$/, '.test.ts')
    expect(readdirSync(ENGINES_DIR)).toContain(sibling)
  })
})
