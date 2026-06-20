import { Platform } from 'react-native'
import { fetch as expoFetch } from 'expo/fetch'
import { ApiError, authHeaders, API_BASE_URL } from './client'

/**
 * Streamed AI completion — POSTs to /api/ai/stream and invokes `onChunk` as raw text chunks
 * arrive, so the UI can render tokens progressively instead of waiting for the full response.
 *
 * Transport: on native we use `expo/fetch` (WinterCG fetch — supports streaming response bodies,
 * unlike React Native's built-in fetch); on web the global fetch streams natively. Auth matches
 * apiFetch: `credentials: include` for the web cookie jar, plus the Better-Auth session cookie
 * header on native.
 */
export type AiTier = 'classify' | 'reason' | 'complex'

export type StreamCompletionBody = { prompt: string; tier?: AiTier; system?: string }

export async function streamCompletion(
  body: StreamCompletionBody,
  onChunk: (text: string) => void,
): Promise<void> {
  const url = `${API_BASE_URL}/api/ai/stream`
  const init = {
    method: 'POST',
    credentials: 'include' as const,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }
  const res = Platform.OS === 'web' ? await fetch(url, init) : await expoFetch(url, init)

  if (!res.ok) {
    let message = res.statusText || 'AI stream failed'
    try {
      const data = (await res.json()) as { error?: unknown }
      if (data && typeof data === 'object' && data.error != null) message = String(data.error)
    } catch {
      // non-JSON error body — keep the status text
    }
    throw new ApiError(res.status, message)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new ApiError(res.status, 'response body is not streamable')

  const decoder = new TextDecoder('utf-8')
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    if (text) onChunk(text)
  }
  const tail = decoder.decode() // flush any buffered multi-byte sequence
  if (tail) onChunk(tail)
}
