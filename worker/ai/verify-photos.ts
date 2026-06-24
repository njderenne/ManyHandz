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
  /**
   * PREFERRED: a pre-computed TEXT rubric of "what done looks like" (from describeReference). Judging
   * against text means we don't re-upload (or re-pay for) the reference IMAGE on every check.
   */
  referenceRubric?: string | null
  /** The reference "done" photo — used ONLY as a fallback when no rubric exists (costs an extra image). */
  referenceMediaId?: string | null
  /** Score (0-100) at/above which the verdict auto-approves. Default 85. */
  autoApproveThreshold?: number
  /** Score (0-100) at/below which it auto-rejects ("try again"); between the two thresholds → flagged. Default 40. */
  autoRejectThreshold?: number
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
export async function verifyPhotos(
  env: Env,
  ai: AI,
  input: VerifyInput,
): Promise<{ verdict: VerifyVerdict; usage: { inputTokens: number; outputTokens: number } } | null> {
  const after = await mediaDataUri(env, input.orgId, input.afterMediaId)
  if (!after) return null

  // Goal context: PREFER the cheap pre-computed text rubric. Only fall back to the reference IMAGE when
  // there's no rubric (older chores, or the describer hasn't run) — that path costs an extra image.
  const rubric = input.referenceRubric?.trim() || null
  const referenceImage =
    !rubric && input.referenceMediaId ? await mediaDataUri(env, input.orgId, input.referenceMediaId) : null
  const hasGoal = !!(rubric || referenceImage)

  const images: string[] = []
  const labels: string[] = []
  if (referenceImage) {
    images.push(referenceImage)
    labels.push(`Image ${images.length} is the REFERENCE — what the finished task should look like.`)
  }
  images.push(after)
  labels.push(`Image ${images.length} is the submitted AFTER photo to judge.`)

  const prompt = [
    'You are verifying whether a task was actually completed, from a photo.',
    `Task: "${input.task}"`,
    input.instructions ? `Notes: ${input.instructions}` : '',
    rubric ? `This is what "done" looks like — the standard to judge against:\n${rubric}` : '',
    labels.join('\n'),
    'Judge whether the AFTER photo shows the task genuinely done to that standard. Be lenient on photo quality, framing, and lighting; be strict about whether the actual work is complete.',
    'Reply with ONLY a JSON object — no prose, no code fences:',
    `{"score": <integer 0-100, your confidence the task is done well>, "referenceMatch": <integer 0-100${hasGoal ? '' : ' or null'}, how well it matches the goal>, "reasoning": "<one or two sentences a parent would read>"}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  // Verification uses the dedicated (cheaper by default) verify model, not the general vision tier.
  const model = ai.models.verify
  const { text: raw, usage } = await ai.vision(prompt, images, { model })
  const json = extractJson(raw)
  const score = clampScore(json?.score, 50)
  // Policy, not perception: the MODEL reports a confidence score; WE derive the bucket from the
  // household's thresholds. ≥ approve → pass; ≤ reject → "try again"; in between → a human looks.
  const approveAt = clampScore(input.autoApproveThreshold, 85)
  const rejectAt = clampScore(input.autoRejectThreshold, 40)
  const verdict: VerifyVerdict = {
    score,
    referenceMatch: hasGoal ? clampScore(json?.referenceMatch, score) : null,
    reasoning:
      typeof json?.reasoning === 'string' && json.reasoning.trim()
        ? json.reasoning.trim().slice(0, 600)
        : 'The reviewer could not produce a clear assessment.',
    decision: score >= approveAt ? 'auto_approved' : score <= rejectAt ? 'auto_rejected' : 'flagged_for_review',
    provider: ai.providerForModel(model),
    model,
  }
  return { verdict, usage }
}

/**
 * One-time "what does done look like?" — sends the REFERENCE photo to the model ONCE and returns a short
 * text rubric to STORE on the task. Verification then judges against that text (1 image per check)
 * instead of re-uploading and re-paying for the reference image every time. Regenerate when the
 * reference photo changes. Returns null if the photo can't be loaded.
 */
export async function describeReference(
  env: Env,
  ai: AI,
  input: { orgId: string; task: string; instructions?: string | null; referenceMediaId: string },
): Promise<{ rubric: string; usage: { inputTokens: number; outputTokens: number } } | null> {
  const ref = await mediaDataUri(env, input.orgId, input.referenceMediaId)
  if (!ref) return null
  const prompt = [
    `This photo shows what a COMPLETED task should look like. Task: "${input.task}".`,
    input.instructions ? `Notes: ${input.instructions}` : '',
    'Write a short, concrete checklist a reviewer can use later to judge whether another photo shows the task done — name what must be PRESENT and what must be ABSENT / clean / tidy. 2–4 short plain sentences, no preamble, no markdown.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const model = ai.models.verify
  const { text, usage } = await ai.vision(prompt, ref, { model })
  const rubric = text.trim().slice(0, 1200)
  return rubric ? { rubric, usage } : null
}
