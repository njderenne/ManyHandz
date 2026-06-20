import { Platform } from 'react-native'
import { authClient } from '@/lib/auth/client'
import { API_BASE_URL } from './base-url'

export { API_BASE_URL } from './base-url'

/**
 * Typed fetch wrapper for the Worker API. All client→server calls go through here so error
 * handling, JSON parsing, the base URL, and session auth live in one place.
 *
 * Auth: on web the browser sends the session cookie automatically (`credentials: include`). On
 * native there's no cookie jar, so we forward the Better-Auth Expo session via the `Cookie` header
 * (`authClient.getCookie()`), which the Worker reads in `getSession`. This is what makes the
 * auth-gated routes (/api/me, /api/ai, /api/stripe, /api/voice, /api/image) work on device.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /**
   * Retry semantics by status class: 5xx and 429 are transient (retry with backoff); other 4xx
   * are the caller's bug or state — retrying just repeats the failure. Query/mutation layers and
   * ad-hoc callers should consult this instead of re-deriving status math.
   */
  get shouldRetry(): boolean {
    return this.status >= 500 || this.status === 429
  }

  /** True for auth failures — callers should re-authenticate, not retry. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }
}

/** Session header for authenticated requests (native: forward the stored cookie; web: none needed). */
export function authHeaders(): Record<string, string> {
  const cookie = Platform.OS === 'web' ? undefined : authClient.getCookie?.()
  return cookie ? { Cookie: cookie } : {}
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`

  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...init?.headers,
    },
  })

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await res.json() : await res.text()

  if (!res.ok) {
    const message =
      (isJson && body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : null) ?? res.statusText
    throw new ApiError(res.status, message, body)
  }

  return body as T
}
