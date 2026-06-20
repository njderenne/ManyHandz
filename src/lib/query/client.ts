import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { APP_CONFIG } from '@/lib/config/app'

/** Shared QueryClient. Offline-friendly defaults (long gcTime so the persister has data to restore). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 1000 * 60 * 60 * 24, // 24h
      retry: 1,
      refetchOnWindowFocus: false,
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
