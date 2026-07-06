import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { CatalogItem } from '@/lib/db/schema'

/**
 * useCatalog — client side of the seeded reference catalog (worker/routes/catalog.ts): global
 * seeded rows (organizationId null, written by worker/engines/catalog-seed.ts) plus the org's
 * custom rows, one list. `organizationId === null` IS the "seeded" discriminator — render the
 * badge off it (t('catalog.seeded') / t('catalog.custom')); only custom rows are editable, and
 * the Worker enforces that regardless of what the UI shows.
 *
 * Writes are 'content:write' actions on the Worker — screens gate their buttons to match.
 * Hooks stay toast-free — screens own user feedback per call.
 */

/**
 * The shared PREFIX of every queryKeys.organizations.catalog(orgId, kind) variant — the key fn
 * appends `kind ?? 'all'`, so the variants are siblings, not prefixes of each other; mutations
 * invalidate at THIS level to sweep them all. Keep in sync with keys.ts.
 */
const catalogPrefix = (orgId: string) => ['organizations', orgId, 'catalog'] as const

/**
 * The browsable library — global ∪ org rows, name order, optionally narrowed by kind.
 * Archived customs are excluded by default; pass includeArchived for history screens.
 */
export function useCatalog(
  orgId: string,
  kind?: string,
  opts: { includeArchived?: boolean } = {},
) {
  const params = new URLSearchParams()
  if (kind) params.set('kind', kind)
  if (opts.includeArchived) params.set('includeArchived', 'true')
  const qs = params.toString()

  return useQuery({
    // includeArchived variants get their own suffixed entry (different server responses must
    // never share a cache slot — the bookmarksKey rule).
    queryKey: opts.includeArchived
      ? ([...queryKeys.organizations.catalog(orgId, kind), 'archived'] as const)
      : queryKeys.organizations.catalog(orgId, kind),
    queryFn: () =>
      apiFetch<CatalogItem[]>(`/api/organizations/${orgId}/catalog${qs ? `?${qs}` : ''}`),
    enabled: Boolean(orgId),
  })
}

export type CreateCatalogItemInput = {
  kind: string
  name: string
  /** A visible catalog row (global or own-org) — customs may nest under seeded categories. */
  parentId?: string
  data?: Record<string, unknown>
}

/** Create an org custom row. */
export function useCreateCatalogItem(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCatalogItemInput) =>
      apiFetch<CatalogItem>(`/api/organizations/${orgId}/catalog`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: catalogPrefix(orgId) }),
  })
}

export type UpdateCatalogItemInput = {
  id: string
  name?: string
  parentId?: string | null
  data?: Record<string, unknown> | null
}

/** Edit an org custom row (seeded rows 404 on the Worker — don't offer the affordance). */
export function useUpdateCatalogItem(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateCatalogItemInput) =>
      apiFetch<CatalogItem>(`/api/organizations/${orgId}/catalog/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: catalogPrefix(orgId) }),
  })
}

/** Soft-remove an org custom row — drops from active lists, history keeps resolving it. */
export function useArchiveCatalogItem(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<CatalogItem>(`/api/organizations/${orgId}/catalog/${id}/archive`, {
        method: 'POST',
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: catalogPrefix(orgId) }),
  })
}
