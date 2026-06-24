import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { Env } from '../env'

/**
 * Tiered, cost-aware AI. Cost varies *dramatically* across tiers, so each task maps to the
 * cheapest model that does it well — and every model is overridable (per call, or via env):
 *
 *   classify       → cheap + fast        (OpenAI)
 *   reason         → balanced            (Claude Sonnet)
 *   reasonComplex  → hardest reasoning   (Claude Opus, adaptive thinking)
 *   vision         → image understanding (Grok)
 *   generateImage  → image generation    (Grok)
 *
 * Worker-safe: all three SDKs run on the global fetch, no Node APIs. Keys are Worker secrets.
 * Clients are built lazily so an unset key never breaks construction — it surfaces only if that
 * tier is actually called.
 */
const DEFAULTS = {
  classify: 'gpt-4o-mini',
  reason: 'claude-sonnet-4-6',
  complex: 'claude-opus-4-8',
  // xAI retired the grok-2 vision/image models (Feb 2026): vision now rides the multimodal
  // grok-4 line; generation moved to the grok-imagine family.
  vision: 'grok-4.3',
  // Photo VERIFICATION defaults to the cheap multimodal model, not grok — "is this chore done" is a
  // simple visual judgement and gpt-4o-mini is ~20x cheaper per check. Override AI_VERIFY_MODEL (e.g.
  // 'grok-4.3') for higher-accuracy accounts.
  verify: 'gpt-4o-mini',
  image: 'grok-imagine-image',
}

const XAI_BASE_URL = 'https://api.x.ai/v1'

export type AIOptions = { system?: string; model?: string; maxTokens?: number }
/** Token usage from a call — feeds the api_usage cost ledger. */
export type AIUsage = { inputTokens: number; outputTokens: number }
/** A text result plus the tokens it cost. */
export type AIResult = { text: string; usage: AIUsage }

export function createAI(env: Env) {
  let anthropic: Anthropic | undefined
  let openai: OpenAI | undefined
  let grok: OpenAI | undefined
  const claude = () => (anthropic ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }))
  const oai = () => (openai ??= new OpenAI({ apiKey: env.OPENAI_API_KEY }))
  const xai = () => (grok ??= new OpenAI({ apiKey: env.XAI_API_KEY, baseURL: XAI_BASE_URL }))

  const models = {
    classify: env.AI_CLASSIFY_MODEL ?? DEFAULTS.classify,
    reason: env.AI_REASON_MODEL ?? DEFAULTS.reason,
    complex: env.AI_COMPLEX_MODEL ?? DEFAULTS.complex,
    vision: env.AI_VISION_MODEL ?? DEFAULTS.vision,
    verify: env.AI_VERIFY_MODEL ?? DEFAULTS.verify,
    image: env.AI_IMAGE_MODEL ?? DEFAULTS.image,
  }

  const textOf = (message: Anthropic.Message): string =>
    message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

  // Normalize each SDK's usage shape into { inputTokens, outputTokens } for the cost ledger.
  const oaiUsage = (u?: { prompt_tokens?: number; completion_tokens?: number } | null): AIUsage => ({
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
  })
  const claudeUsage = (u?: { input_tokens?: number; output_tokens?: number } | null): AIUsage => ({
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
  })
  // Vision/chat models are OpenAI-compatible: gpt-* → OpenAI client, anything else (grok-*) → xAI.
  const visionClient = (model: string) => (model.startsWith('gpt') ? oai() : xai())

  return {
    /** Resolved model per tier (env overrides applied) — for usage logging and diagnostics. */
    models,

    /** Provider per tier — mirrors the routing above; for usage logging. */
    providerFor(tier: keyof typeof models): 'openai' | 'anthropic' | 'xai' {
      return tier === 'classify' ? 'openai' : tier === 'reason' || tier === 'complex' ? 'anthropic' : 'xai'
    },

    /** Provider that bills a given model id — for logging a call whose model was overridden per-request. */
    providerForModel(model: string): 'openai' | 'anthropic' | 'xai' {
      return model.startsWith('claude') ? 'anthropic' : model.startsWith('grok') ? 'xai' : 'openai'
    },

    /** Cheap, fast labelling / extraction — OpenAI. */
    async classify(prompt: string, opts: AIOptions = {}): Promise<AIResult> {
      const res = await oai().chat.completions.create({
        model: opts.model ?? models.classify,
        messages: [
          ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
          { role: 'user' as const, content: prompt },
        ],
      })
      return { text: res.choices[0]?.message?.content ?? '', usage: oaiUsage(res.usage) }
    },

    /** Everyday reasoning — Claude Sonnet. */
    async reason(prompt: string, opts: AIOptions = {}): Promise<AIResult> {
      const res = await claude().messages.create({
        model: opts.model ?? models.reason,
        max_tokens: opts.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
        ...(opts.system ? { system: opts.system } : {}),
      })
      return { text: textOf(res), usage: claudeUsage(res.usage) }
    },

    /** Hardest reasoning — Claude Opus with adaptive thinking. */
    async reasonComplex(prompt: string, opts: AIOptions = {}): Promise<AIResult> {
      const res = await claude().messages.create({
        model: opts.model ?? models.complex,
        max_tokens: opts.maxTokens ?? 16000,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: prompt }],
        ...(opts.system ? { system: opts.system } : {}),
      })
      return { text: textOf(res), usage: claudeUsage(res.usage) }
    },

    /**
     * Streamed completion for the text tiers. Resolves once the provider stream is open (so callers
     * can fail fast with a real status before any bytes go out), then yields text chunks as the model
     * produces them. Returns the chunks PLUS a `usage()` getter that's valid once the stream is fully
     * consumed — for the cost ledger. Thinking deltas (complex tier) are skipped.
     */
    async stream(
      tier: 'classify' | 'reason' | 'complex',
      prompt: string,
      opts: AIOptions = {},
    ): Promise<{ chunks: AsyncIterable<string>; usage: () => AIUsage }> {
      const usage: AIUsage = { inputTokens: 0, outputTokens: 0 }
      if (tier === 'classify') {
        const res = await oai().chat.completions.create({
          model: opts.model ?? models.classify,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
            { role: 'user' as const, content: prompt },
          ],
        })
        const chunks = (async function* () {
          for await (const chunk of res) {
            if (chunk.usage) Object.assign(usage, oaiUsage(chunk.usage))
            const text = chunk.choices[0]?.delta?.content
            if (text) yield text
          }
        })()
        return { chunks, usage: () => usage }
      }

      const params: Anthropic.MessageCreateParamsStreaming = {
        model: opts.model ?? (tier === 'complex' ? models.complex : models.reason),
        max_tokens: opts.maxTokens ?? (tier === 'complex' ? 16000 : 4096),
        stream: true,
        messages: [{ role: 'user', content: prompt }],
        ...(tier === 'complex' ? { thinking: { type: 'adaptive' as const } } : {}),
        ...(opts.system ? { system: opts.system } : {}),
      }
      const res = await claude().messages.create(params)
      const chunks = (async function* () {
        for await (const event of res) {
          if (event.type === 'message_start') usage.inputTokens = event.message.usage.input_tokens
          else if (event.type === 'message_delta') usage.outputTokens = event.usage.output_tokens
          else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text
        }
      })()
      return { chunks, usage: () => usage }
    },

    /**
     * Image understanding — defaults to Grok, but routes to any OpenAI-compatible vision model
     * (e.g. gpt-4o-mini, used for the cheaper chore verifier) via `opts.model`. Accepts one image or
     * several (a reference "done" photo plus the submitted "after" photo); each becomes its own
     * image_url part in order, so the prompt can refer to "Image 1 / Image 2". Returns the token usage.
     */
    async vision(prompt: string, image: string | string[], opts: AIOptions = {}): Promise<AIResult> {
      const model = opts.model ?? models.vision
      const urls = Array.isArray(image) ? image : [image]
      const res = await visionClient(model).chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
            ],
          },
        ],
      })
      return { text: res.choices[0]?.message?.content ?? '', usage: oaiUsage(res.usage) }
    },

    /** Image generation — Grok. Returns the generated image URL. (Billed per image, not per token.) */
    async generateImage(prompt: string, opts: { model?: string } = {}): Promise<string | null> {
      const res = await xai().images.generate({ model: opts.model ?? models.image, prompt })
      return res.data?.[0]?.url ?? null
    },
  }
}

export type AI = ReturnType<typeof createAI>
