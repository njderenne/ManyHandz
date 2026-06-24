import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import type { Env } from '../env'
import type { AI } from './index'

/**
 * Reusable AI photo verification — "does this photo show the task actually done?"
 *
 * Pure helper: it loads the org-scoped media from R2, calls the vision tier with the photo(s), and
 * returns a structured verdict. It writes NOTHING — the caller decides how to store/act on it (e.g.
 * gate points + approval on a chore completion). Works with just an AFTER photo (judged against the
 * task text) or, better, an AFTER photo PLUS a REFERENCE photo of what "done" should look like.
 *
 * Why it reads the bytes itself: the vision model (Grok) is an external service and CANNOT fetch our
 * auth-gated /api/media/:id URLs. So the Worker — which holds the R2 binding — pulls the object and
 * inlines it as a base64 data URI; the model just sees the pixels.
 */
export type VerifyDecision = 'auto_approved' | 'flagged_for_review' | 'auto_rejected'

export type VerifyVerdict = {
  /** 0-100: confidence the task is genuinely done to a reasonable standard. */
  score: number
  /** 0-100 similarity to the reference photo, or null when no reference was supplied. */
  referenceMatch: number | null
  /** One or two human-readable sentences explaining the call. */
  reasoning: string
  decision: VerifyDecision
  provider: string
  model: string
}

export type VerifyInput = {
  orgId: string
  /** What the photo should prove was done — e.g. the chore name. */
  task: string
  /** Optional extra guidance, e.g. the chore description ("dishes away, counters wiped"). */
  instructions?: string | null
  afterMediaId: string
  referenceMediaId?: string | null
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  // Chunked — String.fromCharCode(...multiMegabyteArray) overflows the call stack.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

/** Org-scoped media → a base64 data URI the vision model can read inline (null if missing/non-image). */
async function mediaDataUri(env: Env, orgId: string, mediaId: string): Promise<string | null> {
  if (!env.MEDIA) return null
  const [row] = await getDb(env.DATABASE_URL)
    .select({ key: schema.media.key, mimeType: schema.media.mimeType })
    .from(schema.media)
    .where(and(eq(schema.media.id, mediaId), eq(schema.media.organizationId, orgId)))
    .limit(1)
  if (!row || !row.mimeType.startsWith('image/')) return null
  const obj = await env.MEDIA.get(row.key)
  if (!obj) return null
  return `data:${row.mimeType};base64,${toBase64(await obj.arrayBuffer())}`
}

function extractJson(raw: string): Record<string, unknown> | null {
  // Models sometimes wrap JSON in prose or ```json fences — grab the first {...} block.
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return null
  }
}

function clampScore(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * Run the verification. Returns a verdict, or null if the after photo couldn't be loaded — the
 * caller MUST treat null as "couldn't verify" (fall back to human review), never a silent approval.
 */
export async function verifyPhotos(env: Env, ai: AI, input: VerifyInput): Promise<VerifyVerdict | null> {
  const after = await mediaDataUri(env, input.orgId, input.afterMediaId)
  if (!after) return null
  const reference = input.referenceMediaId
    ? await mediaDataUri(env, input.orgId, input.referenceMediaId)
    : null

  const images: string[] = []
  const labels: string[] = []
  if (reference) {
    images.push(reference)
    labels.push(`Image ${images.length} is the REFERENCE — what the finished task should look like.`)
  }
  images.push(after)
  labels.push(`Image ${images.length} is the submitted AFTER photo to judge.`)

  const prompt = [
    'You are verifying whether a task was actually completed, from photo(s).',
    `Task: "${input.task}"`,
    input.instructions ? `Notes: ${input.instructions}` : '',
    labels.join('\n'),
    'Judge whether the AFTER photo shows the task genuinely done to a reasonable standard. Be lenient on photo quality, framing, and lighting; be strict about whether the actual work is complete. If you genuinely cannot tell, FLAG it for a human rather than rejecting.',
    'Reply with ONLY a JSON object — no prose, no code fences:',
    '{"score": <integer 0-100, confidence the task is done well>, "referenceMatch": <integer 0-100 or null>, "reasoning": "<one or two sentences a parent would read>", "decision": "auto_approved" | "flagged_for_review" | "auto_rejected"}',
    'Use auto_approved only when it is clearly done, auto_rejected only when it is clearly NOT done, and flagged_for_review for anything in between.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const raw = await ai.vision(prompt, images)
  const json = extractJson(raw)
  const decision: VerifyDecision =
    json?.decision === 'auto_approved' || json?.decision === 'auto_rejected'
      ? json.decision
      : 'flagged_for_review'
  return {
    score: clampScore(json?.score, 50),
    referenceMatch: reference ? clampScore(json?.referenceMatch, 50) : null,
    reasoning:
      typeof json?.reasoning === 'string' && json.reasoning.trim()
        ? json.reasoning.trim().slice(0, 600)
        : 'The reviewer could not produce a clear assessment.',
    decision,
    provider: ai.providerFor('vision'),
    model: ai.models.vision,
  }
}
