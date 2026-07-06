import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { APP_CONFIG } from '@/lib/config/app'
import { ApiError } from '@/lib/api/client'

/**
 * Retry only TRANSIENT failures (5xx / 429 / network), never 4xx — a 400/401/403 is the caller's
 * state, retrying just repeats it. This is what makes a write survive a cold Worker isolate's first
 * request (the Neon HTTP driver can 5xx on a cold start) instead of surfacing "couldn't…" to the user.
 */
const retryTransient = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= 2) return false
  if (error instanceof ApiError) return error.shouldRetry
  return true // non-ApiError (network/parse) — give it another shot
}
const backoff = (attempt: number) => Math.min(800 * 2 ** attempt, 4000)

/** Shared QueryClient. Offline-friendly defaults (long gcTime so the persister has data to restore). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 1000 * 60 * 60 * 24, // 24h
      retry: retryTransient,
      retryDelay: backoff,
      refetchOnWindowFocus: false,
    },
    // Mutations do NOT auto-retry. A minted app's interactive create writes are typically NOT
    // idempotent (no client_id/dedup on the server), so a retry after a committed-but-lost response
    // would DOUBLE-WRITE the row. A failed mutation instead surfaces to the UI and the user re-taps
    // (a fresh, intentional action). If true idempotency is added (a client_id + UNIQUE(orgId,
    // requestId) + onConflict-return-existing), transient retry can be re-enabled safely here.
    mutations: {
      retry: false,
    },
  },
})

/**
 * AsyncStorage persister — restores the query cache on cold start for offline-first UX.
 * AsyncStorage works across iOS, Android, and RN Web.
 */
export const asyncPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: `${APP_CONFIG.shortName.toLowerCase()}-query-cache`,
})

export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 // 24h

/**
 * purgeQueryCache — drop BOTH the in-memory and the on-disk query cache. Call this whenever the
 * account changes hands (sign-out, account deletion). Without it, the persisted snapshot (24h
 * maxAge) rehydrates the previous user's data on the next account's cold start — a cross-user
 * leak on shared devices. clear() drops memory; removeClient() deletes the AsyncStorage snapshot.
 */
export async function purgeQueryCache(): Promise<void> {
  queryClient.clear()
  try {
    await asyncPersister.removeClient()
  } catch {
    // Best-effort — a storage hiccup must never surface as a failed sign-out/delete.
  }
}
