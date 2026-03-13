// ---------------------------------------------------------------------------
// Environment variable validation — fails fast at startup if required vars are missing
// ---------------------------------------------------------------------------

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. Check your .env.local file.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Server-only variables (validated on first access)
// ---------------------------------------------------------------------------

let _validated = false;

const _cache: Record<string, string> = {};

function cachedEnv(key: string): string {
  if (!_cache[key]) {
    _cache[key] = requireEnv(key);
  }
  return _cache[key];
}

export const env = {
  // Supabase
  get SUPABASE_URL() {
    return cachedEnv("NEXT_PUBLIC_SUPABASE_URL");
  },
  get SUPABASE_ANON_KEY() {
    return cachedEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return cachedEnv("SUPABASE_SERVICE_ROLE_KEY");
  },

  // Stripe
  get STRIPE_SECRET_KEY() {
    return cachedEnv("STRIPE_SECRET_KEY");
  },
  get STRIPE_WEBHOOK_SECRET() {
    return cachedEnv("STRIPE_WEBHOOK_SECRET");
  },
  get STRIPE_PRICE_ID_MONTHLY() {
    return cachedEnv("STRIPE_PRICE_ID_MONTHLY");
  },
  get STRIPE_PRICE_ID_ANNUAL() {
    return cachedEnv("STRIPE_PRICE_ID_ANNUAL");
  },

  // WebAuthn
  get WEBAUTHN_RP_NAME() {
    return cachedEnv("WEBAUTHN_RP_NAME");
  },
  get WEBAUTHN_RP_ID() {
    return cachedEnv("WEBAUTHN_RP_ID");
  },
  get WEBAUTHN_ORIGIN() {
    return cachedEnv("WEBAUTHN_ORIGIN");
  },

  // Push notifications
  get VAPID_PUBLIC_KEY() {
    return cachedEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  },
  get VAPID_PRIVATE_KEY() {
    return cachedEnv("VAPID_PRIVATE_KEY");
  },

  // Cron secret — required to protect cron endpoints
  get CRON_SECRET() {
    return cachedEnv("CRON_SECRET");
  },

  // Optional — return undefined if not set
  get SUPABASE_WEBHOOK_SECRET() {
    return process.env.SUPABASE_WEBHOOK_SECRET;
  },
};
