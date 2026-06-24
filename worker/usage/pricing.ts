/**
 * Provider rate card — maps `${provider}:${operation}` to a price, so logApiUsage can estimate the
 * cost of every billable call at log time. Token-billed models price per 1M tokens (in/out split);
 * everything else prices per unit (emails, characters, images, seconds, requests).
 *
 * ⚠️ These are ESTIMATES for spend-tracking, not invoices. Confirm against each provider's current
 * pricing and update here — it's the ONE place rates live. Subscription providers (Resend, ElevenLabs)
 * are approximated as a marginal per-unit cost so the ledger still attributes spend by feature.
 */
type TokenRate = { kind: 'tokens'; inputPerM: number; outputPerM: number }
type UnitRate = { kind: 'characters' | 'images' | 'seconds' | 'emails' | 'requests'; perUnit: number }
export type Rate = TokenRate | UnitRate

export const PRICING: Record<string, Rate> = {
  // ── AI · text/reasoning (per 1M tokens) ──────────────────────────────────────────────────────────
  'openai:gpt-4o-mini': { kind: 'tokens', inputPerM: 0.15, outputPerM: 0.6 },
  'anthropic:claude-sonnet-4-6': { kind: 'tokens', inputPerM: 3, outputPerM: 15 },
  'anthropic:claude-opus-4-8': { kind: 'tokens', inputPerM: 15, outputPerM: 75 },
  // ── AI · vision (multimodal text models; the provider tokenizes the image into the input count) ──
  'xai:grok-4.3': { kind: 'tokens', inputPerM: 3, outputPerM: 15 },
  // (gpt-4o-mini also serves vision — same row as above.)
  // ── AI · image generation (per image) ────────────────────────────────────────────────────────────
  'xai:grok-imagine-image': { kind: 'images', perUnit: 0.07 },
  // ── Email (Resend — subscription; marginal per-email approximation) ──────────────────────────────
  'resend:send': { kind: 'emails', perUnit: 0.0004 },
  // ── Voice (ElevenLabs — subscription; marginal approximations) ───────────────────────────────────
  'elevenlabs:tts': { kind: 'characters', perUnit: 0.00003 },
  'elevenlabs:stt': { kind: 'seconds', perUnit: 0.0001 },
  // ── Image processing ─────────────────────────────────────────────────────────────────────────────
  'replicate:rembg': { kind: 'images', perUnit: 0.002 },
  // ── SMS (Twilio — US long-code, approx) ──────────────────────────────────────────────────────────
  'twilio:sms': { kind: 'requests', perUnit: 0.0079 },
}

/** The unit kind a provider/operation bills in — for the ledger's `unit_kind`, even when no rate exists. */
export function unitKindFor(provider: string, operation: string | null | undefined): string | null {
  return PRICING[`${provider}:${operation ?? ''}`]?.kind ?? null
}

/**
 * Estimate a call's cost in MICRO-USD (millionths of a dollar). Token rates use input/output; unit
 * rates use `inputUnits` as the quantity (emails/images/characters/seconds/requests). Returns null
 * when no rate is configured — the call is still logged, just without a cost.
 */
export function estimateCostMicroUsd(
  provider: string,
  operation: string | null | undefined,
  inputUnits = 0,
  outputUnits = 0,
): number | null {
  const rate = PRICING[`${provider}:${operation ?? ''}`]
  if (!rate) return null
  if (rate.kind === 'tokens') {
    const usd = (inputUnits / 1_000_000) * rate.inputPerM + (outputUnits / 1_000_000) * rate.outputPerM
    return Math.round(usd * 1_000_000)
  }
  return Math.round(inputUnits * rate.perUnit * 1_000_000)
}
