import { Hono } from 'hono'
import { streamText } from 'hono/streaming'
import { getDb } from '@/lib/db'
import { requireSession, requireOrg, type AuthEnv } from '../middleware/org'
import { requireTier } from '../entitlements'
import { createAI } from '../ai'
import { logAiUsage } from '../ai/usage'

/**
 * AI routes — app-layer authorization: every call requires a session. Picks the cost tier per
 * request so the client never hard-codes a model.
 *
 *   POST /api/ai/complete  { prompt, tier?, system? }
 *     tier: 'classify' (cheap OpenAI) | 'reason' (Claude Sonnet, default) | 'complex' (Claude Opus)
 *
 *   POST /api/ai/stream    { prompt, tier?, system? }
 *     Same tiers, but the response is a raw text/plain stream (no SSE framing) — chunks arrive as
 *     the model produces them. Provider failures before the first byte return a JSON error with a
 *     real status; failures mid-stream just close the stream and the client keeps what arrived.
 *
 *   POST /api/ai/vision    { image, prompt? } → { text }
 *     image: a base64 data URI (data:image/…;base64,…) or an https URL — both are valid
 *     `image_url` content parts in the OpenAI-compatible API the vision tier (Grok) speaks.
 *
 *   POST /api/ai/image     { prompt } → { url }
 *     Image generation (Grok). The template's canonical PAID feature — gated by requireTier
 *     (worker/entitlements.ts), so it doubles as the worked example of subscription gating.
 *
 * Every call (success or failure) is metered into ai_usage_log via logAiUsage — fire-and-forget
 * on executionCtx.waitUntil so metering never slows or breaks the response.
 */
export const aiRoutes = new Hono<AuthEnv>()

aiRoutes.post('/complete', requireSession, async (c) => {
  const { prompt, tier = 'reason', system } = await c.req.json<{
    prompt?: string
    tier?: 'classify' | 'reason' | 'complex'
    system?: string
  }>()
  if (!prompt) return c.json({ error: 'prompt is required' }, 400)
  // Length caps — oversized inputs breach provider limits, bloat ai_usage_log, and cost money.
  if (prompt.length > 50000) return c.json({ error: 'prompt too long (max 50k chars)' }, 400)
  if (system && system.length > 10000) return c.json({ error: 'system too long (max 10k chars)' }, 400)

  const session = c.get('session')
  const ai = createAI(c.env)
  const meter = {
    organizationId: session.session.activeOrganizationId,
    userId: session.user.id,
    feature: 'complete',
    provider: ai.providerFor(tier),
    model: ai.models[tier],
  }
  const startedAt = Date.now()

  let text: string
  try {
    text =
      tier === 'classify'
        ? await ai.classify(prompt, { system })
        : tier === 'complex'
          ? await ai.reasonComplex(prompt, { system })
          : await ai.reason(prompt, { system })
  } catch (e) {
    c.executionCtx.waitUntil(
      logAiUsage(c.env, { ...meter, ok: false, errorCode: 'provider_error', latencyMs: Date.now() - startedAt }),
    )
    return c.json({ error: e instanceof Error ? e.message : 'AI request failed' }, 502)
  }

  c.executionCtx.waitUntil(logAiUsage(c.env, { ...meter, ok: true, latencyMs: Date.now() - startedAt }))
  return c.json({ text, tier })
})

aiRoutes.post('/stream', requireSession, async (c) => {
  const { prompt, tier = 'reason', system } = await c.req.json<{
    prompt?: string
    tier?: 'classify' | 'reason' | 'complex'
    system?: string
  }>()
  if (!prompt) return c.json({ error: 'prompt is required' }, 400)
  // Length caps — same rationale as /complete.
  if (prompt.length > 50000) return c.json({ error: 'prompt too long (max 50k chars)' }, 400)
  if (system && system.length > 10000) return c.json({ error: 'system too long (max 10k chars)' }, 400)

  const session = c.get('session')
  const ai = createAI(c.env)
  const meter = {
    organizationId: session.session.activeOrganizationId,
    userId: session.user.id,
    feature: 'stream',
    provider: ai.providerFor(tier),
    model: ai.models[tier],
  }
  const startedAt = Date.now()

  let chunks: AsyncIterable<string>
  try {
    chunks = await ai.stream(tier, prompt, { system })
  } catch (e) {
    c.executionCtx.waitUntil(
      logAiUsage(c.env, { ...meter, ok: false, errorCode: 'provider_error', latencyMs: Date.now() - startedAt }),
    )
    return c.json({ error: e instanceof Error ? e.message : 'AI request failed' }, 502)
  }

  return streamText(c, async (stream) => {
    let ok = true
    try {
      for await (const chunk of chunks) await stream.write(chunk)
    } catch {
      // Upstream died mid-stream — just close; the client shows what arrived.
      ok = false
    }
    c.executionCtx.waitUntil(
      logAiUsage(c.env, {
        ...meter,
        ok,
        errorCode: ok ? null : 'provider_error',
        latencyMs: Date.now() - startedAt,
      }),
    )
  })
})

aiRoutes.post('/vision', requireSession, async (c) => {
  const { image, prompt } = await c.req.json<{ image?: string; prompt?: string }>()
  if (!image) return c.json({ error: 'image is required' }, 400)
  // The native client uploads camera shots as data URIs; web/links pass https URLs. Anything
  // else (file paths, http://) would just fail opaquely upstream — reject it with a real message.
  if (!image.startsWith('data:') && !image.startsWith('https://')) {
    return c.json({ error: 'image must be a data URI or an https URL' }, 400)
  }
  // Length cap — same rationale as /complete (prompt is optional here).
  if (prompt && prompt.length > 50000) return c.json({ error: 'prompt too long (max 50k chars)' }, 400)

  const session = c.get('session')
  const ai = createAI(c.env)
  const meter = {
    organizationId: session.session.activeOrganizationId,
    userId: session.user.id,
    feature: 'vision',
    provider: ai.providerFor('vision'),
    model: ai.models.vision,
  }
  const startedAt = Date.now()

  let text: string
  try {
    text = await ai.vision(prompt ?? 'Describe this image.', image)
  } catch (e) {
    c.executionCtx.waitUntil(
      logAiUsage(c.env, { ...meter, ok: false, errorCode: 'provider_error', latencyMs: Date.now() - startedAt }),
    )
    return c.json({ error: e instanceof Error ? e.message : 'AI request failed' }, 502)
  }

  c.executionCtx.waitUntil(logAiUsage(c.env, { ...meter, ok: true, latencyMs: Date.now() - startedAt }))
  return c.json({ text })
})

aiRoutes.post('/image', requireOrg, async (c) => {
  const { prompt } = await c.req.json<{ prompt?: string }>()
  if (!prompt) return c.json({ error: 'prompt is required' }, 400)
  // Length cap — same rationale as /complete.
  if (prompt.length > 50000) return c.json({ error: 'prompt too long (max 50k chars)' }, 400)

  // ── THE worked example of worker/entitlements.ts ─────────────────────────────────────────────
  // Image generation is the template's canonical paid feature: gate BEFORE doing the work, on the
  // org the session resolved (requireOrg set `orgId` from the active organization — never a
  // client-supplied id). 402 names the missing plan; the client mirror (TierGate / useHasTier,
  // see app/paywall.tsx) only hides buttons — this check is the authorization.
  const orgId = c.get('orgId')
  const gate = await requireTier(getDb(c.env.DATABASE_URL), orgId, 'STANDARD')
  if (!gate.ok) return c.json({ error: gate.reason }, 402)

  const session = c.get('session')
  const ai = createAI(c.env)
  const meter = {
    organizationId: orgId,
    userId: session.user.id,
    feature: 'image',
    provider: ai.providerFor('image'),
    model: ai.models.image,
  }
  const startedAt = Date.now()

  let url: string | null
  try {
    url = await ai.generateImage(prompt)
  } catch (e) {
    c.executionCtx.waitUntil(
      logAiUsage(c.env, { ...meter, ok: false, errorCode: 'provider_error', latencyMs: Date.now() - startedAt }),
    )
    return c.json({ error: e instanceof Error ? e.message : 'AI request failed' }, 502)
  }

  c.executionCtx.waitUntil(logAiUsage(c.env, { ...meter, ok: true, latencyMs: Date.now() - startedAt }))
  return c.json({ url })
})
