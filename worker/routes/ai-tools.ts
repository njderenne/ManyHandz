import { Hono } from 'hono'
import { getDb } from '@/lib/db'
import { requireSession, requireOrg, type AuthEnv } from '../middleware/org'
import { requireTier } from '../entitlements'
import { billingError } from '../billing/limits'
import { createAI } from '../ai'
import { logApiUsage } from '../usage/log'
import { validateExtraction, field, type FieldValidators } from '../lib/ai-json'

/**
 * AI structured-extraction tools — the canonical worked example of turning a model reply into typed,
 * validated JSON. Two endpoints, two failure stances:
 *
 *   POST /api/ai/extract   { prompt, image?, schema? } → { data }            (FAIL-CLOSED)
 *     Vision-or-text → JSON validated against a caller-supplied field schema. The model's output is
 *     UNTRUSTED, so every field is clamped/whitelisted/defaulted (worker/lib/ai-json.ts). A parse
 *     failure is an ERROR (422/502): a route whose result feeds a write must not invent data. PAID —
 *     gated by requireTier (the template's entitlement engine, worker/entitlements.ts).
 *
 *   POST /api/ai/advise    { content } → { sentiment, summary, flags }       (FAIL-OPEN, advisory)
 *     A non-blocking hint (the generalization of a "tone check"): ANY error — provider down, garbage
 *     reply, unparseable JSON — returns a safe NEUTRAL default so the UI never blocks on an advisory.
 *     Auth-only (a hint costs little and shouldn't sit behind a paywall).
 *
 * Both meter every call (success AND failure) into api_usage via logApiUsage, fire-and-forget on
 * executionCtx.waitUntil — metering never slows or breaks the response. Replace the prompts/schemas
 * with this app's real extraction (receipt OCR, document parse, intake form, …); the mechanism is
 * what's canonical, not the example fields.
 */
export const aiToolsRoutes = new Hono<AuthEnv>()

// ── Pattern A: FAIL-CLOSED structured extraction (the OCR/document-parse generalization) ──────────

/**
 * A field schema the CLIENT may send to shape the extraction: name → { type, optional enum, optional
 * description }. Kept deliberately small (string / number / boolean / enum) — it builds BOTH the JSON
 * shape we ask the model for AND the validators we defend the reply with, so the prompt and the
 * validation can never drift. A caller that needs richer shapes wires its own validators server-side
 * (see DEFAULT_SCHEMA) rather than widening this client-facing contract.
 */
type SchemaFieldSpec = {
  type: 'string' | 'number' | 'boolean' | 'enum'
  /** For type 'enum' — the allowed values (model output is whitelisted to these). */
  values?: string[]
  /** Optional hint shown to the model in the requested JSON shape. */
  describe?: string
}
type ExtractionSchema = Record<string, SchemaFieldSpec>

/**
 * The example schema used when the caller sends none — a generic "pull the key facts out of this"
 * extraction. Replace per app (e.g. a receipt: merchant/date/amount/category). The model returns
 * dollars/text; validators clamp + whitelist before anything is trusted.
 */
const DEFAULT_SCHEMA: ExtractionSchema = {
  title: { type: 'string', describe: 'a short title for what this is' },
  summary: { type: 'string', describe: 'one or two sentences' },
  category: { type: 'enum', values: ['document', 'receipt', 'photo', 'note', 'other'] },
  amount: { type: 'number', describe: 'a total amount if one is present, else null' },
}

const MAX_SCHEMA_FIELDS = 24

/** Validate + bound a client-supplied schema; returns null if it's malformed (→ 400). */
function parseSchema(raw: unknown): ExtractionSchema | null {
  if (raw === undefined || raw === null) return DEFAULT_SCHEMA
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length === 0 || entries.length > MAX_SCHEMA_FIELDS) return null
  const out: ExtractionSchema = {}
  for (const [name, spec] of entries) {
    if (!spec || typeof spec !== 'object') return null
    const s = spec as Record<string, unknown>
    const type = s.type
    if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'enum') return null
    if (type === 'enum') {
      if (!Array.isArray(s.values) || s.values.length === 0) return null
      if (!s.values.every((v) => typeof v === 'string')) return null
    }
    out[name] = {
      type,
      values: type === 'enum' ? (s.values as string[]).slice(0, 50) : undefined,
      describe: typeof s.describe === 'string' ? s.describe.slice(0, 200) : undefined,
    }
  }
  return out
}

/** Render the requested JSON shape into the prompt so the model returns exactly the keys we validate. */
function describeShape(schema: ExtractionSchema): string {
  const lines = Object.entries(schema).map(([name, spec]) => {
    const hint =
      spec.type === 'enum'
        ? `one of ${spec.values!.map((v) => JSON.stringify(v)).join(', ')}`
        : `a ${spec.type}${spec.describe ? ` — ${spec.describe}` : ''}`
    return `  ${JSON.stringify(name)}: <${hint}>`
  })
  return `{\n${lines.join(',\n')}\n}`
}

/** Build the per-field validators from the schema — each field is defended before it's trusted. */
function validatorsFor(schema: ExtractionSchema): FieldValidators<Record<string, unknown>> {
  const v: FieldValidators<Record<string, unknown>> = {}
  for (const [name, spec] of Object.entries(schema)) {
    if (spec.type === 'string') v[name] = (raw) => field.string(raw, { max: 2000, fallback: null })
    else if (spec.type === 'number') v[name] = (raw) => field.number(raw, { fallback: null })
    else if (spec.type === 'boolean') v[name] = (raw) => field.boolean(raw)
    else v[name] = (raw) => field.enum(raw, spec.values!, spec.values![spec.values!.length - 1])
  }
  return v
}

aiToolsRoutes.post('/extract', requireOrg, async (c) => {
  const body = await c.req
    .json<{ prompt?: unknown; image?: unknown; schema?: unknown }>()
    .catch(() => ({}) as { prompt?: unknown; image?: unknown; schema?: unknown })
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return c.json({ error: 'prompt is required' }, 400)
  if (prompt.length > 10000) return c.json({ error: 'prompt too long (max 10k chars)' }, 400)

  const image = typeof body.image === 'string' ? body.image : null
  // Vision input is optional (text-only extraction is valid). SSRF guard: accept ONLY inline data:
  // URIs — forwarding an arbitrary https:// URL would have the vision provider fetch it server-side
  // (a request-forgery primitive via the provider's egress). Clients send the bytes inline.
  if (image && !image.startsWith('data:')) {
    return c.json({ error: 'image must be a data URI' }, 400)
  }

  const schema = parseSchema(body.schema)
  if (!schema) return c.json({ error: 'invalid schema' }, 400)

  // ── THE worked example of worker/entitlements.ts ─────────────────────────────────────────────
  // Structured extraction is a paid feature: gate BEFORE spending on the model, on the org the
  // session resolved (requireOrg set `orgId` from the active org — never a client-supplied id).
  // 402 names the missing plan. A minted app that wants per-feature gating swaps this for
  // requireFeature(db, orgId, 'someFeature') once it adds the key to FEATURE_TIERS.
  const orgId = c.get('orgId')
  const gate = await requireTier(getDb(c.env.DATABASE_URL), orgId, 'STANDARD')
  // Canonical 402 envelope (BILLING §8.1) — `code` is what the client's isUpgradeError() routes
  // to /paywall?reason=tier_required; a bare { error } 402 is invisible to that routing.
  if (!gate.ok) {
    return billingError(c, { ok: false, error: gate.reason, code: 'tier_required', upgradeTier: 'STANDARD' })
  }

  const session = c.get('session')
  const ai = createAI(c.env)
  // Vision when an image is supplied, else the everyday text tier — meter against whichever ran.
  const tier = image ? ('vision' as const) : ('reason' as const)
  const meter = {
    organizationId: orgId,
    userId: session.user.id,
    feature: 'ai.extract',
    provider: ai.providerFor(tier),
    operation: ai.models[tier],
    unitKind: 'tokens',
  }
  const startedAt = Date.now()

  const instruction = `${prompt}\n\nRespond with ONLY a JSON object of this shape (no prose):\n${describeShape(
    schema,
  )}`

  let result: { text: string; usage: { inputTokens: number; outputTokens: number } }
  try {
    result = image ? await ai.vision(instruction, image) : await ai.reason(instruction)
  } catch (e) {
    c.executionCtx.waitUntil(
      logApiUsage(c.env, { ...meter, ok: false, errorCode: 'provider_error', latencyMs: Date.now() - startedAt }),
    )
    // Keep the provider's diagnostics server-side — never echo them to the caller (info disclosure).
    console.error(
      JSON.stringify({ level: 'error', event: 'ai.provider_error', feature: meter.feature, message: e instanceof Error ? e.message : String(e) }),
    )
    return c.json({ error: 'extraction failed' }, 502)
  }

  // Provider succeeded → meter the spend (we paid for the tokens regardless of parse outcome).
  c.executionCtx.waitUntil(
    logApiUsage(c.env, {
      ...meter,
      ok: true,
      inputUnits: result.usage.inputTokens,
      outputUnits: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
    }),
  )

  // FAIL-CLOSED: the model replied but we couldn't pull valid JSON out of it — error, never guess.
  const data = validateExtraction(result.text, validatorsFor(schema))
  if (!data) return c.json({ error: 'could not extract structured data' }, 422)
  return c.json({ data })
})

// ── Pattern B: FAIL-OPEN advisory (the tone-check generalization) ─────────────────────────────────

const SENTIMENTS = ['positive', 'neutral', 'negative'] as const
type Sentiment = (typeof SENTIMENTS)[number]

const ADVISE_SYSTEM = `You analyze a short piece of user text and return a non-blocking advisory.
Respond with ONLY JSON:
{"sentiment":"positive|neutral|negative","summary":"<one short sentence>","flags":["<short phrase>", ...]}
Keep it factual; never invent claims. "flags" lists anything worth the user's attention, or [].`

aiToolsRoutes.post('/advise', requireSession, async (c) => {
  const body = await c.req.json<{ content?: unknown }>().catch(() => ({}) as { content?: unknown })
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return c.json({ error: 'content is required' }, 400)
  if (content.length > 10000) return c.json({ error: 'content too long (max 10k chars)' }, 400)

  const session = c.get('session')
  const ai = createAI(c.env)
  const meter = {
    organizationId: session.session.activeOrganizationId,
    userId: session.user.id,
    feature: 'ai.advise',
    provider: ai.providerFor('reason'),
    operation: ai.models.reason,
    unitKind: 'tokens',
  }
  const startedAt = Date.now()

  // The safe default this advisory ALWAYS falls back to — a neutral verdict the UI can never block on.
  const neutral = { sentiment: 'neutral' as Sentiment, summary: '', flags: [] as string[] }

  try {
    const result = await ai.reason(content, { system: ADVISE_SYSTEM })
    c.executionCtx.waitUntil(
      logApiUsage(c.env, {
        ...meter,
        ok: true,
        inputUnits: result.usage.inputTokens,
        outputUnits: result.usage.outputTokens,
        latencyMs: Date.now() - startedAt,
      }),
    )
    // FAIL-OPEN: an unparseable reply returns the neutral default, not an error.
    const advice = validateExtraction(result.text, {
      sentiment: (raw) => field.enum(raw, SENTIMENTS, 'neutral'),
      summary: (raw) => field.string(raw, { max: 500 }),
      flags: (raw) => field.array(raw, (el) => (typeof el === 'string' ? el.slice(0, 120) : null), 6),
    })
    return c.json(advice ?? neutral)
  } catch {
    c.executionCtx.waitUntil(
      logApiUsage(c.env, { ...meter, ok: false, errorCode: 'provider_error', latencyMs: Date.now() - startedAt }),
    )
    return c.json(neutral) // advisory — a failure is never surfaced as a block
  }
})
