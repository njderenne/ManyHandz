import { Hono } from 'hono'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { requireSession, type AuthEnv } from '../middleware/org'
import { createMailer } from '../email/mailer'

/**
 * Feedback — the in-app feedback/support channel (app/feedback.tsx posts here). Rows land in the
 * `feedback` table AND fire a best-effort notification email to the studio support inbox so a
 * submission never silently vanishes.
 *
 *   POST /api/feedback { category?, message, appVersion?, platform? } → { ok: true }
 */
export const feedbackRoutes = new Hono<AuthEnv>()

/** Length caps — these are TEXT columns; unbounded client strings are a database-bloat vector. */
const MESSAGE_MAX = 5000
const CATEGORY_MAX = 100
const APP_VERSION_MAX = 50
const PLATFORM_MAX = 50

feedbackRoutes.post('/', requireSession, async (c) => {
  const session = c.get('session')

  const body = await c.req
    .json<{ category?: unknown; message?: unknown; appVersion?: unknown; platform?: unknown }>()
    .catch(() => null)
  if (!body || typeof body.message !== 'string' || !body.message.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }
  const { category, message, appVersion, platform } = body

  // Optional metadata must be strings (absent/null = "not provided") — wrong types are rejected
  // loudly (400), never coerced. Oversize is clipped, matching message's treatment below.
  const optional: Record<string, unknown> = { category, appVersion, platform }
  for (const [field, value] of Object.entries(optional)) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return c.json({ error: `${field} must be a string` }, 400)
    }
  }

  const row = {
    category: typeof category === 'string' ? category.trim().slice(0, CATEGORY_MAX) || null : null,
    message: message.trim().slice(0, MESSAGE_MAX),
    appVersion:
      typeof appVersion === 'string' ? appVersion.trim().slice(0, APP_VERSION_MAX) || null : null,
    platform: typeof platform === 'string' ? platform.trim().slice(0, PLATFORM_MAX) || null : null,
  }

  await getDb(c.env.DATABASE_URL).insert(schema.feedback).values({
    organizationId: session.session.activeOrganizationId ?? null,
    userId: session.user.id,
    ...row,
  })

  // Notify the studio support inbox — best-effort: a mail failure must never fail the submission
  // (mirrors notify()'s never-throw contract). Routed via Reply-To, so a reply reaches the user.
  try {
    await createMailer(c.env).sendFeedback(APP_CONFIG.support.email, {
      ...row,
      submitterName: session.user.name ?? null,
      submitterEmail: session.user.email ?? null,
    })
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'feedback.notify_failed',
        userId: session.user.id,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
  }

  return c.json({ ok: true })
})
