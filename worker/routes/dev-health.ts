import type { Context } from 'hono'
import Stripe from 'stripe'
import type { Env } from '../env'

/**
 * Dev-gated functional health probe — the deep counterpart to /api/health.
 *
 * /api/health proves the worker is UP; this proves its secrets actually WORK. The readiness doctor
 * (builder/verify/readiness.js) can see which secret NAMES exist on the worker (via the Cloudflare
 * API) but never their values — so a secret that is present but CORRUPTED reads as ✅. That bit us
 * once: a PowerShell `$v | wrangler secret put` prepended a UTF-8 BOM and silently broke billing +
 * Google while the doctor stayed green. This route closes the gap two ways:
 *   1. a value-integrity scan (BOM / surrounding whitespace / control chars on every secret), and
 *   2. live functional probes (Stripe actually answers; Google credentials are well-formed).
 *
 * Gated on ENVIRONMENT === 'development' (same as /api/dev/email) — it inspects secret-value
 * metadata, so it must never be reachable in production. It returns booleans + problem LABELS only,
 * never the values themselves.
 */

/** Secrets worth integrity-scanning (string-valued; bindings like MEDIA/RATE_LIMIT are skipped). */
const SCAN_SECRETS = [
  'DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STANDARD', 'STRIPE_PRICE_PREMIUM',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET',
  'RESEND_API_KEY', 'EMAIL_FROM',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY',
  'ELEVENLABS_API_KEY', 'REMBG_API_KEY', 'REPLICATE_API_TOKEN',
] as const

const BOM = 0xfeff
const ZERO_WIDTH_SPACE = 0x200b

/** A problem label if the value looks corrupted (the BOM class of bug), else null. */
function integrityProblem(v: string): string | null {
  if (v.length === 0) return 'empty'
  if (v.charCodeAt(0) === BOM) return 'leading-BOM'
  if (v !== v.trim()) return 'surrounding-whitespace'
  // Control chars (C0/C1), zero-width space, or a stray BOM anywhere — none belong in a credential.
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i)
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === ZERO_WIDTH_SPACE || code === BOM) {
      return 'control-or-zero-width-char'
    }
  }
  return null
}

export async function devHealth(c: Context<{ Bindings: Env }>) {
  if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'not found' }, 404)

  const env = c.env as unknown as Record<string, unknown>
  const issues: { name: string; problem: string }[] = []
  for (const name of SCAN_SECRETS) {
    const v = env[name]
    if (typeof v !== 'string' || v.length === 0) continue // absent ≠ corrupt
    const problem = integrityProblem(v)
    if (problem) issues.push({ name, problem })
  }

  // Stripe: a live call catches a corrupted / revoked / wrong-mode key, not just a missing one.
  let stripe: { ok: boolean; skipped?: boolean; error?: string }
  if (!c.env.STRIPE_SECRET_KEY) stripe = { ok: false, skipped: true }
  else {
    try {
      const client = new Stripe(c.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
      await client.prices.list({ limit: 1 })
      stripe = { ok: true }
    } catch (e) {
      stripe = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Google: a real OAuth round-trip needs a browser; this catches a missing half or a malformed id.
  let google: { ok: boolean; skipped?: boolean; error?: string }
  if (!c.env.GOOGLE_CLIENT_ID && !c.env.GOOGLE_CLIENT_SECRET) google = { ok: false, skipped: true }
  else if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) google = { ok: false, error: 'only one of GOOGLE_CLIENT_ID/SECRET is set' }
  else if (!c.env.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com')) google = { ok: false, error: 'GOOGLE_CLIENT_ID is not a valid Google client id' }
  else google = { ok: true }

  return c.json({
    ts: Date.now(),
    checks: { stripe, google, secretIntegrity: { clean: issues.length === 0, issues } },
  })
}
