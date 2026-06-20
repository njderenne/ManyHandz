import { Hono } from 'hono'
import { requireSession, type AuthEnv } from '../middleware/org'
import { createVoice } from '../voice'

/**
 * Voice routes — auth-gated proxies to ElevenLabs.
 *   POST /api/voice/tts { text ≤5000 chars, voiceId? } → audio/mpeg
 *   POST /api/voice/stt (multipart: file=audio ≤25MB)  → { text }
 */
export const voiceRoutes = new Hono<AuthEnv>()

// ElevenLabs voice ids are short alphanumeric tokens. The id ends up in the upstream URL path
// with the secret api key attached, so anything outside this shape is rejected before it can
// steer the request (path traversal / SSRF-by-suffix).
const VOICE_ID_RE = /^[A-Za-z0-9]{1,40}$/
// Length cap — same rationale as ai.ts's prompt caps: oversized inputs breach provider limits
// and cost money (TTS bills per character).
const MAX_TTS_CHARS = 5000
// formData() already buffered the body, so this guards upstream/storage abuse, not memory.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

voiceRoutes.post('/tts', requireSession, async (c) => {
  const { text, voiceId } = await c.req
    .json<{ text?: string; voiceId?: string }>()
    .catch(() => ({}) as { text?: string; voiceId?: string })
  if (typeof text !== 'string' || text.length === 0) {
    return c.json({ error: 'text is required' }, 400)
  }
  if (text.length > MAX_TTS_CHARS) {
    return c.json({ error: 'text too long (max 5000 chars)' }, 400)
  }
  // The json<> generic is compile-time only — re-check the runtime type before the regex.
  if (voiceId != null && (typeof voiceId !== 'string' || !VOICE_ID_RE.test(voiceId))) {
    return c.json({ error: 'invalid voiceId' }, 400)
  }

  const upstream = await createVoice(c.env).tts(text, { voiceId })
  if (!upstream.ok) return c.json({ error: 'tts failed' }, 502)
  return new Response(upstream.body, {
    headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
  })
})

voiceRoutes.post('/stt', requireSession, async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ error: 'expected multipart form data' }, 400)
  const file = form.get('file')
  if (!file || typeof file === 'string') return c.json({ error: 'audio file is required' }, 400)
  if (file.size > MAX_AUDIO_BYTES) return c.json({ error: 'file too large (max 25MB)' }, 400)

  const text = await createVoice(c.env).transcribe(file)
  return c.json({ text })
})
