import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { requireSession, type AuthEnv } from '../middleware/org'

/**
 * Push routes — Expo push notifications. App-layer authorization: every call requires a session,
 * and tokens are always read/written for the session user (never trusted from the client).
 *
 *   POST /api/push/register { token, platform? }
 *     Upsert an Expo push token (one row per device). Re-registering a token moves it to the
 *     current user, so a shared device always pushes to whoever signed in last.
 *
 *   POST /api/push/deregister { token }
 *     Delete this device's token for the session user (called on sign-out, so a shared device
 *     stops pushing to whoever just signed out). The delete is scoped to token AND user.
 *
 *   POST /api/push/test     { title?, body? }
 *     Send a test push to every device the caller has registered, via Expo's push service
 *     (https://exp.host — no auth needed for basic use). Returns { sent, tickets } with Expo's
 *     per-message tickets; ticket errors (e.g. DeviceNotRegistered) are surfaced in `errors`.
 */
export const pushRoutes = new Hono<AuthEnv>()

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send'

/** Expo push ticket — one per message, in request order. */
type ExpoPushTicket = {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

pushRoutes.post('/register', requireSession, async (c) => {
  const session = c.get('session')

  const { token, platform } = await c.req.json<{ token?: string; platform?: string }>()
  if (!token) return c.json({ error: 'token is required' }, 400)
  // Length caps — real Expo tokens are short; unbounded strings are a database-bloat vector.
  if (token.length > 500) return c.json({ error: 'token too long' }, 400)
  if (platform && platform.length > 100) return c.json({ error: 'platform too long' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  await db
    .insert(schema.pushToken)
    .values({ userId: session.user.id, token, platform: platform ?? null })
    .onConflictDoUpdate({
      target: schema.pushToken.token,
      set: { userId: session.user.id, platform: platform ?? null },
    })

  return c.json({ ok: true })
})

pushRoutes.post('/deregister', requireSession, async (c) => {
  const session = c.get('session')

  const { token } = await c.req.json<{ token?: string }>()
  if (!token) return c.json({ error: 'token is required' }, 400)
  if (token.length > 500) return c.json({ error: 'token too long' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  // Scoping on the WRITE too — the delete matches token AND the session user, so a caller can
  // never deregister someone else's device by guessing/replaying a token.
  await db
    .delete(schema.pushToken)
    .where(and(eq(schema.pushToken.token, token), eq(schema.pushToken.userId, session.user.id)))

  return c.json({ ok: true })
})

pushRoutes.post('/test', requireSession, async (c) => {
  const session = c.get('session')

  // Body is optional — tolerate an empty/absent JSON body.
  const { title, body } = await c.req
    .json<{ title?: string; body?: string }>()
    .catch(() => ({}) as { title?: string; body?: string })

  const db = getDb(c.env.DATABASE_URL)
  const tokens = await db
    .select()
    .from(schema.pushToken)
    .where(eq(schema.pushToken.userId, session.user.id))
  if (tokens.length === 0) {
    return c.json({ error: 'no push token registered — tap Register first' }, 400)
  }

  // Cap sizes before they reach Expo — oversized payloads breach Expo's limits mid-flight.
  const pushTitle = (title ?? 'Push works 🎉').slice(0, 200)
  const pushBody = (body ?? `Delivered to your device by the ${APP_CONFIG.name} Worker.`).slice(0, 1000)
  const messages = tokens.map((t) => ({
    to: t.token,
    title: pushTitle,
    body: pushBody,
    sound: 'default',
  }))

  const res = await fetch(EXPO_PUSH_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(messages),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    return c.json({ error: `Expo push service error (${res.status}): ${detail}` }, 502)
  }

  const { data } = (await res.json()) as { data?: ExpoPushTicket[] }
  const tickets = data ?? []
  const sent = tickets.filter((t) => t.status === 'ok').length
  const errors = tickets
    .filter((t) => t.status === 'error')
    .map((t) => t.details?.error ?? t.message ?? 'unknown error')

  return c.json({ sent, tickets, ...(errors.length ? { errors } : {}) })
})
