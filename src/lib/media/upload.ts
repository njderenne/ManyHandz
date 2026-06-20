import { Platform } from 'react-native'
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy'
import { API_BASE_URL, authHeaders } from '@/lib/api/client'
import { extFromMime } from '@/lib/media/fetch'
import type { Media } from '@/lib/db/schema'

/**
 * Media upload (client) — pushes a picked/captured photo (or audio memo) to the Worker's R2-backed
 * store (worker/routes/media.ts) as multipart, returning the stored `media` row. Works on BOTH
 * native (expo-file-system `uploadAsync` streams the file from disk) and web (fetch the blob URL →
 * FormData → POST; the same-origin cookie authenticates). So a composer calls THIS on every platform
 * and never hand-rolls a web upload branch — the gap that once made a minted app ship a flaky
 * fetch+FormData copy and a "failed to upload" that was really a transport bug.
 *
 * R2 is OPTIONAL until a mint enables it (the [[r2_buckets]] block in wrangler.toml). Until then
 * the Worker answers 501 with `{ error: 'media_not_configured' }`. This module turns that one case
 * into something screens can act on cleanly:
 *
 *   - uploadMedia() throws a typed MediaNotConfiguredError (not a bare "upload failed") so a catch
 *     can branch on it and show friendly copy instead of a generic error.
 *   - isMediaConfigured() lets a screen probe ONCE on mount and hide/disable the photo button, so
 *     the user never taps into a dead end. Cache the result; the answer only changes on redeploy.
 */

/** Server-side code for the R2-disabled 501 — MUST match worker/routes/media.ts. */
export const MEDIA_NOT_CONFIGURED = 'media_not_configured'

/**
 * Thrown by uploadMedia() when the app has no R2 binding (the Worker 501'd with
 * `media_not_configured`). Distinct type so callers can `if (e instanceof MediaNotConfiguredError)`
 * and surface the friendly "photo storage isn't set up" message instead of a generic failure.
 */
export class MediaNotConfiguredError extends Error {
  constructor(message = 'Photo storage is not enabled for this app.') {
    super(message)
    this.name = 'MediaNotConfiguredError'
  }
}

/** Pull the `error` code out of a Worker JSON error body; '' if the body isn't the expected shape. */
function errorCode(body: string): string {
  try {
    return (JSON.parse(body) as { error?: string }).error ?? ''
  } catch {
    return ''
  }
}

/**
 * Upload a local image URI to the org's media store; resolves to the stored `media` row
 * (id, key, mimeType, …). Throws MediaNotConfiguredError when R2 isn't enabled, and a plain Error
 * (carrying the server's own detail when present) for any other failure. Requires a signed-in
 * session.
 */
export async function uploadMedia(uri: string, opts: { mimeType?: string } = {}): Promise<Media> {
  // Caller can pass the exact type (e.g. 'audio/mp4' for a voice memo); otherwise infer from the
  // extension. Photos: the picker re-encodes to JPEG, not PNG. Audio memos: expo-audio's
  // HIGH_QUALITY preset writes .m4a (AAC in an MP4 container) → audio/mp4, which the media route's
  // allow-list accepts.
  const ext = uri.split('.').pop()?.toLowerCase()
  const inferred =
    ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
    : ext === 'm4a' || ext === 'mp4' ? 'audio/mp4'
    : ext === 'wav' ? 'audio/wav'
    : 'image/jpeg'
  const mimeType = opts.mimeType ?? inferred

  // Web: `uploadAsync` is native-only. Fetch the picked object/blob URL into a Blob and POST it as
  // multipart; the same-origin session cookie authenticates (credentials:'include'), so callers use
  // the same uploadMedia() on web and native instead of a separate web path.
  if (Platform.OS === 'web') {
    const blob = new Blob([await (await fetch(uri)).blob()], { type: mimeType })
    const form = new FormData()
    form.append('file', blob, `upload.${extFromMime(mimeType)}`)
    const res = await fetch(`${API_BASE_URL}/api/media`, { method: 'POST', credentials: 'include', body: form })
    const body = await res.text()
    if (res.status === 201) return JSON.parse(body) as Media
    if (res.status === 501 && errorCode(body) === MEDIA_NOT_CONFIGURED) throw new MediaNotConfiguredError()
    throw new Error(errorCode(body) || `Photo upload failed (${res.status})`)
  }

  const result = await uploadAsync(`${API_BASE_URL}/api/media`, uri, {
    uploadType: FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    mimeType,
    headers: authHeaders(),
  })

  if (result.status === 201) return JSON.parse(result.body) as Media

  // 501 + the stable code = R2 isn't enabled. Branch to the typed error so the UI can be friendly.
  if (result.status === 501 && errorCode(result.body) === MEDIA_NOT_CONFIGURED) {
    throw new MediaNotConfiguredError()
  }

  // Anything else: prefer the server's own error detail (e.g. "file too large (max 25MB)") over a
  // bare status, which hides the actual cause.
  throw new Error(errorCode(result.body) || `Photo upload failed (${result.status})`)
}

/**
 * Probe whether media uploads are available (R2 enabled). Returns false when the Worker reports
 * `media_not_configured`, true otherwise. Screens call this once (e.g. in an effect or a cached
 * query) to decide whether to render the photo button at all — gating up front is kinder than
 * letting the user pick a photo and hit a wall on upload.
 *
 * Implemented with a tiny preflight POST: the route's R2 guard runs BEFORE multipart parsing, so a
 * bodyless POST returns the same 501 when disabled, and a cheap 400 ("file is required") when
 * enabled — either way we learn the binding state without uploading anything. Network errors are
 * treated as "configured" (don't hide the button over a blip; the real upload will report it).
 */
export async function isMediaConfigured(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/media`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
    })
    if (res.status !== 501) return true
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    return body?.error !== MEDIA_NOT_CONFIGURED
  } catch {
    return true
  }
}
