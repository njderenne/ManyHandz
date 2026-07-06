import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { API_BASE_URL } from '@/lib/api/client'
import { authClient } from '@/lib/auth/client'

/**
 * useRealtime — the client side of the RealtimeRoom Durable Object (worker/realtime/realtime-room.ts).
 * A reconnecting WebSocket to a named room: every frame a peer sends is delivered here, and send()
 * fans yours out to the rest of the room. Domain-agnostic — apps define their own event payloads on
 * top of the minimal `{ type, user_id?, at? }` envelope.
 *
 *   const { status, events, lastEvent, send } = useRealtimeSocket(roomId)
 *
 * Auth over the WS: a browser sends the session cookie with the upgrade, but React Native's WebSocket
 * can't set headers — so we pass the Better-Auth session token as `?token=` (the Worker route reads
 * it, validates via getSession, forwards the upgrade to the DO). See worker/routes/realtime.ts.
 *
 * OPT-IN: the route returns 503 until the REALTIME_ROOM DO is bound in wrangler.toml — until then
 * the socket simply never opens (status stays 'connecting'/'closed'), which is harmless.
 */

/** The minimal relayed envelope. Apps widen this with their own fields. */
export type RealtimeEvent = {
  type: string
  user_id?: string
  at?: string
  [key: string]: unknown
}

export type RealtimeStatus = 'connecting' | 'open' | 'closed'

export interface RealtimeSocket<E extends RealtimeEvent = RealtimeEvent> {
  /** Connection state for the UI ("Connecting…" / "Live" / "Reconnecting…"). */
  status: RealtimeStatus
  /** Every event received, oldest→newest, capped to the last EVENT_BUFFER. */
  events: E[]
  /** The most recent event (convenience for one-shot reactions). */
  lastEvent: E | null
  /** Broadcast an event to the rest of the room. No-op while the socket isn't open. */
  send: (event: E) => void
}

/** Keep memory bounded — consumers only ever need the recent tail of events. */
const EVENT_BUFFER = 50
/** Reconnect backoff bounds (ms) — quick first retry, capped so a dead server doesn't busy-loop. */
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 15000

/**
 * Pull the Better-Auth session token for the WS auth query param. Native: the expo client stores
 * cookies as a header string ("better-auth.session_token=<v>; …"); we extract the value. Web returns
 * null and relies on the browser sending the cookie with the upgrade.
 */
function getWsToken(): string | null {
  if (Platform.OS === 'web') return null
  const cookie = authClient.getCookie?.()
  if (!cookie) return null
  const match = cookie.match(/session_token=([^;]+)/)
  return match?.[1] ?? null
}

/** Build the ws(s):// URL for a room, carrying the auth token when we have one. */
function socketUrlFor(room: string): string {
  // EXPO_PUBLIC_API_URL is absolute on native ("https://…"); empty on RN Web (same-origin).
  const base = API_BASE_URL || (Platform.OS === 'web' ? window.location.origin : '')
  const httpUrl = `${base}/api/realtime/${encodeURIComponent(room)}/ws`
  const wsUrl = httpUrl.replace(/^http/, 'ws') // http→ws, https→wss
  const token = getWsToken()
  return token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl
}

/**
 * useRealtimeSocket — opens (and auto-reconnects) a WebSocket to `room`. Pass an empty/falsy room to
 * stay disconnected (e.g. before the user has joined anything).
 */
export function useRealtimeSocket<E extends RealtimeEvent = RealtimeEvent>(
  room: string | null | undefined,
): RealtimeSocket<E> {
  const [status, setStatus] = useState<RealtimeStatus>('closed')
  const [events, setEvents] = useState<E[]>([])
  const lastEvent = events.length > 0 ? events[events.length - 1] : null

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  // Guards against a late close handler firing a reconnect after the effect has torn down.
  const closedByUsRef = useRef(false)

  useEffect(() => {
    if (!room) {
      setStatus('closed')
      return
    }
    closedByUsRef.current = false

    const clearReconnect = () => {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
    }

    const connect = () => {
      if (closedByUsRef.current) return
      setStatus('connecting')
      let ws: WebSocket
      try {
        ws = new WebSocket(socketUrlFor(room))
      } catch {
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        attemptsRef.current = 0
        setStatus('open')
      }
      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(String(e.data)) as E
          if (event && typeof event.type === 'string') {
            setEvents((prev) => [...prev, event].slice(-EVENT_BUFFER))
          }
        } catch {
          // ignore non-JSON frames
        }
      }
      ws.onerror = () => {
        // onclose follows onerror; let it drive the reconnect so we don't double-schedule.
      }
      ws.onclose = () => {
        wsRef.current = null
        if (closedByUsRef.current) {
          setStatus('closed')
          return
        }
        setStatus('connecting')
        scheduleReconnect()
      }
    }

    const scheduleReconnect = () => {
      if (closedByUsRef.current) return
      clearReconnect()
      const delay = Math.min(RECONNECT_MIN_MS * 2 ** attemptsRef.current, RECONNECT_MAX_MS)
      attemptsRef.current += 1
      reconnectRef.current = setTimeout(connect, delay)
    }

    connect()

    return () => {
      closedByUsRef.current = true
      clearReconnect()
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
        try {
          ws.close()
        } catch {
          // already closing/closed
        }
      }
      setStatus('closed')
    }
  }, [room])

  const send = useCallback((event: E) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(event))
      } catch {
        // a wedged socket will be torn down + reconnected by the close handler
      }
    }
  }, [])

  return { status, events, lastEvent, send }
}
