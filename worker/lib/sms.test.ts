import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Env } from '../env'
import { smsConfigured, sendSms, smsAllowed, recordSmsSent, smsCountKey } from './sms'
import { logApiUsage } from '../usage/log'

/**
 * Twilio SMS engine — dormancy doctrine, auth/sender resolution, the api_usage metering hook,
 * and the per-org daily spend cap (M-5). No test touches the network: fetch is stubbed, and the
 * usage ledger is mocked (its own module owns the DB write).
 */

vi.mock('../usage/log', () => ({ logApiUsage: vi.fn(async () => undefined) }))
const logApiUsageMock = vi.mocked(logApiUsage)

function env(over: Partial<Record<string, unknown>> = {}): Env {
  return {
    RATE_LIMIT: undefined, // unused by smsConfigured/sendSms
    DATABASE_URL: 'postgres://test',
    BETTER_AUTH_SECRET: 'test',
    BETTER_AUTH_URL: 'http://localhost',
    ...over,
  } as unknown as Env
}

const FULL = {
  TWILIO_ACCOUNT_SID: 'ACtest',
  TWILIO_AUTH_TOKEN: 'token',
  TWILIO_FROM_NUMBER: '+15550000000',
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  logApiUsageMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('smsConfigured', () => {
  it('needs account SID + auth + a sender — any missing leg means dormant', () => {
    expect(smsConfigured(env())).toBe(false)
    expect(smsConfigured(env({ TWILIO_ACCOUNT_SID: 'AC' }))).toBe(false)
    expect(smsConfigured(env({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't' }))).toBe(false) // no sender
    expect(smsConfigured(env({ TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+1' }))).toBe(false) // no account
    expect(smsConfigured(env(FULL))).toBe(true)
  })

  it('accepts a Messaging Service SID as the sender and an API key pair as auth', () => {
    expect(
      smsConfigured(env({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_MESSAGING_SERVICE_SID: 'MG' })),
    ).toBe(true)
    expect(
      smsConfigured(env({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_API_KEY_SID: 'SK', TWILIO_API_KEY_SECRET: 's', TWILIO_FROM_NUMBER: '+1' })),
    ).toBe(true)
    // Half an API key pair is not auth.
    expect(smsConfigured(env({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_API_KEY_SID: 'SK', TWILIO_FROM_NUMBER: '+1' }))).toBe(false)
  })
})

describe('sendSms', () => {
  it('is DORMANT without secrets: { ok:false, skipped:true }, zero network, zero metering', async () => {
    const result = await sendSms(env(), '+15551234567', 'hello')
    expect(result).toEqual({ ok: false, skipped: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logApiUsageMock).not.toHaveBeenCalled()
  })

  it('meters a successful send into the api_usage ledger, attributed to the org', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }))
    const result = await sendSms(env(FULL), '+15551234567', 'hello', { organizationId: 'org_1' })
    expect(result).toEqual({ ok: true, sid: 'SM123' })
    expect(logApiUsageMock).toHaveBeenCalledTimes(1)
    expect(logApiUsageMock.mock.calls[0][1]).toMatchObject({
      organizationId: 'org_1',
      provider: 'twilio',
      feature: 'sms',
      operation: 'send',
      inputUnits: 1,
      ok: true,
    })
  })

  it('prefers the scoped API key over the auth token for Basic auth', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 }))
    await sendSms(env({ ...FULL, TWILIO_API_KEY_SID: 'SKkey', TWILIO_API_KEY_SECRET: 'shh' }), '+1555', 'x')
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${btoa('SKkey:shh')}`)
  })

  it('returns a structured failure on a Twilio error response — never throws, never meters', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid To number', code: 21211 }), { status: 400 }),
    )
    const result = await sendSms(env(FULL), 'garbage', 'hello')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Invalid To number')
    expect(logApiUsageMock).not.toHaveBeenCalled()
  })

  it('returns a structured failure on a network error — never throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const result = await sendSms(env(FULL), '+15551234567', 'hello')
    expect(result).toEqual({ ok: false, error: 'network down' })
  })
})

describe('smsAllowed / recordSmsSent — the per-org daily cap (M-5)', () => {
  const NOW = new Date('2026-07-05T12:00:00.000Z')

  function kvEnv(kv: Map<string, string>): Env {
    return env({
      RATE_LIMIT: {
        get: async (k: string) => kv.get(k) ?? null,
        put: async (k: string, v: string) => void kv.set(k, v),
      },
    })
  }

  it('keys the counter per org per UTC day', () => {
    expect(smsCountKey('org_1', NOW)).toBe('sms:org_1:2026-07-05')
  })

  it('allows under the cap, denies AT the cap (the 11th send of a day is skipped + logged)', async () => {
    const kv = new Map<string, string>()
    expect(await smsAllowed(kvEnv(kv), 'org_1', NOW)).toBe(true) // empty counter

    kv.set('sms:org_1:2026-07-05', '9')
    expect(await smsAllowed(kvEnv(kv), 'org_1', NOW)).toBe(true) // 10th is fine

    const warn = vi.spyOn(console, 'warn')
    kv.set('sms:org_1:2026-07-05', '10')
    expect(await smsAllowed(kvEnv(kv), 'org_1', NOW)).toBe(false) // 11th is not
    expect(warn.mock.calls.some((c) => String(c[0]).includes('sms.daily_cap_hit'))).toBe(true)
    warn.mockRestore()
  })

  it('the counter is per-org and per-day — other orgs and the next UTC day start fresh', async () => {
    const kv = new Map<string, string>()
    kv.set('sms:org_1:2026-07-05', '10')
    expect(await smsAllowed(kvEnv(kv), 'org_2', NOW)).toBe(true)
    expect(await smsAllowed(kvEnv(kv), 'org_1', new Date('2026-07-06T00:00:01.000Z'))).toBe(true)
  })

  it('recordSmsSent increments best-effort', async () => {
    const kv = new Map<string, string>()
    await recordSmsSent(kvEnv(kv), 'org_1', NOW)
    await recordSmsSent(kvEnv(kv), 'org_1', NOW)
    expect(kv.get('sms:org_1:2026-07-05')).toBe('2')
  })

  it('a KV read failure fails toward allowing (bounded again on the next check)', async () => {
    const broken = env({
      RATE_LIMIT: {
        get: async () => {
          throw new Error('kv down')
        },
        put: async () => {
          throw new Error('kv down')
        },
      },
    })
    expect(await smsAllowed(broken, 'org_1', NOW)).toBe(true)
    await expect(recordSmsSent(broken, 'org_1', NOW)).resolves.toBeUndefined() // never throws
  })
})
