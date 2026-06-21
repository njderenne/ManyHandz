import { Hono } from 'hono'
import { validateEnv, type Env } from './env'
import { getAuth } from './auth'
import { VERSION } from './version'
import { scheduled } from './cron'
import { rateLimit } from './middleware/rate-limit'
import { aiRoutes } from './routes/ai'
import { stripeRoutes } from './routes/stripe'
import { billingRoutes } from './routes/billing'
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
import { choreRoutes } from './routes/chores'
import { householdRoutes } from './routes/household'
import { assignmentRoutes } from './routes/assignments'
import { completionRoutes } from './routes/completions'
import { onboardingRoutes } from './routes/onboarding'
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

app.get('/api/health', (c) => c.json({ ok: true, service: 'manyhandz', version: VERSION, ts: Date.now() }))

// Version metadata for the client force-update gate: the app compares its own version against
// minAppVersion (a plain Worker var, set per deploy) and blocks usage until the store update
// lands. `version` is what's deployed here (worker/version.ts ← app.json).
app.get('/api/meta', (c) => c.json({ version: VERSION, minAppVersion: c.env.MIN_APP_VERSION ?? '0.0.0' }))

// Better-Auth owns all /api/auth/* routes: sign-in/up, OAuth callbacks, passkey, session.
app.on(['GET', 'POST'], '/api/auth/*', (c) => getAuth(c.env).handler(c.req.raw))

// Example protected route — the canonical "is there a session?" guard.
app.get('/api/me', async (c) => {
  const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  return c.json(session)
})

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

// AI — tiered, cost-aware (classify / reason / complex / vision), auth-gated.
app.route('/api/ai', aiRoutes)

// Billing (writes) — Stripe checkout / portal (auth-gated) + webhook (signature-verified).
app.route('/api/stripe', stripeRoutes)

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
app.route('/api/organizations', completionRoutes)
app.route('/api/households', onboardingRoutes)

// Public user profiles — session-gated, safe fields only.
app.route('/api/users', usersRoutes)

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
