#!/usr/bin/env node
/**
 * deploy.js — `wrangler deploy` wrapped with the DEPLOY STAMP (Criterial deploy-drift detection).
 *
 * Injects the app repo's current commit + a deploy timestamp into the Worker as plain vars:
 *
 *   wrangler deploy --var GIT_SHA:<short sha> --var DEPLOYED_AT:<ISO-8601>
 *
 * so every deployed Worker can answer "which commit am I?" — surfaced via GET /api/health and the
 * Criterial config reporter's `deploy` block (worker/routes/admin-config.ts). CLI vars are
 * per-deploy and NEVER hand-edited into wrangler.toml; a deploy that bypasses this wrapper (or
 * `wrangler dev`) simply carries no stamp, and every reader renders that as null — never a fake
 * value. Wired as this package's `deploy` script, so `npm run deploy` at the app root and
 * `npm --prefix worker run deploy` both flow through it.
 *
 * Cross-platform by construction (Windows dev machine + ubuntu CI): node builtins only, git found
 * via PATH, and wrangler's own bin resolved from this package and run through process.execPath —
 * no npx / .cmd shims, no shell.
 */
const { execFileSync, spawnSync } = require('node:child_process')

/** Short sha of the app repo's HEAD — null (with a loud warning below) outside a git checkout. */
function gitShortSha() {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
    })
    return out.trim() || null
  } catch {
    return null
  }
}

const args = ['deploy']
const sha = gitShortSha()
if (sha) {
  args.push('--var', `GIT_SHA:${sha}`, '--var', `DEPLOYED_AT:${new Date().toISOString()}`)
} else {
  console.warn('deploy: could not resolve a git sha (not a git checkout?) — deploying WITHOUT the deploy stamp')
}
// Pass caller flags through to wrangler (`npm run deploy -- --dry-run`, `--minify`, `--env x`, …)
// — dropping them silently would turn a --dry-run intent into a REAL deploy.
args.push(...process.argv.slice(2))

const result = spawnSync(process.execPath, [require.resolve('wrangler/bin/wrangler.js'), ...args], {
  cwd: __dirname,
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
