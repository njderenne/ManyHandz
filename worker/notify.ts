import { eq, inArray } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'
import type { Env } from './env'

/**
 * notify() — THE server-side way to make a notification happen. Product routes and cron jobs call
 * it after a state change worth telling a user about; nothing else writes `notification` rows or
 * talks to Expo's push service directly. Two effects, each independently best-effort:
 *
 *   1. Insert an in-app `notification` row (drives the notifications screen + unread badge).
 *   2. Send an Expo push to every device the user has registered (push_token rows), carrying a
 *      data payload { kind, entityType, entityId } that the client's tap router turns into a
 *      deep link (src/lib/native/notification-router.ts).
 *
 * NEVER throws — a notification is a side effect, and a side-effect failure must not fail the
 * action that triggered it (same contract as audit() in middleware/org.ts). Failures are
 * structured-logged instead. Tokens Expo's tickets report as DeviceNotRegistered are deleted, so
 * uninstalled devices stop costing a push per event (the prune pattern).
 *
 * @example
 * // In a route, after the state change succeeds (ids come from verified context, never the client):
 * const db = getDb(c.env.DATABASE_URL)
 * await notify(db, c.env, {
 *   organizationId: orgId,
 *   userId: invite.inviterId,
 *   kind: 'invitation.accepted',
 *   title: `${session.user.name} joined your team`,
 *   entityType: 'member', // tap lands on /team — see notification-router.ts
 *   entityId: membership.id,
 * })
 */

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send'

/** Expo accepts at most 100 messages per request — fan-outs are chunked to this size. */
const EXPO_PUSH_CHUNK = 100

/** Expo push ticket — one per message, in request order (same shape as routes/push.ts). */
type ExpoPushTicket = {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

/**
 * Server-side resolver for the push opt-out — mirrors THE canonical notificationPrefs shape
 * documented in worker/routes/settings.ts (client mirror: resolveNotificationPrefs in
 * src/lib/query/hooks/useUserSettings.ts — keep all three in sync):
 *
 *   { push: { enabled: boolean }, email: { enabled: boolean, digest: boolean } }
 *
 * Same defaults as the settings route: a missing row, a missing channel, or a missing flag all
 * mean ENABLED — only an explicit `push.enabled: false` suppresses the fan-out.
 */
function pushEnabled(prefs: Record<string, unknown> | null | undefined): boolean {
  const push = prefs?.push
  if (typeof push !== 'object' || push === null || Array.isArray(push)) return true
  const enabled = (push as Record<string, unknown>).enabled
  return typeof enabled === 'boolean' ? enabled : true
}

export type NotifyInput = {
  /** Org the notification belongs to — pass the verified active org, never a client-sent id. */
  organizationId: string
  /** User being notified — owns the in-app row and receives the push on all their devices. */
  userId: string
  /** Machine-readable type, dot-namespaced: 'invitation.accepted', 'billing.payment_failed', … */
  kind: string
  title: string
  body?: string
  /** Deep-link target — what a tap opens (routed by src/lib/native/notification-router.ts). */
  entityType?: string
  entityId?: string
}

/**
 * Insert the in-app row, then fan out the push. `env` is part of the signature so call sites
 * never change when delivery grows env-dependent config (e.g. an Expo access token for push
 * security) — it is intentionally unused today.
 */
export async function notify(db: DB, env: Env, input: NotifyInput): Promise<void> {
  void env

  // 1. The in-app row — the durable record; push is an accelerant on top of it.
  try {
    await db.insert(schema.notification).values({
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.kind,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    })
  } catch (e) {
    logFailed('insert', input, e)
  }

  // 2–4. Push fan-out — best-effort; a push failure never reaches the calling route.
  try {
    await sendExpoPush(db, input)
  } catch (e) {
    logFailed('push', input, e)
  }
}

/** Steps 2–4: look up the user's device tokens, send via Expo in chunks, prune dead devices. */
async function sendExpoPush(db: DB, input: NotifyInput): Promise<void> {
  // Honor the user's stored preference BEFORE any device lookup — the in-app row (step 1) always
  // lands; push is the opt-out-able accelerant on top of it. See pushEnabled() for the defaults.
  const [settings] = await db
    .select({ notificationPrefs: schema.userSettings.notificationPrefs })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, input.userId))
    .limit(1)
  if (!pushEnabled(settings?.notificationPrefs)) {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'notify.push_skipped',
        reason: 'push_disabled_by_user',
        kind: input.kind,
        userId: input.userId,
      }),
    )
    return
  }

  const tokens = await db
    .select()
    .from(schema.pushToken)
    .where(eq(schema.pushToken.userId, input.userId))
  if (tokens.length === 0) return // no devices registered — the in-app row still landed

  const messages = tokens.map((t) => ({
    to: t.token,
    title: input.title,
    ...(input.body ? { body: input.body } : {}),
    sound: 'default',
    // The client's tap router reads this payload — keys stay in sync with notification-router.ts.
    data: {
      kind: input.kind,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  }))

  // Tokens whose ticket says DeviceNotRegistered (app uninstalled / token rotated) — prune after.
  const stale: string[] = []

  for (let i = 0; i < messages.length; i += EXPO_PUSH_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_PUSH_CHUNK)
    const res = await fetch(EXPO_PUSH_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'notify.expo_http_error',
          kind: input.kind,
          status: res.status,
          detail: (await res.text()).slice(0, 300),
        }),
      )
      continue // other chunks may still deliver
    }

    const { data } = (await res.json()) as { data?: ExpoPushTicket[] }
    // Tickets come back in request order — index j maps each ticket to the token it was sent to.
    ;(data ?? []).forEach((ticket, j) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        const to = chunk[j]?.to
        if (to) stale.push(to)
      }
    })
  }

  if (stale.length > 0) {
    await db.delete(schema.pushToken).where(inArray(schema.pushToken.token, stale))
    console.log(
      JSON.stringify({ level: 'info', event: 'notify.tokens_pruned', count: stale.length }),
    )
  }
}

/** Structured failure log — notify() never throws, so this is its only failure surface. */
function logFailed(step: 'insert' | 'push', input: NotifyInput, e: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event: `notify.${step}_failed`,
      kind: input.kind,
      organizationId: input.organizationId,
      userId: input.userId,
      message: e instanceof Error ? e.message : String(e),
    }),
  )
}
