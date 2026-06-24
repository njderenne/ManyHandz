import { getDb, schema } from '@/lib/db'
import type { Env } from '../env'
import { estimateCostMicroUsd, unitKindFor } from './pricing'

/**
 * API cost ledger writer — one api_usage row per billable external call (AI, email, voice, image, …),
 * with the cost estimated from the rate card (pricing.ts). Captures WHO (org/user), WHAT function
 * (`feature`), WHICH provider/operation, the usage units, ok/error, and latency.
 *
 * Fire-and-forget: a metering failure must never fail (or slow) the real response — wrap the returned
 * promise in executionCtx.waitUntil at the call site. Failed calls log with cost 0 (most providers
 * don't bill errors; if a provider does, pass the units and it'll price normally).
 */
export type ApiUsageEntry = {
  organizationId?: string | null
  userId?: string | null
  /** Paid provider: 'openai' | 'anthropic' | 'xai' | 'resend' | 'elevenlabs' | 'replicate' | 'twilio' | … */
  provider: string
  /** App function that spent the money: 'chore.verify' | 'ai.complete' | 'email.invite' | 'voice.tts' | … */
  feature: string
  /** Model/endpoint billed: 'gpt-4o-mini' | 'grok-4.3' | 'send' | … (drives the rate lookup). */
  operation?: string | null
  /** AI: input tokens. Others: the billed quantity (emails / images / characters / seconds / requests). */
  inputUnits?: number | null
  /** AI: output tokens. Usually 0 for unit-billed providers. */
  outputUnits?: number | null
  /** Overrides the rate card's unit kind; otherwise inferred from provider:operation. */
  unitKind?: string | null
  ok: boolean
  errorCode?: string | null
  latencyMs?: number | null
  meta?: Record<string, unknown> | null
}

export async function logApiUsage(env: Env, entry: ApiUsageEntry): Promise<void> {
  try {
    const costMicroUsd = entry.ok
      ? estimateCostMicroUsd(entry.provider, entry.operation, entry.inputUnits ?? 0, entry.outputUnits ?? 0)
      : 0
    await getDb(env.DATABASE_URL)
      .insert(schema.apiUsage)
      .values({
        organizationId: entry.organizationId ?? null,
        userId: entry.userId ?? null,
        provider: entry.provider,
        feature: entry.feature,
        operation: entry.operation ?? null,
        inputUnits: entry.inputUnits ?? null,
        outputUnits: entry.outputUnits ?? null,
        unitKind: entry.unitKind ?? unitKindFor(entry.provider, entry.operation),
        costMicroUsd: costMicroUsd ?? null,
        ok: entry.ok,
        errorCode: entry.errorCode ?? null,
        latencyMs: entry.latencyMs ?? null,
        meta: entry.meta ?? null,
      })
  } catch (e) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'api_usage.log_failed',
        feature: entry.feature,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
  }
}
