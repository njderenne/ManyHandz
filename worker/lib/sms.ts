import type { Env } from '../env'
import { APP_CONFIG } from '@/lib/config/app'
import { logApiUsage } from '../usage/log'

/**
 * Twilio SMS — the PAID, high-urgency fallback channel (escalation ladders, verification codes).
 *
 * DORMANT BY DEFAULT. Nothing here ever throws and nothing reaches the network until ALL of the
 * Twilio secrets are present (`smsConfigured`). An org on a fresh deploy has no TWILIO_* secrets,
 * so every call is a cheap no-op `{ ok: false, skipped: true }` — the cron sweep and any future
 * routes treat that as "SMS not available yet" and carry on.
 *
 * Going live is purely an ops action: set the three (or four) secrets and the next isolate picks
 * them up. No code change, no migration.
 *
 *   wrangler secret put TWILIO_ACCOUNT_SID
 *   wrangler secret put TWILIO_AUTH_TOKEN
 *   wrangler secret put TWILIO_FROM_NUMBER            # E.164, OR …
 *   wrangler secret put TWILIO_MESSAGING_SERVICE_SID  # … a Messaging Service SID (one of the two)
 *
 * SPEND SAFETY (M-5): this module is the first code in the fleet to actually CALL Twilio, and a
 * bad `escalationSources` registration in one backported app must not emit fleet-billed SMS per
 * open slot per tick. Two independent brakes:
 *   1. `smsAllowed(env, orgId)` — a per-org per-UTC-day KV counter capped at
 *      APP_CONFIG.safety.escalation.dailySmsCap. Consulted before EVERY ladder send.
 *   2. `smsSentAt` on the escalation row (worker/lib/escalation.ts) — one SMS per ladder, ever.
 * Successful sends are also metered into the api_usage cost ledger (provider 'twilio').
 */

export interface SendSmsResult {
  ok: boolean
  /** Twilio message SID on success. */
  sid?: string
  /** true when SMS is not configured (dormant) — NOT an error, just nothing sent. */
  skipped?: boolean
  /** Failure detail when ok=false and !skipped. */
  error?: string
}

/**
 * SMS is configured iff we have an account SID + auth AND a sender — either a From number or
 * a Messaging Service SID. With none of these set the whole feature stays dormant.
 */
export function smsConfigured(env: Env): boolean {
  // Auth is either a scoped API key (SK… + secret, preferred) or the account auth token.
  const hasAuth = Boolean((env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET) || env.TWILIO_AUTH_TOKEN)
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
      hasAuth &&
      (env.TWILIO_FROM_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID),
  )
}

/**
 * Best-effort send of a single SMS via the Twilio REST API. NEVER throws — every failure path
 * (dormant, HTTP error, network error, bad JSON) returns a structured result so callers can stay
 * fire-and-forget. Each outcome is logged as a single structured line for `wrangler tail`
 * (never the phone number or body — SMS content may carry user data).
 *
 * A successful send is metered into the api_usage ledger (feature 'sms', provider 'twilio',
 * operation 'send') — pass `opts.organizationId` so the spend attributes to the right org.
 * Failures are not metered: Twilio does not bill undelivered API rejections.
 */
export async function sendSms(
  env: Env,
  to: string,
  body: string,
  opts: { organizationId?: string | null } = {},
): Promise<SendSmsResult> {
  if (!smsConfigured(env)) {
    // Dormant — the common case until secrets are set. Quietly skip (no network, no throw).
    return { ok: false, skipped: true }
  }

  const sid = env.TWILIO_ACCOUNT_SID as string
  // Prefer a scoped, revocable API key (SK…) over the full-access auth token — Twilio's own
  // recommendation. The URL still carries the Account SID; only the Basic-auth user/pass differ.
  const authUser = env.TWILIO_API_KEY_SID || sid
  const authPass = (env.TWILIO_API_KEY_SID ? env.TWILIO_API_KEY_SECRET : env.TWILIO_AUTH_TOKEN) as string
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`

  const form = new URLSearchParams()
  form.set('To', to)
  form.set('Body', body)
  if (env.TWILIO_FROM_NUMBER) {
    form.set('From', env.TWILIO_FROM_NUMBER)
  } else if (env.TWILIO_MESSAGING_SERVICE_SID) {
    form.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID)
  }

  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        // Basic auth: base64(user:pass). btoa is available in the Workers runtime.
        Authorization: `Basic ${btoa(`${authUser}:${authPass}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })

    const json = (await res.json().catch(() => null)) as
      | { sid?: string; message?: string; code?: number }
      | null

    if (res.ok && json?.sid) {
      console.log(
        JSON.stringify({ level: 'info', event: 'sms.sent', sid: json.sid, status: res.status }),
      )
      // Meter the spend (fire-safe: logApiUsage never throws). One SMS = one billed unit.
      await logApiUsage(env, {
        organizationId: opts.organizationId ?? null,
        provider: 'twilio',
        feature: 'sms',
        operation: 'send',
        inputUnits: 1,
        ok: true,
        latencyMs: Date.now() - startedAt,
      })
      return { ok: true, sid: json.sid }
    }

    const error = json?.message ?? `twilio HTTP ${res.status}`
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'sms.send_failed',
        status: res.status,
        code: json?.code,
        message: error,
      }),
    )
    return { ok: false, error }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.warn(JSON.stringify({ level: 'warn', event: 'sms.send_error', message: error }))
    return { ok: false, error }
  }
}

// ---------------------------------------------------------------------------
// Per-org daily spend cap (M-5)
// ---------------------------------------------------------------------------

/** Keep the per-day counter alive ~36h so it always outlives its UTC day (+ slack). */
const SMS_COUNT_TTL_SECONDS = 129_600

/** KV key for an org's UTC-day send counter: `sms:{orgId}:{yyyy-mm-dd}`. */
export function smsCountKey(orgId: string, now: Date = new Date()): string {
  return `sms:${orgId}:${now.toISOString().slice(0, 10)}`
}

/** Best-effort read of today's send count. A KV hiccup reads as 0 — fail toward sending the
 *  safety text, still bounded by the cap on subsequent checks (RxMndr's proven posture). */
async function smsSentToday(env: Env, orgId: string, now: Date): Promise<number> {
  try {
    return Number((await env.RATE_LIMIT?.get(smsCountKey(orgId, now))) ?? '0') || 0
  } catch {
    return 0
  }
}

/**
 * The per-org daily spend cap, consulted before EVERY ladder send (M-5). Counted in
 * env.RATE_LIMIT KV under `sms:{orgId}:{yyyy-mm-dd}` (UTC day); the cap is
 * APP_CONFIG.safety.escalation.dailySmsCap (default 10). Over-cap ⇒ false + one structured
 * warn line per skipped attempt. A cap of 0 (or a non-finite value) turns the channel off.
 *
 * The read/increment pair (`smsAllowed` → send → `recordSmsSent`) is deliberately not atomic:
 * KV has no transactions, and a ±1 drift under concurrent crons is acceptable for a spend
 * ceiling — the counter re-converges on the next check.
 */
export async function smsAllowed(env: Env, orgId: string, now: Date = new Date()): Promise<boolean> {
  const cap = APP_CONFIG.safety.escalation.dailySmsCap
  if (!Number.isFinite(cap) || cap <= 0) return false
  const sentToday = await smsSentToday(env, orgId, now)
  if (sentToday >= cap) {
    console.warn(
      JSON.stringify({ level: 'warn', event: 'sms.daily_cap_hit', orgId, cap, sentToday }),
    )
    return false
  }
  return true
}

/**
 * The counter's write half — call once per SUCCESSFUL send. Best-effort: a KV hiccup may drift
 * the counter slightly; it must never break the cron sweep.
 */
export async function recordSmsSent(env: Env, orgId: string, now: Date = new Date()): Promise<void> {
  try {
    const sentToday = await smsSentToday(env, orgId, now)
    await env.RATE_LIMIT?.put(smsCountKey(orgId, now), String(sentToday + 1), {
      expirationTtl: SMS_COUNT_TTL_SECONDS,
    })
  } catch {
    /* KV hiccup — counter may drift slightly; never break the sweep. */
  }
}
