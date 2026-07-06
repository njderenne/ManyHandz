/**
 * OAuth integrations catalog — the per-app list of third-party services this app can connect to via
 * OAuth 2.0 (wearables, calendars, mail, storage, …). ONE source of truth, read by the Worker's
 * OAuth engine (worker/integrations/providers.ts → getProviderConfig) to build authorize URLs,
 * exchange codes, and refresh tokens. This file is dependency-free (no expo / react-query / drizzle)
 * so the Worker can import it.
 *
 * Per-app contract: the factory fills OAUTH_PROVIDERS with THIS app's providers. It is EMPTY by
 * default — until a mint adds entries, the integrations route reports nothing connectable and every
 * authorize call answers 404 (unknown provider). The MECHANISM (authorize / exchange / refresh /
 * encrypt-store / disconnect, plus OAuth-state CSRF signing) lives in the Worker and never changes;
 * this file is pure DATA — the catalog of endpoints + scopes + which env vars carry the secrets.
 *
 * SECRETS NEVER LIVE HERE. A provider's client id/secret are Worker secrets, referenced by the
 * `clientIdEnv` / `clientSecretEnv` keys below and resolved from `env` at request time. A provider
 * whose env vars are unset is reported "not configured" (the route answers 501) rather than throwing
 * — so you can ship the catalog entry and add the secrets later via `wrangler secret put`.
 */

/** How a provider delimits its OAuth scope list. Strava is comma-delimited; most are space. */
export type ScopeDelimiter = 'space' | 'comma'

/** One provider's static OAuth config — endpoints, scopes, and the env keys carrying its secrets. */
export interface OAuthProviderConfig {
  /**
   * Worker env var holding this provider's OAuth client id (e.g. 'STRAVA_CLIENT_ID'). The engine
   * reads env[clientIdEnv]; an unset value makes the provider report "not configured".
   */
  clientIdEnv: string
  /** Worker env var holding this provider's OAuth client secret (e.g. 'STRAVA_CLIENT_SECRET'). */
  clientSecretEnv: string
  /** The provider's OAuth 2.0 authorize endpoint (where the user is sent to grant access). */
  authorizeUrl: string
  /** The provider's token endpoint (code exchange + refresh, form-encoded POST). */
  tokenUrl: string
  /** Scopes requested on first connect (joined by `scopeDelimiter`). Empty string = no scope param. */
  defaultScopes: string
  /** How `defaultScopes` is delimited in the authorize URL. Default 'space'. */
  scopeDelimiter?: ScopeDelimiter
  /** Optional provider revoke/deauthorize endpoint — called best-effort on disconnect. */
  revokeUrl?: string
  /**
   * Extra authorize-URL query params some providers require (e.g. Strava's `approval_prompt`, a
   * provider's `access_type=offline`/`prompt=consent` to force a refresh token). Static per provider.
   */
  extraAuthorizeParams?: Record<string, string>
}

/**
 * The per-app OAuth provider catalog: provider key → static config. EMPTY by default — a minted app
 * fills it with the services it integrates. The key is the stable `provider` string stored in
 * provider_token.provider / sync_state.provider and used in the route path
 * (/api/integrations/:provider/...), so keep it lowercase + url-safe.
 *
 * EXAMPLES (commented — these are domain providers; uncomment/replace with THIS app's):
 *
 *   strava: {
 *     clientIdEnv: 'STRAVA_CLIENT_ID',
 *     clientSecretEnv: 'STRAVA_CLIENT_SECRET',
 *     authorizeUrl: 'https://www.strava.com/oauth/authorize',
 *     tokenUrl: 'https://www.strava.com/oauth/token',
 *     defaultScopes: 'read,activity:read_all',
 *     scopeDelimiter: 'comma',
 *     revokeUrl: 'https://www.strava.com/oauth/deauthorize',
 *     extraAuthorizeParams: { approval_prompt: 'auto' },
 *   },
 *   google_calendar: {
 *     clientIdEnv: 'GOOGLE_CALENDAR_CLIENT_ID',
 *     clientSecretEnv: 'GOOGLE_CALENDAR_CLIENT_SECRET',
 *     authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
 *     tokenUrl: 'https://oauth2.googleapis.com/token',
 *     defaultScopes: 'https://www.googleapis.com/auth/calendar.readonly',
 *     // access_type=offline + prompt=consent are what make Google return a refresh_token.
 *     extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
 *   },
 */
export const OAUTH_PROVIDERS = {
  // EXAMPLE — replace with this app's OAuth providers (see the commented examples above):
  // strava: { … },
  // google_calendar: { … },
} as const satisfies Record<string, OAuthProviderConfig>

/** The set of provider keys this app declares — the runtime allow-list the route validates against. */
export type OAuthProvider = keyof typeof OAUTH_PROVIDERS

/** Is `p` a provider declared in this app's catalog? The route's 404 guard for unknown providers. */
export function isOAuthProvider(p: string): p is OAuthProvider {
  return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, p)
}

/** Every provider key in the catalog (e.g. to report which are even configurable on this deploy). */
export function listOAuthProviders(): readonly string[] {
  return Object.keys(OAUTH_PROVIDERS)
}

/**
 * The static catalog entry for `provider`, or null if the app's catalog doesn't declare it. This is
 * pure data (no env, no secrets) — the Worker engine layers the resolved client id/secret on top via
 * getProviderConfig(provider, env). Shared by client + worker so both agree on which providers exist.
 */
export function getProviderCatalogEntry(provider: string): OAuthProviderConfig | null {
  if (!isOAuthProvider(provider)) return null
  return OAUTH_PROVIDERS[provider]
}
