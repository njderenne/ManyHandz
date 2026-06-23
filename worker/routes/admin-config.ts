import { Hono } from 'hono'
import type { Env } from '../env'

/**
 * Config reporter for Criterial (the studio admin). Returns the ENV keys this app
 * EXPECTS, each with a `hasValue` flag computed from the Worker's runtime env —
 * never the values themselves. Criterial diffs the key set against the template
 * manifest (drift) and renders `hasValue` as set vs "declared but empty" in its
 * Environment matrix, so a placeholder like `# TODO` never reads as a real ✓.
 *
 *   GET /api/admin/config   (Authorization: Bearer ADMIN_METRICS_TOKEN)
 *   → { manifestVersion, env: [{ key, hasValue }, …] }
 *
 * Keep DECLARED_ENV in sync with worker/env.ts (the runtime keys this app uses).
 * Build-time vars (EXPO_PUBLIC_*) aren't visible to the Worker, so they aren't
 * reported here.
 */
export const adminConfigRoutes = new Hono<{ Bindings: Env }>()

// The template manifest version this app was minted against (matches Criterial).
const MANIFEST_VERSION = 2

// Worker-runtime ENV keys this app expects (mirror of worker/env.ts).
const DECLARED_ENV = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'ENVIRONMENT',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'APPLE_CLIENT_ID',
  'APPLE_CLIENT_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_STANDARD',
  'STRIPE_PRICE_PREMIUM',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'AI_CLASSIFY_MODEL',
  'AI_REASON_MODEL',
  'AI_COMPLEX_MODEL',
  'AI_VISION_MODEL',
  'AI_IMAGE_MODEL',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'ELEVENLABS_TTS_MODEL',
  'ELEVENLABS_STT_MODEL',
  'REMBG_SERVICE_URL',
  'REMBG_API_KEY',
  'REPLICATE_API_TOKEN',
  'REPLICATE_REMBG_MODEL',
] as const

// Treat empties, inline-comment-only lines, and common template placeholders as
// "no value" — so `KEY=# TODO` reports hasValue:false, not true.
const PLACEHOLDER =
  /^(#|your[_-]|change[_-]?me|replace|x{3,}|todo\b|example\b|placeholder|generate-|<.*>|\.\.\.$|re_your|sk_your|rk_your)/i

function hasRealValue(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  let v = raw.trim()
  const h = v.indexOf(' #')
  if (h >= 0) v = v.slice(0, h).trim()
  if (!v) return false
  return !PLACEHOLDER.test(v)
}

adminConfigRoutes.get('/', (c) => {
  const token = c.env.ADMIN_METRICS_TOKEN
  const auth = c.req.header('authorization')
  if (!token || auth !== `Bearer ${token}`) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  const envObj = c.env as unknown as Record<string, unknown>
  const env = DECLARED_ENV.map((key) => ({ key, hasValue: hasRealValue(envObj[key]) }))
  return c.json({ manifestVersion: MANIFEST_VERSION, env })
})
