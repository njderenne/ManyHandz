/**
 * OAuth provider engine — the GENERIC token plumbing shared by the integrations route (and any
 * sync/cron worker a minted app adds). This is the MECHANISM; the per-app CATALOG of which providers
 * exist (endpoints + scopes + which env vars carry the secrets) lives in src/lib/config/integrations.ts
 * (OAUTH_PROVIDERS), EMPTY by default. Nothing provider-specific is hardcoded here.
 *
 * Security properties (preserve these exactly — they're the reason this is harvested-up, not re-rolled):
 *   - Tokens are stored ENCRYPTED in provider_token.ciphertext (src/lib/crypto/token-cipher.ts,
 *     AES-256-GCM) — never raw JSON. encryptTokenBlob/decryptTokenBlob round-trip the OAuthTokens
 *     JSON through the cipher bound to a TokenBinding: the DEFAULT (and today's fleet-wide) AAD is
 *     the userId, so a ciphertext copied onto another user's row won't decrypt. Org-scoped
 *     credentials (cadio's token-vault shape) pass `{ orgId, app, channel }` instead, binding the
 *     blob to `org:<orgId>:provider:<app>:<channel>` — copied onto another org/channel row it
 *     fails to decrypt, even with raw DB access. See `aadFor`.
 *   - RE-ENCRYPT MIGRATION NOTE (upgrading a row's binding, e.g. userId → org-scoped): decrypt
 *     with the OLD binding and encrypt with the NEW one inside ONE request path, writing the new
 *     ciphertext back in the same transaction-shaped step. NEVER bulk-migrate blind — AAD is
 *     authenticated data, so a row re-written under a wrong/guessed binding is UNRECOVERABLE
 *     ciphertext (there is no "try both" on writes; only the caller knows which binding a row
 *     currently carries). Backward compat is LAW: callers that never pass a binding behave
 *     byte-identically to the pre-binding code (AAD = userId), so existing rows keep decrypting.
 *   - OAuth `state` is an HMAC-SHA-256 signed token (signState/verifyState) binding the flow to the
 *     initiating user + provider, so a callback can't link someone else's account (CSRF defense). The
 *     HMAC key is env.OAUTH_STATE_SECRET, falling back to BETTER_AUTH_SECRET so the flow works on a
 *     default deploy. verifyState does a constant-time-ish compare and rejects any tamper.
 *   - Access tokens are refreshed BEFORE expiry (ensureFreshToken, 5-min skew) and the refreshed blob
 *     is re-encrypted + re-persisted; the refresh_token is preserved when a provider doesn't rotate it.
 *   - WebCrypto only (HMAC + the cipher) so this runs identically in the Worker, Node tests, and the
 *     browser — a `node:crypto` import would break the Workers build.
 *
 * Tokens are NEVER logged. Callers log structured events with the provider key + an error message,
 * never the token blob (see worker/routes/integrations.ts).
 */

import { importTokenKey, encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import {
  getProviderCatalogEntry,
  isOAuthProvider,
  type OAuthProviderConfig,
  type ScopeDelimiter,
} from '@/lib/config/integrations'
import type { Env } from '../env'

/** A provider key from the per-app catalog (OAUTH_PROVIDERS). Plain string at the type level because
 *  the catalog is runtime data — `isProviderConfigured`/the route's 404 guard validate it. */
export type IntegrationProvider = string

export { isOAuthProvider as isIntegrationProvider }

/** A provider's RESOLVED OAuth config: the catalog entry with its env-sourced client id/secret filled in. */
export interface ProviderConfig {
  provider: IntegrationProvider
  clientId: string
  clientSecret: string
  authorizeUrl: string
  tokenUrl: string
  /** Scopes requested on first connect, joined per `scopeDelimiter`. */
  defaultScopes: string
  /** How `defaultScopes` is delimited in the authorize URL (default 'space'). */
  scopeDelimiter: ScopeDelimiter
  /** Optional provider revoke endpoint (best-effort on disconnect). */
  revokeUrl?: string
  /** Extra static authorize-URL params this provider requires (e.g. access_type=offline). */
  extraAuthorizeParams?: Record<string, string>
}

/** The raw token payload a provider's token endpoint returns (kept verbatim for refresh + forensics). */
export interface OAuthTokens {
  access_token: string
  refresh_token?: string
  expires_in?: number // seconds until the access token expires
  expires_at?: number // some providers (e.g. Strava) return an absolute epoch-seconds expiry instead
  scope?: string
  token_type?: string
  [key: string]: unknown
}

/** Read a Worker env var by name (the catalog stores the KEY, not the value). */
function envValue(env: Env, key: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[key]
}

/**
 * Resolve a provider's OAuth config: look it up in the per-app catalog, then source its client
 * id/secret from env by the catalog's `clientIdEnv`/`clientSecretEnv` keys. Returns null when the
 * provider isn't in the catalog OR its secrets aren't set — the route maps that to a 404 (unknown)
 * or 501 (not configured) so the user gets a clean message, not a 500. This is the ONLY part the
 * factory's catalog feeds; authorize/exchange/refresh below are provider-agnostic.
 */
export function getProviderConfig(provider: string, env: Env): ProviderConfig | null {
  const entry: OAuthProviderConfig | null = getProviderCatalogEntry(provider)
  if (!entry) return null
  const clientId = envValue(env, entry.clientIdEnv)
  const clientSecret = envValue(env, entry.clientSecretEnv)
  if (!clientId || !clientSecret) return null
  return {
    provider,
    clientId,
    clientSecret,
    authorizeUrl: entry.authorizeUrl,
    tokenUrl: entry.tokenUrl,
    defaultScopes: entry.defaultScopes,
    scopeDelimiter: entry.scopeDelimiter ?? 'space',
    revokeUrl: entry.revokeUrl,
    extraAuthorizeParams: entry.extraAuthorizeParams,
  }
}

/** True when `provider` is in the catalog AND its env secrets are present (i.e. connectable now). */
export function isProviderConfigured(provider: string, env: Env): boolean {
  return getProviderConfig(provider, env) !== null
}

/**
 * The redirect URI registered with each provider. MUST match the value on the provider's dashboard
 * EXACTLY. Built from BETTER_AUTH_URL (the Worker's public origin).
 */
export function getRedirectUri(provider: IntegrationProvider, env: Env): string {
  const base = (env.BETTER_AUTH_URL ?? 'http://localhost:8787').replace(/\/$/, '')
  return `${base}/api/integrations/${provider}/callback`
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * OAuth state signing — HMAC-SHA-256 over `${userId}.${provider}.${nonce}` (WebCrypto). CSRF defense.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

const encoder = new TextEncoder()

function toHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let out = ''
  for (const b of view) out += b.toString(16).padStart(2, '0')
  return out
}

/** The HMAC key for OAuth state — OAUTH_STATE_SECRET, falling back to BETTER_AUTH_SECRET. */
function stateSecret(env: Env): string {
  return env.OAUTH_STATE_SECRET || env.BETTER_AUTH_SECRET || ''
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return toHex(sig).slice(0, 32)
}

/** Sign an OAuth state token binding the flow to a user + provider. Returns `body.sig`. */
export async function signState(
  env: Env,
  payload: { userId: string; provider: IntegrationProvider; nonce?: string },
): Promise<string> {
  const secret = stateSecret(env)
  if (!secret) throw new Error('OAUTH_STATE_SECRET / BETTER_AUTH_SECRET not configured')
  const nonce = payload.nonce ?? toHex(crypto.getRandomValues(new Uint8Array(8)).buffer)
  const body = `${payload.userId}.${payload.provider}.${nonce}`
  const sig = await hmacHex(secret, body)
  return `${body}.${sig}`
}

/** Verify + parse a signed state token. Returns null on any tamper / wrong-secret / bad shape. */
export async function verifyState(
  env: Env,
  state: string,
): Promise<{ userId: string; provider: IntegrationProvider; nonce: string } | null> {
  const secret = stateSecret(env)
  if (!secret) return null
  const parts = state.split('.')
  if (parts.length !== 4) return null
  const [userId, provider, nonce, sig] = parts
  // Validate the provider against the per-app catalog so a forged state can't smuggle in a key.
  if (!isOAuthProvider(provider)) return null
  const expected = await hmacHex(secret, `${userId}.${provider}.${nonce}`)
  // Constant-time-ish compare: equal length + per-char XOR accumulation (defense in depth; the
  // 128-bit signature already makes a timing oracle impractical).
  if (sig.length !== expected.length) return null
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return null
  return { userId, provider, nonce }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Token envelope — encrypt/decrypt the OAuthTokens JSON via token-cipher, bound to a TokenBinding
 * (AAD). Default binding = userId (today's fleet-wide shape); org-scoped credentials use the
 * cadio token-vault shape. See the header's re-encrypt migration note before changing a row's
 * binding — a wrong AAD is unrecoverable ciphertext.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * What a stored token blob is cryptographically bound to (the cipher's AAD):
 *  - `{ userId }` — the row belongs to one user (the default; all pre-binding rows use this).
 *  - `{ orgId, app, channel }` — the row is an org-level credential (cadio's shape): `app` is the
 *    product namespace (usually the slug), `channel` the provider/connection flavor. A ciphertext
 *    moved across orgs, apps, or channels fails to decrypt.
 */
export type TokenBinding = { userId: string } | { orgId: string; app: string; channel: string }

/** The AAD string for a binding — `userId` (default) or `org:<orgId>:provider:<app>:<channel>`. */
export function aadFor(binding: TokenBinding): string {
  if ('userId' in binding) return binding.userId
  return `org:${binding.orgId}:provider:${binding.app}:${binding.channel}`
}

/** The token-cipher key for at-rest token encryption (TOKEN_CIPHER_KEY → BETTER_AUTH_SECRET fallback). */
function cipherSecret(env: Env): string {
  return env.TOKEN_CIPHER_KEY || env.BETTER_AUTH_SECRET || ''
}

/**
 * Encrypt an OAuthTokens blob for storage in provider_token.ciphertext. Without `binding` the AAD
 * is `userId` — byte-identical to the pre-binding behavior (backward compat is LAW). Pass an
 * org binding to store an org-level credential instead.
 */
export async function encryptTokenBlob(
  env: Env,
  userId: string,
  tokens: OAuthTokens,
  binding?: TokenBinding,
): Promise<string> {
  const secret = cipherSecret(env)
  if (!secret) throw new Error('TOKEN_CIPHER_KEY / BETTER_AUTH_SECRET not configured')
  const key = await importTokenKey(secret)
  return encryptToken(key, JSON.stringify(tokens), aadFor(binding ?? { userId }))
}

/**
 * Decrypt a provider_token.ciphertext envelope back to OAuthTokens. Decryption is attempted with
 * the PROVIDED binding only (defaulting to `{ userId }`, which keeps every existing row
 * decrypting) — there is deliberately no multi-binding fallback: which binding a row carries is
 * the caller's bookkeeping, and silently trying alternates would blur the tamper signal.
 */
export async function decryptTokenBlob(
  env: Env,
  userId: string,
  ciphertext: string,
  binding?: TokenBinding,
): Promise<OAuthTokens> {
  const secret = cipherSecret(env)
  if (!secret) throw new Error('TOKEN_CIPHER_KEY / BETTER_AUTH_SECRET not configured')
  const key = await importTokenKey(secret)
  const json = await decryptToken(key, ciphertext, aadFor(binding ?? { userId }))
  return JSON.parse(json) as OAuthTokens
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Code exchange + refresh — vanilla OAuth 2.0 (form-encoded POST). One surface for every provider.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/** Build a provider authorize URL with a signed state. */
export async function buildAuthorizeUrl(
  cfg: ProviderConfig,
  env: Env,
  userId: string,
): Promise<string> {
  const state = await signState(env, { userId, provider: cfg.provider })
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: getRedirectUri(cfg.provider, env),
    state,
  })
  // Scope param: providers differ on the delimiter (comma vs space). URLSearchParams handles the
  // url-encoding; we only choose how multiple scopes are joined inside the value.
  if (cfg.defaultScopes) params.set('scope', cfg.defaultScopes)
  // Provider-specific static params (e.g. Strava's approval_prompt, Google's access_type=offline)
  // come from the catalog entry — nothing provider-specific is branched on here.
  for (const [k, v] of Object.entries(cfg.extraAuthorizeParams ?? {})) params.set(k, v)
  return `${cfg.authorizeUrl}?${params.toString()}`
}

/** Exchange an authorization code for tokens. Throws on a non-2xx provider response. */
export async function exchangeCodeForTokens(
  cfg: ProviderConfig,
  env: Env,
  code: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: getRedirectUri(cfg.provider, env),
  })
  const resp = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (!resp.ok) throw new Error(`token_exchange_${cfg.provider}_${resp.status}`)
  return (await resp.json()) as OAuthTokens
}

/** Refresh an access token using the stored refresh token. Throws on a non-2xx provider response. */
export async function refreshAccessToken(
  cfg: ProviderConfig,
  refreshToken: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  })
  const resp = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (!resp.ok) throw new Error(`refresh_${cfg.provider}_${resp.status}`)
  return (await resp.json()) as OAuthTokens
}

/** Compute an access-token absolute expiry (Date) from a token blob, or null if unknown. */
export function tokenExpiry(tokens: OAuthTokens): Date | null {
  if (typeof tokens.expires_at === 'number') return new Date(tokens.expires_at * 1000)
  if (typeof tokens.expires_in === 'number') return new Date(Date.now() + tokens.expires_in * 1000)
  return null
}

/**
 * Return a fresh access token for a stored provider_token row, refreshing + re-persisting (encrypted)
 * when the access token is expired or within 5 minutes of expiring. `persist` writes the new
 * ciphertext + expiry back onto the DB row (the caller owns the DB — this module is storage-agnostic
 * so a route or a cron worker can both use it). Domain sync workers a minted app adds call this
 * before every provider API request.
 *
 * Returns the (possibly refreshed) OAuthTokens. Throws if a refresh is needed but no refresh_token
 * exists, or the provider's refresh call fails.
 */
export async function ensureFreshToken(args: {
  env: Env
  cfg: ProviderConfig
  userId: string
  ciphertext: string
  expiresAt: Date | null
  /** Cryptographic binding of THIS row (defaults to `{ userId }` — the pre-binding behavior).
   *  A refreshed blob is re-encrypted under the SAME binding it was read with. */
  binding?: TokenBinding
  /** Persist a refreshed blob: new ciphertext + new access-token expiry. Caller writes the DB row. */
  persist: (next: { ciphertext: string; expiresAt: Date | null }) => Promise<void>
}): Promise<OAuthTokens> {
  const { env, cfg, userId, ciphertext, expiresAt, binding, persist } = args
  const current = await decryptTokenBlob(env, userId, ciphertext, binding)

  const expMs = expiresAt ? expiresAt.getTime() : null
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000
  if (!expMs || expMs > fiveMinFromNow) return current

  const refreshToken = current.refresh_token
  if (!refreshToken) throw new Error(`no_refresh_token_${cfg.provider}`)

  const fresh = await refreshAccessToken(cfg, refreshToken)
  // Providers don't always echo the refresh token back if it hasn't rotated — preserve the old one.
  const merged: OAuthTokens = {
    ...current,
    ...fresh,
    refresh_token: fresh.refresh_token ?? current.refresh_token,
  }
  const nextCiphertext = await encryptTokenBlob(env, userId, merged, binding)
  await persist({ ciphertext: nextCiphertext, expiresAt: tokenExpiry(merged) })
  return merged
}
