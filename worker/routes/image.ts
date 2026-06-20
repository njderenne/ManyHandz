import { Hono } from 'hono'
import type { Env } from '../env'
import { requireSession, type AuthEnv } from '../middleware/org'

/**
 * Image routes — background removal (U2-Net / rembg).
 *
 * Three providers, checked in order:
 *  1. REMBG_SERVICE_URL — your own rembg HTTP service (rembg is Python; it can't run in a Worker).
 *     Optional REMBG_API_KEY sent as a bearer token.
 *  2. REMBG_API_KEY alone — rembg.com's hosted API (x-api-key auth, multipart `image`, PNG back).
 *  3. REPLICATE_API_TOKEN — Replicate-hosted rembg (default model cjwbw/rembg, override via
 *     REPLICATE_REMBG_MODEL). Zero ops: upload → predict (sync) → fetch the output PNG.
 *
 *   POST /api/image/remove-bg (multipart: file=image) → { image: "data:image/png;base64,…" }
 */
export const imageRoutes = new Hono<AuthEnv>()

const REPLICATE_API = 'https://api.replicate.com/v1'
const DEFAULT_REMBG_MODEL = 'cjwbw/rembg'

/** Base64-encode an ArrayBuffer in chunks (avoids blowing the call stack on large images). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** Latest version id per model, cached for the isolate's lifetime (saves a lookup per request). */
const versionCache = new Map<string, string>()

async function resolveModelVersion(model: string, token: string): Promise<string> {
  const cached = versionCache.get(model)
  if (cached) return cached
  const res = await fetch(`${REPLICATE_API}/models/${model}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Replicate model lookup failed (${res.status})`)
  const data = (await res.json()) as { latest_version?: { id?: string } }
  const id = data.latest_version?.id
  if (!id) throw new Error('Replicate model has no published version')
  versionCache.set(model, id)
  return id
}

/** Run rembg on Replicate: upload the file, create a sync prediction, fetch the output PNG. */
async function replicateRemoveBg(env: Env, file: File): Promise<ArrayBuffer> {
  const token = env.REPLICATE_API_TOKEN!
  const model = env.REPLICATE_REMBG_MODEL ?? DEFAULT_REMBG_MODEL

  // 1. Upload the input image (data URIs are only for <256KB; photos are MBs).
  const upload = new FormData()
  upload.append('content', file)
  const fileRes = await fetch(`${REPLICATE_API}/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: upload,
  })
  if (!fileRes.ok) throw new Error(`Replicate file upload failed (${fileRes.status})`)
  const uploaded = (await fileRes.json()) as { urls?: { get?: string } }
  const imageUrl = uploaded.urls?.get
  if (!imageUrl) throw new Error('Replicate file upload returned no URL')

  // 2. Predict, blocking up to 60s ("Prefer: wait"); poll briefly if the model is cold-booting.
  const version = await resolveModelVersion(model, token)
  const createRes = await fetch(`${REPLICATE_API}/predictions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      prefer: 'wait',
    },
    body: JSON.stringify({ version, input: { image: imageUrl } }),
  })
  if (!createRes.ok) throw new Error(`Replicate prediction failed (${createRes.status})`)
  type Prediction = {
    status: string
    output?: string | string[]
    error?: string
    urls?: { get?: string }
  }
  let prediction = (await createRes.json()) as Prediction

  for (let i = 0; i < 10 && (prediction.status === 'starting' || prediction.status === 'processing'); i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const poll = await fetch(prediction.urls?.get ?? '', { headers: { authorization: `Bearer ${token}` } })
    if (!poll.ok) break
    prediction = (await poll.json()) as Prediction
  }
  if (prediction.status !== 'succeeded') {
    throw new Error(prediction.error ?? `Replicate prediction ${prediction.status}`)
  }

  // 3. Fetch the output PNG (output is a delivery URL — string for this model, array for some).
  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
  if (!outputUrl) throw new Error('Replicate prediction returned no output')
  const png = await fetch(outputUrl)
  if (!png.ok) throw new Error(`Fetching prediction output failed (${png.status})`)
  return png.arrayBuffer()
}

/** rembg.com's hosted API — one call: multipart image in, transparent PNG out. */
async function rembgComRemoveBg(env: Env, file: File): Promise<ArrayBuffer> {
  const form = new FormData()
  form.append('image', file)
  form.append('format', 'png')
  const res = await fetch('https://api.rembg.com/rmbg', {
    method: 'POST',
    headers: { 'x-api-key': env.REMBG_API_KEY! },
    body: form,
  })
  if (!res.ok) {
    // Surface rembg.com's own error detail — a bare status is undiagnosable from the app.
    const detail = (await res.text()).slice(0, 300)
    throw new Error(`rembg.com failed (${res.status}): ${detail}`)
  }
  return res.arrayBuffer()
}

/** Proxy to a self-hosted rembg service (FastAPI/Flask wrapper around the rembg package). */
async function serviceRemoveBg(env: Env, file: File): Promise<{ buf: ArrayBuffer; type: string }> {
  const forward = new FormData()
  forward.append('file', file)
  const upstream = await fetch(env.REMBG_SERVICE_URL!, {
    method: 'POST',
    headers: env.REMBG_API_KEY ? { authorization: `Bearer ${env.REMBG_API_KEY}` } : {},
    body: forward,
  })
  if (!upstream.ok) throw new Error(`rembg service failed (${upstream.status})`)
  return { buf: await upstream.arrayBuffer(), type: upstream.headers.get('content-type') ?? 'image/png' }
}

imageRoutes.post('/remove-bg', requireSession, async (c) => {
  if (!c.env.REMBG_SERVICE_URL && !c.env.REMBG_API_KEY && !c.env.REPLICATE_API_TOKEN) {
    return c.json(
      { error: 'background removal not configured — set REMBG_API_KEY, REMBG_SERVICE_URL, or REPLICATE_API_TOKEN' },
      501,
    )
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ error: 'expected multipart form data' }, 400)
  const file = form.get('file')
  if (!file || typeof file === 'string') return c.json({ error: 'image file is required' }, 400)

  try {
    // Return the PNG as a base64 data URI so the native client (which uploads via the file
    // system, not fetch) can render it directly without handling a binary response.
    if (c.env.REMBG_SERVICE_URL) {
      const { buf, type } = await serviceRemoveBg(c.env, file)
      return c.json({ image: `data:${type};base64,${toBase64(buf)}` })
    }
    const buf = c.env.REMBG_API_KEY
      ? await rembgComRemoveBg(c.env, file)
      : await replicateRemoveBg(c.env, file)
    return c.json({ image: `data:image/png;base64,${toBase64(buf)}` })
  } catch (e) {
    console.error('remove-bg failed:', e) // visible in `wrangler tail`
    return c.json({ error: e instanceof Error ? e.message : 'background removal failed' }, 502)
  }
})
