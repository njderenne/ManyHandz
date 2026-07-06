import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { listOAuthProviders } from '@/lib/config/integrations'
import { requireSession, requireOrg, type AuthEnv } from '../middleware/org'
import {
  buildAuthorizeUrl,
  decryptTokenBlob,
  encryptTokenBlob,
  exchangeCodeForTokens,
  getProviderConfig,
  isIntegrationProvider,
  isProviderConfigured,
  tokenExpiry,
  verifyState,
} from '../integrations/providers'
import {
  markProviderSynced,
  providerPullers,
  resolvePersonalOrgId,
  type SyncResult,
} from '../integrations/sync'

/**
 * Integrations — the GENERIC OAuth connect/list/disconnect surface for third-party services
 * (wearables, calendars, mail, storage, …). Mounted at /api/integrations. USER-scoped: an OAuth
 * grant is between a PERSON and a service, not an org — so this sits behind `requireSession` (NOT
 * requireOrg) and every query filters by the session user id. The per-app CATALOG of providers lives
 * in src/lib/config/integrations.ts (OAUTH_PROVIDERS), EMPTY by default; the OAuth ENGINE lives in
 * worker/integrations/providers.ts. Tokens are stored encrypted (token-cipher, AAD = userId) and the
 * flow is CSRF-protected by a signed `state` (see providers.ts).
 *
 *   GET    /api/integrations                       → connected providers + which are configurable
 *   POST   /api/integrations/:provider/authorize   → { url } the OAuth authorize URL (signed state)
 *   GET    /api/integrations/:provider/callback     → verify state, exchange code, store encrypted, redirect
 *   POST   /api/integrations/:provider/sync        → manual "sync now" via the provider's registered
 *                                                    puller (worker/integrations/sync.ts) — caller's
 *                                                    token only; 404 when no puller is registered
 *   DELETE /api/integrations/:provider             → disconnect (best-effort provider deauthorize)
 *
 * What a minted app adds on top (NOT in the template — domain-specific): the actual data SYNC after a
 * connect (pull the provider's resource, write domain rows), usually kicked off in the callback via
 * c.executionCtx.waitUntil(...) and/or a cron. The token plumbing here (refresh, decrypt) is reused
 * by those sync workers via worker/integrations/providers.ts (ensureFreshToken).
 *
 * Optional gating: connecting an integration is often a paid feature. To gate it, add the feature to
 * src/lib/config/entitlements.ts and re-check the caller's tier server-side in `/:provider/authorize`
 * (resolveTier on their personal org → 402). The PG app gated wearable connect at PREMIUM this way;
 * the template ships UNGATED so a minted app opts in. See the commented block in the authorize route.
 */
export const integrationsRoutes = new Hono<AuthEnv>()

/**
 * Deep link back into the app after a successful OAuth callback. The factory sets the app scheme in
 * app.config.js; keep this in sync (or wire it from config). Until set, the web fallback page still
 * renders + the user taps "Return to the app".
 */
const APP_DEEP_LINK = 'myapp://integrations'

/** Small helper: a sanitized HTML success/error page for the OAuth callback (web fallback + deep-link bounce). */
function callbackPage(title: string, message: string, deepLink?: string): string {
  const safe = (s: string) => s.replace(/[<>&"]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[m]!)
  const redirect = deepLink
    ? `<script>setTimeout(function(){location.href=${JSON.stringify(deepLink)}},1200)</script>`
    : ''
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title></head><body style="font-family:system-ui;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0b0b0c;color:#fafafa"><div style="text-align:center;max-width:28rem;padding:2rem"><h1 style="font-size:1.25rem;margin:0 0 .5rem">${safe(title)}</h1><p style="opacity:.7;margin:0">${safe(message)}</p>${deepLink ? `<p style="margin-top:1.5rem"><a href="${safe(deepLink)}" style="color:#7c9cff">Return to the app</a></p>` : ''}</div>${redirect}</body></html>`
}

/* ── GET / — the caller's connected providers + which catalog providers are configurable here ───── */
integrationsRoutes.get('/', requireSession, async (c) => {
  const session = c.get('session')
  const db = getDb(c.env.DATABASE_URL)
  const userId = session.user.id

  const connected = await db
    .select({
      provider: schema.providerToken.provider,
      expiresAt: schema.providerToken.expiresAt,
      lastUsedAt: schema.providerToken.lastUsedAt,
      lastSyncedAt: schema.providerToken.lastSyncedAt,
      createdAt: schema.providerToken.createdAt,
    })
    .from(schema.providerToken)
    .where(and(eq(schema.providerToken.userId, userId), isNull(schema.providerToken.revokedAt)))

  // Which catalog providers are even connectable on THIS deploy (client greys out the rest): in the
  // catalog AND their env secrets are present. Empty until a mint fills OAUTH_PROVIDERS + secrets.
  const configurable = listOAuthProviders().filter((p) => isProviderConfigured(p, c.env))

  return c.json({ connected, configurable })
})

/* ── POST /:provider/authorize — return the OAuth authorize URL + signed state ─────────────────── */
integrationsRoutes.post('/:provider/authorize', requireSession, async (c) => {
  const session = c.get('session')
  const provider = c.req.param('provider')
  if (!isIntegrationProvider(provider)) return c.json({ error: 'unknown provider' }, 404)

  const cfg = getProviderConfig(provider, c.env)
  if (!cfg) return c.json({ error: `${provider} is not configured on this server` }, 501)

  // OPTIONAL per-app gate — connecting an integration is often a paid feature. Uncomment + adapt to
  // require a tier (mirrors the PG wearable-connect=PREMIUM gate). The catalog/secrets check above
  // stays; this only adds a billing requirement on top.
  //
  //   import { resolveTier } from '../entitlements'
  //   const db = getDb(c.env.DATABASE_URL)
  //   const [personalOrg] = await db
  //     .select({ id: schema.member.organizationId })
  //     .from(schema.member)
  //     .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
  //     .where(and(eq(schema.member.userId, session.user.id), eq(schema.organization.kind, 'personal')))
  //     .limit(1)
  //   const tier = personalOrg ? await resolveTier(db, personalOrg.id) : 'FREE'
  //   if (tier !== 'PREMIUM') return c.json({ error: 'Connecting this integration requires Premium' }, 402)

  const url = await buildAuthorizeUrl(cfg, c.env, session.user.id)
  return c.json({ url })
})

/* ── GET /:provider/callback — verify state, exchange code, store encrypted, bounce to the app ──── */
integrationsRoutes.get('/:provider/callback', async (c) => {
  const provider = c.req.param('provider')
  const code = c.req.query('code')
  const state = c.req.query('state')
  const oauthError = c.req.query('error')

  if (!isIntegrationProvider(provider)) {
    return c.html(callbackPage('Unknown provider', 'That integration is not recognized.'), 404)
  }
  if (oauthError) {
    return c.html(callbackPage('Connection cancelled', 'You can try connecting again from the app.', APP_DEEP_LINK))
  }
  if (!code || !state) {
    return c.html(callbackPage("Couldn't connect", 'Missing authorization code or state.', APP_DEEP_LINK), 400)
  }

  // Verify the signed state — binds the callback to the user who started the flow + the provider
  // (CSRF defense). A forged/tampered/cross-provider state is rejected here, before any exchange.
  const verified = await verifyState(c.env, state)
  if (!verified || verified.provider !== provider) {
    return c.html(callbackPage("Couldn't connect", 'The request could not be verified. Please try again.', APP_DEEP_LINK), 400)
  }
  const userId = verified.userId

  const cfg = getProviderConfig(provider, c.env)
  if (!cfg) {
    return c.html(callbackPage('Not configured', `${provider} is not configured on this server.`, APP_DEEP_LINK), 501)
  }

  const db = getDb(c.env.DATABASE_URL)

  let tokens
  try {
    tokens = await exchangeCodeForTokens(cfg, c.env, code)
  } catch (e) {
    // NEVER log the code or token blob — only the provider + a sanitized message.
    console.error(JSON.stringify({ level: 'error', event: 'integrations.exchange_failed', provider, message: e instanceof Error ? e.message : String(e) }))
    return c.html(callbackPage("Couldn't connect", 'The provider rejected the connection. Please try again.', APP_DEEP_LINK), 502)
  }

  // Encrypt the token blob (AAD = userId) and upsert the provider_token row (unique on user+provider).
  const ciphertext = await encryptTokenBlob(c.env, userId, tokens)
  await db
    .insert(schema.providerToken)
    .values({ userId, provider, ciphertext, expiresAt: tokenExpiry(tokens), revokedAt: null })
    .onConflictDoUpdate({
      target: [schema.providerToken.userId, schema.providerToken.provider],
      set: { ciphertext, expiresAt: tokenExpiry(tokens), revokedAt: null, lastUsedAt: new Date() },
    })

  // DOMAIN HOOK (a minted app adds this): kick an initial data pull in the background so the user
  // sees data on first return — register a puller in worker/integrations/sync.ts (providerPullers)
  // and the user can also tap "sync now" (POST /:provider/sync) or wait for the cron sweep. For an
  // immediate first pull here: resolve the destination via resolvePersonalOrgId, then
  //   c.executionCtx.waitUntil(puller(c.env, { userId, provider, destinationOrgId, ...row }).catch(...))
  // Pullers reuse ensureFreshToken/decryptTokenBlob from worker/integrations/providers.ts.

  // Native deep-link bounce; the HTML page is the web fallback + the auto-redirect carrier.
  return c.html(callbackPage('Connected!', `Your ${provider} account is linked. Returning to the app…`, APP_DEEP_LINK))
})

/* ── POST /:provider/sync — manual "sync now" for the CALLER's token only ───────────────────────── */
integrationsRoutes.post('/:provider/sync', requireSession, async (c) => {
  const session = c.get('session')
  const provider = c.req.param('provider')

  // 404 for unregistered providers: a puller must exist (worker/integrations/sync.ts registry —
  // apps assign `providerPullers.<key>` at module load). Connect-only providers have no sync.
  const puller = providerPullers[provider]
  if (!puller) return c.json({ error: 'no sync is registered for this provider' }, 404)

  const db = getDb(c.env.DATABASE_URL)
  const userId = session.user.id

  const [row] = await db
    .select({
      ciphertext: schema.providerToken.ciphertext,
      expiresAt: schema.providerToken.expiresAt,
      lastSyncedAt: schema.providerToken.lastSyncedAt,
    })
    .from(schema.providerToken)
    .where(
      and(
        eq(schema.providerToken.userId, userId),
        eq(schema.providerToken.provider, provider),
        isNull(schema.providerToken.revokedAt),
      ),
    )
    .limit(1)
  if (!row) return c.json({ error: 'not connected' }, 404)

  // Destination rule (M-11): imported data lands ONLY in the caller's personal org — no
  // first-membership fallback, ever. Without one, the pull is refused with a machine-readable code.
  const destinationOrgId = await resolvePersonalOrgId(db, userId)
  if (!destinationOrgId) {
    console.log(
      JSON.stringify({ level: 'info', event: 'integrations.sync.no_destination', provider, userId }),
    )
    return c.json({ error: 'no personal space to sync into', code: 'no_destination' }, 409)
  }

  // Same soft-fail doctrine as the cron sweep: a throwing puller becomes a structured error result.
  let result: SyncResult
  try {
    result = await puller(c.env, { userId, provider, destinationOrgId, ...row })
  } catch (e) {
    result = {
      provider,
      userId,
      inserted: 0,
      skipped: 0,
      error: e instanceof Error ? e.message : 'sync_failed',
    }
  }

  if (result.error) {
    // NEVER log the token blob — provider + sanitized message only.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'integrations.sync.failed',
        provider,
        userId,
        message: result.error,
      }),
    )
    return c.json({ result }, 502)
  }

  // Completed pull — stamp the provider_token/sync_state checkpoints like the cron sweep does.
  await markProviderSynced(db, userId, provider)
  return c.json({ result })
})

/* ── DELETE /:provider — disconnect (best-effort provider deauthorize) ──────────────────────────── */
integrationsRoutes.delete('/:provider', requireSession, async (c) => {
  const session = c.get('session')
  const provider = c.req.param('provider')
  if (!isIntegrationProvider(provider)) return c.json({ error: 'unknown provider' }, 404)

  const db = getDb(c.env.DATABASE_URL)
  const userId = session.user.id

  const [row] = await db
    .select({ ciphertext: schema.providerToken.ciphertext })
    .from(schema.providerToken)
    .where(
      and(
        eq(schema.providerToken.userId, userId),
        eq(schema.providerToken.provider, provider),
        isNull(schema.providerToken.revokedAt),
      ),
    )
    .limit(1)
  if (!row) return c.json({ error: 'not connected' }, 404)

  // Best-effort provider-side revoke — never let a provider hiccup block our own disconnect.
  const cfg = getProviderConfig(provider, c.env)
  if (cfg?.revokeUrl) {
    try {
      const tokens = await decryptTokenBlob(c.env, userId, row.ciphertext)
      if (tokens.access_token) {
        const body = new URLSearchParams({ token: tokens.access_token, access_token: tokens.access_token })
        await fetch(cfg.revokeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${tokens.access_token}`,
          },
          body: body.toString(),
        })
      }
    } catch (e) {
      console.warn(JSON.stringify({ level: 'warn', event: 'integrations.revoke_provider_failed', provider, message: e instanceof Error ? e.message : String(e) }))
    }
  }

  // Mark revoked (keep the row briefly so a reconnect can reuse the refresh token) + disable any
  // sync_state checkpoint a domain sync worker seeded for this provider.
  await db
    .update(schema.providerToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.providerToken.userId, userId), eq(schema.providerToken.provider, provider)))
  await db
    .update(schema.syncState)
    .set({ enabled: false })
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.provider, provider)))

  return c.json({ ok: true })
})
