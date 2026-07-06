import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'

/**
 * usePrompts — client side of the prompt/nudge engine (worker/routes/prompts.ts; engine in
 * worker/engines/nudge.ts). A "track" is (org) or (org, subject): pass subjectId for per-subject
 * prompt tracks, omit it for the org-level track — the same split the query key encodes
 * (queryKeys.organizations.prompts(orgId, subjectId)).
 *
 * THE ONE THING TO KNOW: GET /next CONSUMES — the Worker marks the prompt served before
 * responding (non-repeating, content rule 1), so a refetch serves the NEXT prompt, not the same
 * one. useNextPrompt therefore pins its cache entry (staleTime Infinity, all auto-refetch off)
 * and the loop advances ONLY through explicit invalidation: skip (below) or the app's own
 * "answered" mutation invalidating the prompts key.
 *
 * Hooks stay toast-free — screens own user feedback per call.
 */

/** Client mirror of the Worker's PromptDef (worker/engines/nudge.ts) — keep in sync. */
export type PromptDef = {
  key: string
  pack: string
  text: string
}

/** GET /next response. prompt null = catalog exhausted for this track (a normal state). */
export type NextPromptResult = {
  prompt: PromptDef | null
  /** Unserved prompts left AFTER this one — render "N more waiting" or hide at 0. */
  remaining: number
}

/** Settings DTO (GET/PATCH /settings). exists false = the track has never been written. */
export type PromptSettings = {
  exists: boolean
  subjectId: string | null
  /** 'daily' | 'weekly' | 'off'. */
  cadence: string
  packKeys: string[]
  servedCount: number
  /** ISO string over the wire. */
  lastServedAt: string | null
}

/** Suffix keys under the canonical track key so one prefix invalidation sweeps both. */
const nextKey = (orgId: string, subjectId?: string) =>
  [...queryKeys.organizations.prompts(orgId, subjectId), 'next'] as const
const settingsKey = (orgId: string, subjectId?: string) =>
  [...queryKeys.organizations.prompts(orgId, subjectId), 'settings'] as const

const subjectQuery = (subjectId?: string) =>
  subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ''

/**
 * The track's next prompt. Pinned (see file header): every automatic refetch trigger is off
 * because a refetch CONSUMES a prompt — advancing is always an explicit invalidation.
 */
export function useNextPrompt(orgId: string, subjectId?: string) {
  return useQuery({
    queryKey: nextKey(orgId, subjectId),
    queryFn: () =>
      apiFetch<NextPromptResult>(
        `/api/organizations/${orgId}/prompts/next${subjectQuery(subjectId)}`,
      ),
    enabled: Boolean(orgId),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/**
 * Skip the current prompt — served, free and final (it never comes back; content rule 1).
 * Settled invalidation of the TRACK PREFIX refetches `next`, which serves the following prompt
 * — that invalidation-refetch pair IS the advance mechanism.
 */
export function useSkipPrompt(orgId: string, subjectId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (promptKey: string) =>
      apiFetch<{ ok: true }>(`/api/organizations/${orgId}/prompts/skip`, {
        method: 'POST',
        body: JSON.stringify({ promptKey, ...(subjectId ? { subjectId } : {}) }),
      }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.prompts(orgId, subjectId),
      }),
  })
}

/** The track's cadence/pack settings (column defaults when the track was never written). */
export function usePromptSettings(orgId: string, subjectId?: string) {
  return useQuery({
    queryKey: settingsKey(orgId, subjectId),
    queryFn: () =>
      apiFetch<PromptSettings>(
        `/api/organizations/${orgId}/prompts/settings${subjectQuery(subjectId)}`,
      ),
    enabled: Boolean(orgId),
  })
}

export type UpdatePromptSettingsInput = {
  cadence?: 'daily' | 'weekly' | 'off'
  packKeys?: string[]
}

/**
 * Update cadence/packs. The response IS the fresh settings row — seed the cache, then settle
 * with a prefix invalidation (a pack change can change what `next` would serve).
 */
export function useUpdatePromptSettings(orgId: string, subjectId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdatePromptSettingsInput) =>
      apiFetch<PromptSettings>(`/api/organizations/${orgId}/prompts/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ ...input, ...(subjectId ? { subjectId } : {}) }),
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData<PromptSettings>(settingsKey(orgId, subjectId), settings)
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.prompts(orgId, subjectId),
      }),
  })
}
