import { File, Paths } from 'expo-file-system'
import { API_BASE_URL, authHeaders } from '@/lib/api/client'

/**
 * Fetch a SAVED media object (photo, etc.) into a cached local file and return its `file://` uri.
 *
 * `GET /api/media/:id` is AUTH-GATED, so a bare remote URL in <Image>/`<a>` can't load it — the
 * image request carries no session (and on iOS a 401 gets silently disk-cached against the URL, so
 * it stays broken even once auth is available). This fetches the bytes WITH the session
 * (`authHeaders()` + `credentials:'include'`), writes them to the cache, and hands back a local uri
 * any image/audio view can render directly. Re-fetches of the same id hit the on-disk cache.
 *
 * The audio sibling is `fetchMemoFile` (src/lib/native/audio.ts) — same pattern, fixed `.m4a`. For
 * photos, use this via <MediaImage> rather than hand-rolling `{ uri, headers }` on expo-image.
 * Requires a signed-in session; throws on a non-2xx.
 *
 * `ext` is ONLY the cache-file suffix (derive it from the row's mimeType with `extFromMime`) — the
 * bytes are decoded by content, so it need not be exact.
 */
export async function fetchMediaFile(mediaId: string, ext: string): Promise<string> {
  const file = new File(Paths.cache, `media-${mediaId}.${ext}`)
  if (!file.exists) {
    const res = await fetch(`${API_BASE_URL}/api/media/${mediaId}`, {
      credentials: 'include',
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error(`media fetch failed (${res.status})`)
    file.write(new Uint8Array(await res.arrayBuffer()))
  }
  return file.uri
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
}

/** mimeType → a sensible cache-file extension (jpg/png/…); falls back to the subtype, then 'bin'. */
export function extFromMime(mimeType: string): string {
  return EXT_BY_MIME[mimeType] ?? (mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin')
}
