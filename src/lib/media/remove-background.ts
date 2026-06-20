import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy'
import { pickImage } from '@/lib/native/image-picker'
import { API_BASE_URL, authHeaders } from '@/lib/api/client'

/**
 * Background removal (client) — uploads an image to the Worker (→ external rembg / U2-Net service)
 * via a native multipart upload, and returns the transparent PNG as a data URI ready for
 * `<Image source={{ uri }} />`. Requires a signed-in session + a configured REMBG_SERVICE_URL.
 */
export async function removeBackground(uri: string): Promise<string> {
  // Declare the real type — the picker re-encodes photos to JPEG, not PNG.
  const ext = uri.split('.').pop()?.toLowerCase()
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  const result = await uploadAsync(`${API_BASE_URL}/api/image/remove-bg`, uri, {
    uploadType: FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    mimeType,
    headers: authHeaders(),
  })
  if (result.status !== 200) {
    // Show the server's own error detail (e.g. "rembg.com failed (429): …") — a bare status hides
    // the actual cause.
    let detail = ''
    try {
      detail = (JSON.parse(result.body) as { error?: string }).error ?? ''
    } catch {}
    throw new Error(detail || `Background removal failed (${result.status})`)
  }
  const data = JSON.parse(result.body) as { image?: string }
  if (!data.image) throw new Error('No image returned')
  return data.image
}

/** Pick an image from the library, then remove its background. Returns null if cancelled. */
export async function pickAndRemoveBackground(): Promise<string | null> {
  const uri = await pickImage()
  return uri ? removeBackground(uri) : null
}
