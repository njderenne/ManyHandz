import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { validateEnv, type Env } from './env'
import { getAuth } from './auth'
import { VERSION } from './version'
import { scheduled } from './cron'
import { rateLimit } from './middleware/rate-limit'
import { devAuth } from './middleware/dev-auth'                      // A2
import { APP_CONFIG } from '@/lib/config/app'
import { aiRoutes } from './routes/ai'
import { aiToolsRoutes } from './routes/ai-tools'
import { stripeRoutes } from './routes/stripe'
import { revenuecatRoutes } from './routes/revenuecat'
import { billingRoutes } from './routes/billing'
import { publicShareRoutes, shareRoutes } from './routes/sharing'
import { realtimeRoutes } from './routes/realtime'
import { voiceRoutes } from './routes/voice'
import { imageRoutes } from './routes/image'
import { pushRoutes } from './routes/push'
import { mediaRoutes } from './routes/media'
import { feedbackRoutes } from './routes/feedback'
import { notificationRoutes } from './routes/notifications'
import { moderationRoutes } from './routes/moderation'
import { settingsRoutes } from './routes/settings'
import { creditRoutes } from './routes/credits'
import { achievementRoutes } from './routes/achievements'
import { streakRoutes } from './routes/streaks'
import { referralRoutes } from './routes/referrals'
import { chatRoutes } from './routes/chat'
import { bookmarkRoutes } from './routes/bookmarks'
import { eventRoutes } from './routes/events'
import { messageRoutes } from './routes/messages'
import { usersRoutes } from './routes/users'
import { integrationsRoutes } from './routes/integrations'
import { adminConfigRoutes } from './routes/admin-config'           // A2
import { escalationRoutes } from './routes/escalations'             // A3
import { grantRoutes } from './routes/grants'                       // A4
import { grantPublicRoutes } from './routes/grant-public'           // A4
import { exportRoutes } from './routes/export'                      // A4
import { orgSettingsRoutes } from './routes/org-settings'           // B1
import { subjectRoutes } from './routes/subjects'                   // B2
import { oversightRoutes } from './routes/oversight'                // B2
import { promptRoutes } from './routes/prompts'                     // B3
import { generatedReportRoutes } from './routes/generated-reports'  // B3
import { catalogRoutes } from './routes/catalog'                    // B3
import { choreRoutes } from './routes/chores'
import { householdRoutes } from './routes/household'
import { assignmentRoutes } from './routes/assignments'
import { rotationRoutes } from './routes/rotations'
import { completionRoutes } from './routes/completions'
import { onboardingRoutes } from './routes/onboarding'
import { rewardRoutes } from './routes/rewards'
import { goalRoutes } from './routes/goals'
import { settlementRoutes } from './routes/settlements'
import { shoppingRoutes } from './routes/shopping'
import { quickTaskRoutes } from './routes/quick-tasks'
import { pollRoutes } from './routes/polls'
import { announcementRoutes } from './routes/announcements'
import { commentRoutes } from './routes/comments'
import { challengeRoutes } from './routes/challenges'
import { competitionRoutes } from './routes/competitions'
import { giftRoutes } from './routes/gifts'
import { badgeRoutes } from './routes/badges'
import { fairnessRoutes } from './routes/fairness'
import { reportRoutes } from './routes/reports'
import { requestRoutes } from './routes/requests'
import { activityRoutes } from './routes/activity'
import { mealRoutes } from './routes/meals'
import { devHealth } from './routes/dev-health'
import { EMAIL_PREVIEWS } from './email/templates'
import { injectSeo } from './seo'

/**
 * Cloudflare Worker entry — the API + the static SPA host.
 *
 * Bindings/secrets live in worker/env.ts (provisioned by the factory).
 * Route convention: one sub-router per concern under worker/routes/.
 */
const app = new Hono<{ Bindings: Env }>()

// Global error handler: any uncaught route error becomes ONE structured log line (visible in
// `wrangler tail` / observability) and a safe 500 — messages, stacks, and SQL never leak to
// the client.
app.onError((err, c) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'unhandled_error',
      route: c.req.path,
      method: c.req.method,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  )
  return c.json({ error: 'internal error' }, 500)
})

// Dev-only CORS: let a LOCAL web build (static dist on :4546 / Expo web on :8081) reach this
// deployed API for browser QA. NEVER fires in production — the SPA is served same-origin there, so a
// real user's requests never carry a cross-origin Origin in this allowlist. Registered before the
// auth + route handlers so it also covers /api/auth/* and the preflight OPTIONS.
const DEV_ORIGINS = new Set(['http://localhost:4546', 'http://localhost:8081', 'http://localhost:19006'])
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('origin')
  if (c.env.ENVIRONMENT === 'development' && origin && DEV_ORIGINS.has(origin)) {
    return cors({
      origin,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['set-auth-token'],
      credentials: true,
    })(c, next)
  }
  return next()
})

// gitSha/deployedAt = the deploy stamp (worker/deploy.js) — null under `wrangler dev` or a deploy
// that bypassed the wrapper; honest absence, never a fake value.
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'manyhandz',
    version: VERSION,
    gitSha: c.env.GIT_SHA ?? null,
    deployedAt: c.env.DEPLOYED_AT ?? null,
    ts: Date.now(),
  }),
)

// Version metadata for the client force-update gate: the app compares its own version against
// minAppVersion (a plain Worker var, set per deploy) and blocks usage until the store update
// lands. `version` is what's deployed here (worker/version.ts ← app.json).
app.get('/api/meta', (c) => c.json({ version: VERSION, minAppVersion: c.env.MIN_APP_VERSION ?? '0.0.0' }))

// Abuse caps on the brute-forceable auth endpoints (registered BEFORE the auth handler below so
// Hono runs them first). Better-Auth's own brute-force limiter defaults to an in-MEMORY store and
// we set no secondaryStorage, so on Workers' ephemeral isolates its counters reset constantly —
// useless. The KV rateLimit() middleware (keyed per cf-connecting-ip for anonymous callers) is the
// real throttle. Scoped to the SENSITIVE POSTs only — /api/auth/get-session polling stays uncapped.
app.use('/api/auth/sign-in/*', rateLimit('auth', { limit: 20, windowSeconds: 300 }))
app.use('/api/auth/sign-up/*', rateLimit('auth', { limit: 10, windowSeconds: 300 }))
app.use('/api/auth/forget-password', rateLimit('auth', { limit: 10, windowSeconds: 300 }))
app.use('/api/auth/request-password-reset', rateLimit('auth', { limit: 10, windowSeconds: 300 }))
app.use('/api/auth/reset-password', rateLimit('auth', { limit: 10, windowSeconds: 300 }))
app.use('/api/auth/reset-password/*', rateLimit('auth', { limit: 10, windowSeconds: 300 }))

// Better-Auth owns all /api/auth/* routes: sign-in/up, OAuth callbacks, passkey, session.
app.on(['GET', 'POST'], '/api/auth/*', (c) => getAuth(c.env).handler(c.req.raw))

// Example protected route — the canonical "is there a session?" guard.
app.get('/api/me', async (c) => {
  const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  return c.json(session)
})

// Dev-surface auth (A2): when ADMIN_METRICS_TOKEN is set, /api/dev/* requires
// 'Authorization: Bearer ADMIN_METRICS_TOKEN' in EVERY environment (this worker commits
// ENVIRONMENT=development in wrangler.toml, so the token must not defer to it); unset keeps
// today's behavior (each route 404s outside ENVIRONMENT=development). Registered BEFORE the handlers.
app.use('/api/dev/*', devAuth)

// Dev-only: preview email templates as HTML in a browser, e.g. /api/dev/email/reset
// (templates: reset · verify · welcome · invite). 404s in production — the rendered shell is
// a pixel-perfect phishing template, so it only serves when ENVIRONMENT=development is set.
app.get('/api/dev/email/:template', (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'not found' }, 404)
  const tpl = EMAIL_PREVIEWS[c.req.param('template')] ?? EMAIL_PREVIEWS.welcome
  return c.html(tpl.html)
})

// Dev-only: deep functional health probe — secret-value integrity (catches BOM/whitespace
// corruption a presence check can't) + live Stripe/Google checks. The runtime counterpart to
// /api/health; the readiness doctor consumes it. 404s in production. See routes/dev-health.ts.
app.get('/api/dev/health', devHealth)

// Abuse caps on the expensive route groups (registered BEFORE the mounts so they run first).
// Sizing: generous for a human, ruinous for a script — see worker/middleware/rate-limit.ts.
app.use('/api/ai/*', rateLimit('ai', { limit: 30, windowSeconds: 300 }))
app.use('/api/voice/*', rateLimit('voice', { limit: 30, windowSeconds: 300 }))
app.use('/api/image/*', rateLimit('image', { limit: 15, windowSeconds: 300 }))
// Moderation writes are cheap to spam — capped per route (NOT /api/organizations/* wholesale,
// which would throttle notification reads). Blocks get more headroom: block/unblock churn is a
// legitimate safety flow; report floods are not.
app.use('/api/organizations/:orgId/reports', rateLimit('reports', { limit: 20, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/blocks', rateLimit('blocks', { limit: 60, windowSeconds: 300 }))
// The unblock path has its own :param segment — the exact pattern above doesn't cover it.
app.use('/api/organizations/:orgId/blocks/:blockedUserId', rateLimit('blocks', { limit: 60, windowSeconds: 300 }))
// Referrals: create + redeem share one cap — writes are cheap, but uncapped redeems invite code
// enumeration and uncapped creates invite table bloat. 10 per 5 min is plenty for a human.
app.use('/api/referrals/*', rateLimit('referrals', { limit: 10, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/chat/threads/:threadId/messages', rateLimit('chat', { limit: 30, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/messages', rateLimit('messages', { limit: 150, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/messages/read', rateLimit('messages-read', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/bookmarks', rateLimit('bookmarks', { limit: 120, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/events', rateLimit('events', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/events/:id', rateLimit('events', { limit: 60, windowSeconds: 300 }))
// ManyHandz — chore library writes (create/edit/delete are mutating; reads are uncapped).
app.use('/api/organizations/:orgId/chores', rateLimit('chores', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/chores/:choreId', rateLimit('chores', { limit: 60, windowSeconds: 300 }))
// Member profile/role writes (the household GET/members reads stay uncapped — useHouseholdMode polls them).
app.use('/api/organizations/:orgId/members/:memberId', rateLimit('members-write', { limit: 30, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/assignments/:assignmentId/complete', rateLimit('completions', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/completions/:id/approve', rateLimit('approvals', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/completions/:id/reject', rateLimit('approvals', { limit: 60, windowSeconds: 300 }))
// Join-by-code is an enumeration surface — cap it (also covers /lookup).
app.use('/api/households/*', rateLimit('onboarding', { limit: 20, windowSeconds: 300 }))
// Point-moving writes (the abuse-sensitive ones across the breadth resources).
app.use('/api/organizations/:orgId/rewards/:rewardId/redeem', rateLimit('rewards-redeem', { limit: 20, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/goals/:goalId/contribute', rateLimit('goal-contribute', { limit: 30, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/gifts', rateLimit('gifts', { limit: 20, windowSeconds: 300 }))
app.use('/api/users/*', rateLimit('users-public', { limit: 120, windowSeconds: 300 }))
// Cycle-6 audit: every mutating group gets a cap — paid R2 writes, push fan-out, unbounded
// inserts, Stripe session creation, thread-create spam, streak-row creation, notification
// read-marking (the ids array reaches inArray), and prefs writes.
app.use('/api/media/*', rateLimit('media', { limit: 30, windowSeconds: 300 }))
app.use('/api/push/*', rateLimit('push', { limit: 30, windowSeconds: 300 }))
app.use('/api/feedback', rateLimit('feedback', { limit: 10, windowSeconds: 300 }))
app.use('/api/stripe/checkout', rateLimit('stripe-write', { limit: 10, windowSeconds: 300 }))
app.use('/api/stripe/portal', rateLimit('stripe-write', { limit: 10, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/chat/threads', rateLimit('chat-threads', { limit: 30, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/chat/threads/:threadId', rateLimit('chat-threads', { limit: 30, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/streaks/:kind/check-in', rateLimit('streaks', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/notifications/read', rateLimit('notifications-write', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/notifications/read-all', rateLimit('notifications-write', { limit: 60, windowSeconds: 300 }))
app.use('/api/user/settings', rateLimit('settings', { limit: 60, windowSeconds: 300 }))
// Integrations: OAuth authorize/disconnect churn (the callback is provider-initiated, browser-rate).
app.use('/api/integrations/*', rateLimit('integrations', { limit: 30, windowSeconds: 300 }))
// 2026-07-05 harvest caps. Reminder: '/*' does NOT match the zero-segment base path.
app.use('/api/admin/*', rateLimit('admin', { limit: 30, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/subjects', rateLimit('subjects', { limit: 120, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/subjects/*', rateLimit('subjects', { limit: 120, windowSeconds: 300 }))
// Public, account-less surface — tight cap blunts code-guessing (codes are 32^10; defense in depth).
app.use('/api/grant/*', rateLimit('grant-public', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/grants', rateLimit('grants', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/grants/*', rateLimit('grants', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/escalations', rateLimit('escalations', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/escalations/*', rateLimit('escalations', { limit: 60, windowSeconds: 300 }))
// Export is expensive (full-org serialization) — deliberately the tightest cap in the file.
app.use('/api/organizations/:orgId/export', rateLimit('export', { limit: 5, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/prompts', rateLimit('prompts', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/prompts/*', rateLimit('prompts', { limit: 60, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/generated-reports', rateLimit('generated-reports', { limit: 20, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/generated-reports/*', rateLimit('generated-reports', { limit: 20, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/catalog', rateLimit('catalog', { limit: 120, windowSeconds: 300 }))
app.use('/api/organizations/:orgId/catalog/*', rateLimit('catalog', { limit: 120, windowSeconds: 300 }))
// Org settings/delete is destructive and cheap to spam (B1).
app.use('/api/orgs/settings', rateLimit('org-settings', { limit: 30, windowSeconds: 300 }))
// MINOR-1: /api/billing/plans is PUBLIC and fans out to Stripe list calls — cap it.
app.use('/api/billing/plans', rateLimit('billing-plans', { limit: 60, windowSeconds: 300 }))

// AI — tiered, cost-aware (classify / reason / complex / vision), auth-gated.
app.route('/api/ai', aiRoutes)

// AI structured-extraction tools — /api/ai/extract (FAIL-CLOSED, paid) + /api/ai/advise
// (FAIL-OPEN advisory). Same /api/ai prefix, so the /api/ai/* rate cap covers them too.
app.route('/api/ai', aiToolsRoutes)

// Billing (writes) — Stripe checkout / portal (auth-gated) + webhook (signature-verified).
app.route('/api/stripe', stripeRoutes)

// Native IAP — RevenueCat server-to-server webhook (header-auth, no org middleware). Apple/Play
// purchases write per-provider subscription rows that resolveOrgEntitlement collapses with Stripe.
app.route('/api/revenuecat', revenuecatRoutes)

// Billing (reads) — subscription summary for the client's subscription hook.
app.route('/api/billing', billingRoutes)

// Voice — ElevenLabs TTS/STT proxy (auth-gated).
app.route('/api/voice', voiceRoutes)

// Image — background removal via the external rembg service (auth-gated).
app.route('/api/image', imageRoutes)

// Push — Expo push token registration + test sends via exp.host (auth-gated).
app.route('/api/push', pushRoutes)

// Media — R2-backed uploads (org-scoped); honest 501s until R2 is enabled (see wrangler.toml).
app.route('/api/media', mediaRoutes)

// Feedback — the in-app feedback channel (auth-gated).
app.route('/api/feedback', feedbackRoutes)

// Notifications — THE canonical org-scoped resource route (the golden-rule-4 reference).
app.route('/api/organizations', notificationRoutes)

// Moderation — report + block (App Store Guideline 1.2; same /api/organizations prefix).
app.route('/api/organizations', moderationRoutes)

// Engagement commons — credits (read-only), achievements, streaks: org-scoped like notifications.
app.route('/api/organizations', creditRoutes)
app.route('/api/organizations', achievementRoutes)
app.route('/api/organizations', streakRoutes)

// Archetype commons — AI chat, bookmarks, the events worked example, org messaging.
app.route('/api/organizations', chatRoutes)
app.route('/api/organizations', bookmarkRoutes)
app.route('/api/organizations', eventRoutes)
app.route('/api/organizations', messageRoutes)

// --- ManyHandz product routes (org-scoped; writes gated by the mode permission matrix) ---
app.route('/api/organizations', householdRoutes)
app.route('/api/organizations', choreRoutes)
app.route('/api/organizations', assignmentRoutes)
app.route('/api/organizations', rotationRoutes)
app.route('/api/organizations', completionRoutes)
app.route('/api/households', onboardingRoutes)
// Breadth resources (built by the feature fleet; all org-scoped under /api/organizations).
app.route('/api/organizations', rewardRoutes)
app.route('/api/organizations', goalRoutes)
app.route('/api/organizations', settlementRoutes)
app.route('/api/organizations', shoppingRoutes)
app.route('/api/organizations', quickTaskRoutes)
app.route('/api/organizations', pollRoutes)
app.route('/api/organizations', announcementRoutes)
app.route('/api/organizations', commentRoutes)
app.route('/api/organizations', challengeRoutes)
app.route('/api/organizations', competitionRoutes)
app.route('/api/organizations', giftRoutes)
app.route('/api/organizations', badgeRoutes)
app.route('/api/organizations', fairnessRoutes)
app.route('/api/organizations', reportRoutes)
app.route('/api/organizations', requestRoutes)
app.route('/api/organizations', activityRoutes)
app.route('/api/organizations', mealRoutes)

// Public user profiles — session-gated, safe fields only.
app.route('/api/users', usersRoutes)

// ── 2026-07-05 harvest modules (feature-gated at mount; each route ALSO guards internally) ──
// Criterial config reporter — ALWAYS mounted; dormant (401) until ADMIN_METRICS_TOKEN is set.
app.route('/api/admin', adminConfigRoutes)
// Org settings/delete — UNGATED (core, not feature-flagged): the capability-gated rename/delete
// path custom-vocabulary kinds need (PATCH/DELETE /api/orgs/settings — active-org, no :orgId).
app.route('/api/orgs', orgSettingsRoutes)
if (APP_CONFIG.features.subjects) app.route('/api/organizations', subjectRoutes)
if (APP_CONFIG.features.oversight) app.route('/api/organizations', oversightRoutes)
if (APP_CONFIG.features.shareGrants) {
  app.route('/api/organizations', grantRoutes)
  // Public by design — the code is the credential; mounted OUTSIDE /api/organizations so it
  // bypasses requireOrg (pet-pilot pattern; header comment in the route file explains).
  app.route('/api/grant', grantPublicRoutes)
}
if (APP_CONFIG.features.escalations) app.route('/api/organizations', escalationRoutes)
if (APP_CONFIG.features.prompts) app.route('/api/organizations', promptRoutes)
if (APP_CONFIG.features.reports) app.route('/api/organizations', generatedReportRoutes)
if (APP_CONFIG.features.catalog) app.route('/api/organizations', catalogRoutes)
if (APP_CONFIG.features.export) app.route('/api/organizations', exportRoutes)

// Public share links — anonymous token resolve (NO auth) + org-scoped mint/revoke. The token is
// the capability; the public resolve returns only the entity reference (worker/lib/share-token.ts).
app.route('/api/share', publicShareRoutes)
app.route('/api/organizations', shareRoutes)

// Realtime — WebSocket upgrade fronting the RealtimeRoom Durable Object (opt-in; answers 503 until
// REALTIME_ROOM is bound in wrangler.toml). The RealtimeRoom class is re-exported at the bottom.
app.route('/api/realtime', realtimeRoutes)

// Integrations — generic third-party OAuth connect/list/disconnect (user-scoped). The provider
// CATALOG is per-app + EMPTY by default (src/lib/config/integrations.ts), so until a mint fills it
// the list is empty + authorize 404s. Tokens are stored encrypted; the flow is CSRF-protected.
app.route('/api/integrations', integrationsRoutes)

// Referrals — user-scoped create/redeem/list (codes are cross-org by design).
app.route('/api/referrals', referralRoutes)

// User settings — user-scoped settings row (notification prefs, marketing consent, locale, timezone).
app.route('/api/user', settingsRoutes)

// Unknown API paths are a real 404 — without this they'd fall through to the SPA
// fallback below and return index.html with a misleading 200.
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

// Fallback: serve the SPA. Static-asset routing + SPA history fallback is handled
// by the [assets] config in wrangler.toml; this forwards anything the Worker sees. HTML documents
// get SEO <head> tags injected at the edge (output:'single' ignores app/+html.tsx meta — see seo.ts).
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw)
  const contentType = res.headers.get('content-type') ?? ''
  return contentType.includes('text/html') ? injectSeo(res) : res
})

/**
 * Worker entry points: `fetch` wraps the Hono app so the secrets check runs once per isolate
 * (warn-only — web assets must keep serving on a misconfigured deploy); `scheduled` is the cron
 * housekeeping handler ([triggers] in wrangler.toml → worker/cron.ts).
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    validateEnv(env)
    return app.fetch(request, env, ctx)
  },
  scheduled,
} satisfies ExportedHandler<Env>

// Realtime Durable Object — always exported so the class is available; ACTIVATED by binding it in
// wrangler.toml ([[durable_objects.bindings]] REALTIME_ROOM + [[migrations]]). Exporting an unbound
// DO class is inert, so this stays opt-in with zero cost until a mint enables realtime.
export { RealtimeRoom } from './realtime/realtime-room'
