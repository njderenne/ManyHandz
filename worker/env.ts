/** Worker bindings + secrets. Provisioned via wrangler.toml (assets/KV/R2) and `wrangler secret put`. */
export interface Env {
  ASSETS: Fetcher
  /** KV namespace backing the fixed-window rate limiter (worker/middleware/rate-limit.ts). */
  RATE_LIMIT: KVNamespace
  /** R2 bucket for media uploads — optional: R2 needs one-time enablement (see wrangler.toml). */
  MEDIA?: R2Bucket
  DATABASE_URL: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  /** 'development' unlocks dev-only routes (email previews); unset/anything else = production. */
  ENVIRONMENT?: string
  /** Force-update floor served by /api/meta — clients below this version must update. */
  MIN_APP_VERSION?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  APPLE_CLIENT_ID?: string
  APPLE_CLIENT_SECRET?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  // Billing (Stripe) — Worker secrets + the price IDs that map to subscription tiers
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRICE_STANDARD?: string
  STRIPE_PRICE_PREMIUM?: string
  // AI providers (Worker secrets)
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  XAI_API_KEY?: string
  // AI model overrides — optional; cost-aware tier defaults live in worker/ai
  AI_CLASSIFY_MODEL?: string
  AI_REASON_MODEL?: string
  AI_COMPLEX_MODEL?: string
  AI_VISION_MODEL?: string
  AI_VERIFY_MODEL?: string
  AI_IMAGE_MODEL?: string
  // Voice (ElevenLabs) — Worker secret + optional voice/model overrides
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_VOICE_ID?: string
  ELEVENLABS_TTS_MODEL?: string
  ELEVENLABS_STT_MODEL?: string
  // Background removal, by priority: self-hosted rembg service (URL + optional bearer key) →
  // rembg.com hosted API (REMBG_API_KEY alone, x-api-key auth) → Replicate-hosted U2-Net.
  REMBG_SERVICE_URL?: string
  REMBG_API_KEY?: string
  REPLICATE_API_TOKEN?: string
  REPLICATE_REMBG_MODEL?: string
  /** Bearer the Criterial admin sends to GET /api/admin/config. */
  ADMIN_METRICS_TOKEN?: string
}

/**
 * Secrets every deployment needs from day one. The Worker must still boot without them — the
 * static web assets have to keep serving — so a miss is a loud structured WARNING in the logs
 * (visible in `wrangler tail` / observability) instead of a throw. Without this, a forgotten
 * secret surfaces as mystery 500s on auth/db routes with nothing pointing at the cause.
 */
const ALWAYS_REQUIRED = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'] as const

let checked = false

/** Warn-fast secrets check — memoized, runs once per isolate from the fetch handler. */
export function validateEnv(env: Env): void {
  if (checked) return
  checked = true
  const missing = ALWAYS_REQUIRED.filter((key) => !env[key])
  if (missing.length > 0) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'env.missing_secrets',
        missing,
        hint: 'wrangler secret put <NAME> (see wrangler.toml)',
      }),
    )
  }
}
