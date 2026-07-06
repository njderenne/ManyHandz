/**
 * Trusted-origins builder — the ONE place the Better-Auth `trustedOrigins` list is computed
 * (worker/auth.ts calls `buildTrustedOrigins(env, { scheme })`; STAGE0 §9 contract). Hand-rolled
 * per-app lists are how the fleet got burned: an origin Better-Auth doesn't trust silently fails
 * CSRF checks on sign-in/callback, and the failure mode is a production outage on a subset of
 * browsers, not a build error. This module derives every variant deterministically from
 * BETTER_AUTH_URL so a mint edits nothing here.
 *
 * What one https origin expands to (grindline's production lessons, comments carried over):
 *   - the origin itself (trailing slash stripped)
 *   - its trailing-dot FQDN variant (browsers sometimes append it) — `https://grindline.app.`
 *     was a REAL grindline production outage: a browser resolving the absolute FQDN sent an
 *     Origin header with the trailing dot and Better-Auth rejected every auth call
 *   - the apex↔www sibling (apex input gains www., a www. input gains the apex) + ITS
 *     trailing-dot variant — users type both; the Worker serves both
 *   - `*.workers.dev` deploy URLs get NO www sibling (Cloudflare never serves a www. variant)
 *     but DO get the trailing-dot variant — the deploy URL is kept valid alongside the custom
 *     domain, so pass it via `extra` when BETTER_AUTH_URL is the custom domain
 *   - localhost / 127.0.0.1 / raw-IP origins pass through untouched (no siblings, no dot —
 *     a trailing dot is an FQDN concept, not an IP one)
 *
 * Always appended: the native deep-link `scheme` (must match app.json `scheme` — OAuth redirects
 * ride it). DEV-ONLY (env.ENVIRONMENT === 'development', the same switch middleware/dev-auth.ts
 * keys on): `http://localhost:8081` (Expo web dev server) and `http://localhost:8787` (local
 * Worker, cf:dev full-stack loop) — baking localhost into PRODUCTION trustedOrigins would let any
 * process bound to those ports on a signed-in user's machine pass Better-Auth's origin/CSRF trust
 * for state-changing auth calls. Everything is de-duplicated preserving first-occurrence order.
 *
 * Deliberately NOT folded in: `env.CORS_ORIGINS`. CORS allowance and auth-origin trust are
 * different grants — an app that serves its web build from an extra origin passes it explicitly
 * via `extra` at the auth.ts call site, where the decision is visible in review.
 */

import type { Env } from '../env'

/** Hostname classes that never get siblings or trailing-dot variants. */
function isLiteralHost(hostname: string): boolean {
  if (hostname === 'localhost') return true
  // IPv4 (all-numeric dotted quad)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true
  // IPv6 — WHATWG URL keeps the brackets on `.host` and may or may not on `.hostname`
  if (hostname.includes(':') || hostname.startsWith('[')) return true
  return false
}

/** Rebuild an origin string from parts, preserving the port when present. */
function origin(protocol: string, hostname: string, port: string): string {
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`
}

/**
 * Expand ONE origin into its trusted variants. Non-http(s) values (deep-link schemes, malformed
 * strings) pass through as-is — Better-Auth treats scheme entries like `myapp://` verbatim.
 */
function expandOrigin(raw: string): string[] {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return [raw] // not URL-shaped (e.g. a malformed value) — pass through verbatim
  }
  // Non-http(s) (deep-link schemes like `myapp://`) pass through VERBATIM — stripping the
  // trailing `//` off a bare scheme would corrupt it.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return [raw]

  const host = url.hostname
  if (isLiteralHost(host)) return [origin(url.protocol, host, url.port)] // localhost / IP — untouched

  // apex↔www sibling. workers.dev deploy URLs never serve a www. variant; deeper custom
  // subdomains (app.example.com) are left alone too — only a 2-label apex gains `www.`.
  let sibling: string | null = null
  if (!host.endsWith('.workers.dev')) {
    if (host.startsWith('www.')) sibling = host.slice(4)
    else if (host.split('.').length === 2) sibling = `www.${host}`
  }

  const out: string[] = []
  for (const h of sibling ? [host, sibling] : [host]) {
    out.push(origin(url.protocol, h, url.port))
    // Trailing-dot FQDN variant (browsers sometimes append it) — see header comment.
    out.push(origin(url.protocol, `${h}.`, url.port))
  }
  return out
}

/**
 * Build the full Better-Auth `trustedOrigins` list (STAGE0 §9 contract).
 *
 * @param opts.scheme the native deep-link scheme, e.g. `'apptemplate://'` — must match app.json
 * @param opts.extra  additional origins to trust, each expanded like BETTER_AUTH_URL (pass the
 *                    `*.workers.dev` deploy URL here when BETTER_AUTH_URL is a custom domain)
 */
export function buildTrustedOrigins(env: Env, opts: { scheme: string; extra?: string[] }): string[] {
  const out: string[] = [
    ...expandOrigin(env.BETTER_AUTH_URL ?? 'http://localhost:8787'),
    ...(opts.extra ?? []).flatMap(expandOrigin),
    opts.scheme, // native OAuth deep-link scheme — must match app.json `scheme`
  ]
  // Dev conveniences are DEV-ONLY (see header): production lists carry exactly the derived
  // BETTER_AUTH_URL variants + scheme + explicit `extra` — never a standing localhost grant.
  if (env.ENVIRONMENT === 'development') {
    out.push('http://localhost:8081') // Expo web dev server
    out.push('http://localhost:8787') // local Worker (cf:dev) — full-stack local testing
  }
  // De-dup preserving first-occurrence order (BETTER_AUTH_URL=localhost:8787 would double up).
  return [...new Set(out)]
}
