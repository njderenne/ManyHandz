import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'

/**
 * useIntegrations — the client surface for third-party OAuth connections (wearables, calendars, …).
 * USER-scoped (an OAuth grant is per-person, not per-org), so the key is a flat ['integrations'] —
 * NOT org-prefixed like useNotifications. Talks to the generic engine at /api/integrations
 * (worker/routes/integrations.ts); the provider catalog is per-app + empty by default
 * (src/lib/config/integrations.ts), so `configurable` is [] until a mint fills OAUTH_PROVIDERS.
 *
 * The CONNECT flow is a redirect, not a fetch: `connect(provider)` asks the Worker for a signed
 * authorize URL, then the caller opens it in the system browser / an auth session
 * (expo-web-browser's openAuthSessionAsync, or Linking.openURL on web). The provider redirects back
 * to /api/integrations/:provider/callback, which stores the encrypted token and deep-links into the
 * app; the screen then invalidates this query to show the new connection.
 */

/** One connected provider as GET /api/integrations returns it (dates arrive as ISO strings). */
export interface ConnectedIntegration {
  provider: string
  expiresAt: string | null
  lastUsedAt: string | null
  lastSyncedAt: string | null
  createdAt: string
}

/** GET /api/integrations payload: the caller's connections + which catalog providers are connectable. */
export interface IntegrationsState {
  connected: ConnectedIntegration[]
  /** Catalog providers whose env secrets are present on this deploy (the rest are greyed out). */
  configurable: string[]
}

export function useIntegrations() {
  return useQuery({
    queryKey: queryKeys.integrations,
    queryFn: () => apiFetch<IntegrationsState>('/api/integrations'),
  })
}

/**
 * Request the OAuth authorize URL for `provider`. Returns `{ url }`; the CALLER opens it (browser /
 * auth session) — this hook deliberately doesn't navigate, so the screen controls the UX (and can
 * invalidate `useIntegrations` when the auth session resolves). A 402/501 from the Worker surfaces as
 * an ApiError (provider not configured, or a per-app tier gate if the app added one).
 */
export function useConnectIntegration() {
  return useMutation({
    mutationFn: (provider: string) =>
      apiFetch<{ url: string }>(`/api/integrations/${provider}/authorize`, { method: 'POST' }),
  })
}

/** Disconnect `provider` (best-effort provider-side revoke + mark our row revoked), then refetch. */
export function useDisconnectIntegration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (provider: string) =>
      apiFetch<{ ok: boolean }>(`/api/integrations/${provider}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.integrations }),
  })
}
