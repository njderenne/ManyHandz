/** Worker bindings + secrets. Provisioned via wrangler.toml (assets/KV/R2) and `wrangler secret put`. */
export interface Env {
  ASSETS: Fetcher
  /** KV namespace backing the fixed-window rate limiter (worker/middleware/rate-limit.ts). */
  RATE_LIMIT: KVNamespace
  /** R2 bucket for media uploads — optional: R2 needs one-time enablement (see wrangler.toml). */
  MEDIA?: R2Bucket
  /** Realtime fan-out rooms (worker/realtime/realtime-room.ts) — optional: opt-in by binding the
   *  RealtimeRoom Durable Object in wrangler.toml. Absent = the WS route answers 503. */
  REALTIME_ROOM?: DurableObjectNamespace
  DATABASE_URL: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  /** 'development' unlocks dev-only routes (email previews); unset/anything else = production. */
  ENVIRONMENT?: string
  /** Force-update floor served by /api/meta — clients below this version must update. */
  MIN_APP_VERSION?: string
  /** Extra CORS-allowed web origins (comma-separated), in addition to BETTER_AUTH_URL + localhost.
   *  Set to a minted app's launch/staging web origins for the cross-origin / two-process dev flow. */
  CORS_ORIGINS?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  APPLE_CLIENT_ID?: string
  APPLE_CLIENT_SECRET?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  // Billing (Stripe, web) — all optional; absence = honest degradation, never a crash.
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  // CANONICAL (product-centric): every ACTIVE recurring price on the tier's product is a sellable
  // frequency. Prices are managed in the Stripe dashboard — pricing changes need NO deploy.
  // New mints set these two and nothing else.
  STRIPE_PRODUCT_STANDARD?: string // prod_…
  STRIPE_PRODUCT_PREMIUM?: string  // prod_…
  // One-time Lifetime SKU (mode:'payment' checkout → permanent monetization.lifetimeTier grant).
  STRIPE_PRICE_LIFETIME?: string   // price_…
  // LEGACY (grandfathered FOREVER, never required, never set on new mints): existing subscribers'
  // price ids must keep resolving. NEVER unset these on an app with live subscribers.
  STRIPE_PRICE_STANDARD?: string
  STRIPE_PRICE_PREMIUM?: string
  STRIPE_PRICE_STANDARD_YEARLY?: string
  STRIPE_PRICE_PREMIUM_YEARLY?: string
  // Native IAP (RevenueCat) — the shared secret RevenueCat sends in the webhook Authorization
  // header. Unset = the native billing webhook is disabled (rejects with 401). The platform PUBLIC
  // SDK key is a CLIENT var (EXPO_PUBLIC_REVENUECAT_KEY), not a Worker secret.
  REVENUECAT_WEBHOOK_AUTH?: string
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
  // Third-party OAuth integrations (worker/integrations + routes/integrations.ts) — all OPTIONAL.
  // OAUTH_STATE_SECRET signs the OAuth `state` (CSRF); falls back to BETTER_AUTH_SECRET if unset.
  // TOKEN_CIPHER_KEY encrypts stored OAuth tokens at rest (provider_token.ciphertext, AES-256-GCM);
  // falls back to BETTER_AUTH_SECRET. Set both to dedicated high-entropy secrets in production
  // (`openssl rand -base64 32` → `wrangler secret put …`). Each PROVIDER's client id/secret are
  // also Worker secrets, but their NAMES are declared per-app in src/lib/config/integrations.ts
  // (OAUTH_PROVIDERS[provider].clientIdEnv / clientSecretEnv), e.g. STRAVA_CLIENT_ID. Those are
  // resolved by name at request time (the engine reads env[name]), so they aren't enumerated on
  // this typed Env — a minted app adds the literal keys here if it wants them typed.
  OAUTH_STATE_SECRET?: string
  TOKEN_CIPHER_KEY?: string
  /** Criterial config reporter (GET /api/admin/config) Bearer token; ALSO hardens /api/dev/* in
   *  production (worker/middleware/dev-auth.ts). Unset = reporter 401s, dev routes keep 404ing. */
  ADMIN_METRICS_TOKEN?: string
  // Twilio SMS (worker/lib/sms.ts) — DORMANT until account+auth+sender are all present; nothing
  // throws without them. Auth = API key pair (preferred) OR auth token. Sender = From number OR
  // Messaging Service SID.
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  TWILIO_API_KEY_SID?: string
  TWILIO_API_KEY_SECRET?: string
  TWILIO_FROM_NUMBER?: string          // E.164
  TWILIO_MESSAGING_SERVICE_SID?: string
  // Deploy stamp — injected per-deploy by worker/deploy.js (`wrangler deploy --var GIT_SHA:… --var
  // DEPLOYED_AT:…`), never hand-set in wrangler.toml. Absent under `wrangler dev` or a deploy that
  // bypassed the wrapper — every reader must null-safe. Surfaced via GET /api/health and the
  // Criterial config reporter's `deploy` block (deploy-drift detection).
  /** Short git sha of the app-repo commit this Worker was deployed from. */
  GIT_SHA?: string
  /** ISO-8601 timestamp of the deploy. */
  DEPLOYED_AT?: string
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
