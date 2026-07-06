import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * useGrants — the share-grant layer's client half (SUBJECT_SPEC §6.7): owner-side management of
 * named, scoped, time-boxed outsider access, plus the SESSION-LESS public hooks the grant page
 * uses. Mirrors the canonical resource hook shape (useSubjects.ts): org-scoped keys, precise
 * hierarchical invalidation, feature-gated `enabled` so a flag-off app pays zero cost.
 *
 * The mint response is the ONE time `code` reaches the client — the screen shows/copies/QRs it
 * right there (list rows carry it too for re-sharing, but the mint moment is the handoff UX).
 * Server contracts: worker/routes/grants.ts (owner) + worker/routes/grant-public.ts (public).
 */

/** Owner-side wire row (worker/routes/grants.ts — the raw access_grant row, ISO timestamps). */
export type GrantDto = {
  id: string
  organizationId: string
  subjectId: string | null
  granteeName: string
  granteeEmail: string | null
  code: string
  scopes: string[]
  startsAt: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  useCount: number
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

/** Per-grant audit row — includes 'view' page loads (SUBJECT_SPEC §7 rule 5). */
export type GrantActivityDto = {
  id: string
  organizationId: string
  grantId: string
  subjectId: string | null
  action: string
  entityType: string | null
  entityId: string | null
  details: Record<string, unknown> | null
  createdAt: string
}

export type CreateGrantInput = {
  granteeName: string
  granteeEmail?: string | null
  scopes: string[]
  startsAt: string // ISO
  expiresAt: string // ISO
  /** Optional pin to ONE subject (must be an active subject of the org). */
  subjectId?: string | null
}

/** Public resolve payload (worker/routes/grant-public.ts). `view` is the app-composed allowlist. */
export type PublicGrantView = {
  status: 'active' | 'invalid' | 'not_started' | 'expired'
  granteeName?: string
  scopes?: string[]
  startsAt?: string
  expiresAt?: string
  orgName?: string | null
  view?: Record<string, unknown>
}

/** Hierarchical prefix — covers the list AND every per-grant activity key nested under it. */
const grantsPrefix = (orgId: string) => ['organizations', orgId, 'grants'] as const

/** All grants (active + past), newest first. Open at every tier — the wind-down law. */
export function useGrants(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.grants(orgId),
    queryFn: () => apiFetch<GrantDto[]>(`/api/organizations/${orgId}/grants`),
    enabled: Boolean(orgId) && APP_CONFIG.features.shareGrants,
  })
}

/** Mint a grant (grant:manage + tier-gated server-side → 402 envelope on a lapsed FREE org).
 *  The success payload carries `code` — show it to the owner immediately. */
export function useCreateGrant(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateGrantInput) =>
      apiFetch<GrantDto>(`/api/organizations/${orgId}/grants`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: grantsPrefix(orgId) }),
  })
}

/** Soft-revoke (idempotent; works at FREE forever — never trap a user with un-revokable grants). */
export function useRevokeGrant(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/grants/${id}/revoke`, {
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: grantsPrefix(orgId) }),
  })
}

/** Hard delete (cascades the per-grant audit trail). Also open at FREE — wind-down law. */
export function useDeleteGrant(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/grants/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: grantsPrefix(orgId) }),
  })
}

/** The per-grant audit trail, newest first (limit 100 server-side) — "who looked, when". */
export function useGrantActivity(orgId: string, grantId: string | null) {
  return useQuery({
    queryKey: queryKeys.organizations.grantActivity(orgId, grantId ?? 'none'),
    queryFn: () =>
      apiFetch<GrantActivityDto[]>(`/api/organizations/${orgId}/grants/${grantId}/activity`),
    enabled: Boolean(orgId) && Boolean(grantId) && APP_CONFIG.features.shareGrants,
  })
}

// ─── Public, session-less (the /grant/[code] page — the grantee has no account) ────────────────

/**
 * Resolve a grant code on the PUBLIC surface. No session, no org key — the code is the whole
 * credential, so the cache key is root-level (`publicGrant`). retry:false — a 404 here is an
 * invalid code, not a transient failure.
 */
export function usePublicGrant(code: string) {
  return useQuery({
    queryKey: queryKeys.publicGrant(code),
    queryFn: () => apiFetch<PublicGrantView>(`/api/grant/${code}`),
    enabled: Boolean(code) && APP_CONFIG.features.shareGrants,
    retry: false,
  })
}

/** Perform one grantee action (scope re-checked server-side). Refetches the public view so the
 *  grantee sees their action land. */
export function useGrantAction(code: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { action: string; subjectId?: string; details?: Record<string, unknown> }) =>
      apiFetch<{ ok: boolean }>(`/api/grant/${code}/act`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.publicGrant(code) }),
  })
}
