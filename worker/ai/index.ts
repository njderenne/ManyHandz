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
  image: 'grok-imagine-image',
}

const XAI_BASE_URL = 'https://api.x.ai/v1'

export type AIOptions = { system?: string; model?: string; maxTokens?: number }

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
    image: env.AI_IMAGE_MODEL ?? DEFAULTS.image,
  }

  const textOf = (message: Anthropic.Message): string =>
    message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

  return {
    /** Resolved model per tier (env overrides applied) — for usage logging and diagnostics. */
    models,

    /** Provider per tier — mirrors the routing above; for usage logging. */
    providerFor(tier: keyof typeof models): 'openai' | 'anthropic' | 'xai' {
      return tier === 'classify' ? 'openai' : tier === 'reason' || tier === 'complex' ? 'anthropic' : 'xai'
    },

    /** Cheap, fast labelling / extraction — OpenAI. */
    async classify(prompt: string, opts: AIOptions = {}): Promise<string> {
      const res = await oai().chat.completions.create({
        model: opts.model ?? models.classify,
        messages: [
          ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
          { role: 'user' as const, content: prompt },
        ],
      })
      return res.choices[0]?.message?.content ?? ''
    },

    /** Everyday reasoning — Claude Sonnet. */
    async reason(prompt: string, opts: AIOptions = {}): Promise<string> {
      const res = await claude().messages.create({
        model: opts.model ?? models.reason,
        max_tokens: opts.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
        ...(opts.system ? { system: opts.system } : {}),
      })
      return textOf(res)
    },

    /** Hardest reasoning — Claude Opus with adaptive thinking. */
    async reasonComplex(prompt: string, opts: AIOptions = {}): Promise<string> {
      const res = await claude().messages.create({
        model: opts.model ?? models.complex,
        max_tokens: opts.maxTokens ?? 16000,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: prompt }],
        ...(opts.system ? { system: opts.system } : {}),
      })
      return textOf(res)
    },

    /**
     * Streamed completion for the text tiers. Resolves once the provider stream is open (so
     * callers can fail fast with a real status before any bytes go out), then yields text chunks
     * as the model produces them. Thinking deltas (complex tier) are skipped — only user-visible
     * text is streamed.
     */
    async stream(
      tier: 'classify' | 'reason' | 'complex',
      prompt: string,
      opts: AIOptions = {},
    ): Promise<AsyncIterable<string>> {
      if (tier === 'classify') {
        const res = await oai().chat.completions.create({
          model: opts.model ?? models.classify,
          stream: true,
          messages: [
            ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
            { role: 'user' as const, content: prompt },
          ],
        })
        return (async function* () {
          for await (const chunk of res) {
            const text = chunk.choices[0]?.delta?.content
            if (text) yield text
          }
        })()
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
      return (async function* () {
        for await (const event of res) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield event.delta.text
          }
        }
      })()
    },

    /**
     * Image understanding — Grok. Accepts one image or several (e.g. a reference "done" photo plus
     * the submitted "after" photo for a side-by-side judgement); each becomes its own image_url part
     * in the order given, so the prompt can refer to "Image 1 / Image 2".
     */
    async vision(prompt: string, image: string | string[], opts: AIOptions = {}): Promise<string> {
      const urls = Array.isArray(image) ? image : [image]
      const res = await xai().chat.completions.create({
        model: opts.model ?? models.vision,
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
      return res.choices[0]?.message?.content ?? ''
    },

    /** Image generation — Grok. Returns the generated image URL. */
    async generateImage(prompt: string, opts: { model?: string } = {}): Promise<string | null> {
      const res = await xai().images.generate({ model: opts.model ?? models.image, prompt })
      return res.data?.[0]?.url ?? null
    },
  }
}

export type AI = ReturnType<typeof createAI>
