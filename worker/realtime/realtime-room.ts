import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'

/**
 * RealtimeRoom — a domain-agnostic WebSocket fan-out hub. One Durable Object instance per room
 * (keyed by `idFromName(roomId)`): every connected client holds one socket, and any frame one client
 * sends is rebroadcast to all OTHER sockets in the same room. The generic base for live features
 * (presence, collaborative cursors, partner/spectator modes, multiplayer) — a minted app names its
 * rooms and defines its own event payloads on top.
 *
 * Design notes:
 *  - WebSocket Hibernation API: `this.ctx.acceptWebSocket(server)` instead of holding the socket in
 *    memory + addEventListener. The runtime can evict the DO between messages and rehydrate on the
 *    next frame, so an idle room costs nothing. webSocketMessage / Close / Error are the
 *    hibernation-aware handlers.
 *  - Each socket carries its `userId` in a serialized attachment, so on close we know who left and
 *    broadcast a synthetic `left` event without a DB round-trip.
 *  - The room never authorizes — the fronting Worker route (worker/routes/realtime.ts) authenticates
 *    the user BEFORE forwarding the upgrade and hands the DO a trusted `?uid=`. Apps that need
 *    room-level membership checks add them in that route.
 *  - Frames relay as-is (parse → stamp sender → restringify a lean payload), sub-100ms on flaky wifi.
 *
 * OPT-IN: bind this class in wrangler.toml ([[durable_objects.bindings]] REALTIME_ROOM +
 * [[migrations]]) to enable it; the route + client hook no-op gracefully while the binding is absent.
 */

/** A relayed frame. Apps define richer shapes; the room only needs `type` and stamps `user_id`. */
export type RealtimeEvent = {
  type: string
  user_id?: string
  at?: string
  [key: string]: unknown
}

/** Per-socket metadata persisted across hibernation via serializeAttachment. */
interface SocketAttachment {
  userId: string
}

export class RealtimeRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    // Only the WebSocket upgrade is valid here — the Worker route forwards the upgraded request.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }

    // The fronting Worker route appends ?uid=<userId> after it has authenticated the caller.
    const url = new URL(request.url)
    const userId = url.searchParams.get('uid')
    if (!userId) return new Response('missing uid', { status: 400 })

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    // Hibernation accept — the runtime owns the socket lifecycle. Tag it with the userId so
    // getWebSockets(tag) and close-attribution work after a hibernation/rehydrate.
    this.ctx.acceptWebSocket(server, [userId])
    // Attachment survives hibernation (tags can collide if a user opens two sockets; the attachment
    // is the authoritative per-socket identity for the close broadcast).
    server.serializeAttachment({ userId } satisfies SocketAttachment)

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * A client sent a frame. Parse it, stamp the authoritative sender userId (so a client can't spoof
   * another), then fan it out to every OTHER socket.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return // we only speak JSON text frames
    const senderId = this.userIdOf(ws)

    let event: RealtimeEvent
    try {
      event = JSON.parse(message) as RealtimeEvent
    } catch {
      return // ignore malformed frames rather than tearing down the socket
    }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return

    // Server stamps the trusted identity — never trust the client's user_id field for attribution.
    if (senderId) event.user_id = senderId

    this.broadcast(JSON.stringify(event), ws)
  }

  /** A socket closed cleanly — drop it and tell the room the user left. */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.announceLeft(ws)
    try {
      ws.close()
    } catch {
      // already closed — nothing to do
    }
  }

  /** A socket errored — same handling as a close (announce the departure, drop it). */
  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.announceLeft(ws)
  }

  /** Resolve a socket's userId from its attachment (preferred) or its tag (fallback). */
  private userIdOf(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null
    if (attachment?.userId) return attachment.userId
    const [tag] = this.ctx.getTags(ws)
    return tag ?? null
  }

  /** Broadcast a `left` event for the socket that just dropped (best-effort, never throws). */
  private announceLeft(ws: WebSocket): void {
    const userId = this.userIdOf(ws)
    if (!userId) return
    const event: RealtimeEvent = { type: 'left', user_id: userId, at: new Date().toISOString() }
    this.broadcast(JSON.stringify(event), ws)
  }

  /** Send `payload` to every connected socket EXCEPT `except`. */
  private broadcast(payload: string, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue
      try {
        socket.send(payload)
      } catch {
        // a wedged peer must never block the fan-out to the rest of the room
      }
    }
  }
}
