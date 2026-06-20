import { getDb, schema } from '@/lib/db'
import type { Env } from '../env'

/**
 * AI usage metering — one ai_usage_log row per AI call (success or failure). Powers tier quotas,
 * spend visibility, and failure auditing. Token counts are null until the AI abstraction surfaces
 * provider usage data.
 *
 * Fire-and-forget: a metering failure must never fail (or slow) the AI response itself, so wrap
 * the returned promise in ctx.waitUntil / executionCtx.waitUntil at the call site.
 */
export async function logAiUsage(
  env: Env,
  entry: {
    organizationId?: string | null
    userId?: string | null
    /** Stable feature key — 'complete' | 'stream' | 'vision' | per-app. */
    feature: string
    provider: string
    model: string
    inputTokens?: number | null
    outputTokens?: number | null
    ok: boolean
    /** 'rate_limit' | 'quota_exceeded' | 'provider_error' | 'timeout' | 'invalid_input'. */
    errorCode?: string | null
    latencyMs?: number | null
  },
): Promise<void> {
  try {
    await getDb(env.DATABASE_URL).insert(schema.aiUsageLog).values({
      organizationId: entry.organizationId ?? null,
      userId: entry.userId ?? null,
      feature: entry.feature,
      provider: entry.provider,
      model: entry.model,
      inputTokens: entry.inputTokens ?? null,
      outputTokens: entry.outputTokens ?? null,
      ok: entry.ok,
      errorCode: entry.errorCode ?? null,
      latencyMs: entry.latencyMs ?? null,
    })
  } catch (e) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'ai_usage.log_failed',
        feature: entry.feature,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
  }
}
