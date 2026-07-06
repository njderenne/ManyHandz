import { Hono } from 'hono'
import { getAuth } from '../auth'
import type { Env } from '../env'

/**
 * Realtime — the WebSocket upgrade fronting the RealtimeRoom Durable Object (worker/realtime/
 * realtime-room.ts). Mounts at /api/realtime.
 *
 *   GET /api/realtime/:room/ws — authenticate the caller, then forward the upgrade to the room DO.
 *
 * Auth on a WS upgrade: a browser sends the session cookie with the upgrade, but React Native's
 * WebSocket can't set headers — so the client passes its session token as `?token=<token>`, which we
 * validate by synthesizing a Bearer header for Better-Auth's getSession. The room DO trusts the
 * `?uid=` we hand it (it never re-authorizes).
 *
 * OPT-IN: returns 503 until the REALTIME_ROOM Durable Object is bound in wrangler.toml. ROOM-LEVEL
 * authorization (is THIS user allowed in THIS room?) is domain-specific — this generic route only
 * authenticates the user. Apps that need membership checks wrap/replace this route before the
 * forward (the proven pattern: verify a membership row, else 403).
 */
export const realtimeRoutes = new Hono<{ Bindings: Env }>()

realtimeRoutes.get('/:room/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.json({ error: 'expected websocket' }, 426)
  }
  if (!c.env.REALTIME_ROOM) {
    return c.json({ error: 'realtime not enabled' }, 503)
  }
  const room = c.req.param('room')

  // Build the headers Better-Auth will validate. Prefer the explicit ?token= (native), fall back to
  // whatever auth headers the upgrade already carries (web cookie).
  const token = c.req.query('token')
  const authHeaders = new Headers(c.req.raw.headers)
  if (token) authHeaders.set('Authorization', `Bearer ${token}`)

  const authed = await getAuth(c.env).api.getSession({ headers: authHeaders })
  if (!authed) return c.json({ error: 'unauthorized' }, 401)

  // Forward the upgrade to the room DO, keyed by the room name. The userId rides on the URL so the
  // DO can tag the socket for close-attribution; the secret token is never forwarded.
  const id = c.env.REALTIME_ROOM.idFromName(room)
  const stub = c.env.REALTIME_ROOM.get(id)
  const forwardUrl = new URL(c.req.url)
  forwardUrl.searchParams.set('uid', authed.user.id)
  forwardUrl.searchParams.delete('token')
  return stub.fetch(new Request(forwardUrl.toString(), c.req.raw))
})
