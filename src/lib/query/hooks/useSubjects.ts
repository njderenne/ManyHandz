import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * useSubjects — the Subject-primitive roster (Person ≠ Member ≠ User): who/what the active org
 * tracks. Mirrors the canonical resource hook (useNotifications.ts): org-scoped query keys,
 * useQuery for reads (enabled once orgId is present), useMutation for writes invalidating the
 * precise affected keys. The Worker (worker/routes/subjects.ts) enforces org scoping, capability
 * gates, and the free-tier cap — this layer just types the calls and keeps the cache coherent.
 * The whole module is inert unless `APP_CONFIG.features.subjects` mounts the routes (a feature-off
 * app gets 404s; nothing here should be rendered — SubjectPicker/SubjectSwitcher self-gate).
 */

/**
 * The wire DTO (worker/lib/subjects.ts subjectToDto): the raw `selfUserId` NEVER reaches the
 * client — `selfLinked` says a subject is claimed by SOMEONE, `isSelf` says it's the caller.
 * Timestamps arrive JSON-serialized as ISO strings.
 */
export type SubjectDto = {
  id: string
  organizationId: string
  kind: string
  displayName: string
  avatarMediaId: string | null
  timezone: string | null
  birthDate: string | null
  notes: string | null
  profile: Record<string, unknown> | null
  archivedAt: string | null
  createdByMemberId: string | null
  createdAt: string
  updatedAt: string
  /** Someone holds this subject's self-link (drives "link me" affordances). */
  selfLinked: boolean
  /** The CALLER holds it (drives the active-subject default + self badges). */
  isSelf: boolean
}

/** Create payload — `displayName` required; `isSelf` links the subject to the CALLER's user
 *  (the server never accepts a client-supplied user id). `kind` defaults server-side to the
 *  first entry of APP_CONFIG.subjects.kinds. */
export type CreateSubjectInput = {
  displayName: string
  kind?: string
  timezone?: string | null
  birthDate?: string | null
  avatarMediaId?: string | null
  notes?: string | null
  profile?: Record<string, unknown> | null
  isSelf?: boolean
}

/** Update payload — every field optional; only provided keys are patched (`null` clears).
 *  `kind`/`isSelf` are not patchable (kind is identity; self-linking has its own routes). */
export type UpdateSubjectInput = Partial<Omit<CreateSubjectInput, 'isSelf' | 'kind'>>

/**
 * The hierarchical invalidation prefix: covers every list variant (per-kind, 'all', archived)
 * AND the 'detail' keys, which all nest under ['organizations', orgId, 'subjects'] (keys.ts).
 */
const subjectsPrefix = (orgId: string) => ['organizations', orgId, 'subjects'] as const

/** Active subjects in the org (?kind= filters to one configured kind; includeArchived widens). */
export function useSubjects(orgId: string, opts?: { kind?: string; includeArchived?: boolean }) {
  const { kind, includeArchived = false } = opts ?? {}
  return useQuery({
    // The archived variant is a distinct cache entry under the same org prefix.
    queryKey: includeArchived
      ? ([...queryKeys.organizations.subjects(orgId, kind), 'archived'] as const)
      : queryKeys.organizations.subjects(orgId, kind),
    queryFn: () => {
      const params = new URLSearchParams()
      if (kind) params.set('kind', kind)
      if (includeArchived) params.set('includeArchived', '1')
      const qs = params.toString()
      return apiFetch<SubjectDto[]>(`/api/organizations/${orgId}/subjects${qs ? `?${qs}` : ''}`)
    },
    // Feature-gated module: with the flag off the routes aren't even mounted (404), so the query
    // stays disabled — a shared screen composing SubjectPicker/SubjectSwitcher pays zero cost.
    enabled: Boolean(orgId) && APP_CONFIG.features.subjects,
  })
}

/** A single subject by id (null id ⇒ disabled — pass the picker's nullable selection straight in). */
export function useSubject(orgId: string, subjectId: string | null) {
  return useQuery({
    queryKey: queryKeys.organizations.subjectDetail(orgId, subjectId ?? 'none'),
    queryFn: () => apiFetch<SubjectDto>(`/api/organizations/${orgId}/subjects/${subjectId}`),
    enabled: Boolean(orgId) && Boolean(subjectId) && APP_CONFIG.features.subjects,
  })
}

/** Create a subject (subject:manage; the Worker enforces the free-tier cap → 402 envelope). */
export function useCreateSubject(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSubjectInput) =>
      apiFetch<SubjectDto>(`/api/organizations/${orgId}/subjects`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subjectsPrefix(orgId) }),
  })
}

/** Update a subject (subject:manage). The prefix sweep refreshes lists AND this detail entry. */
export function useUpdateSubject(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & UpdateSubjectInput) =>
      apiFetch<SubjectDto>(`/api/organizations/${orgId}/subjects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subjectsPrefix(orgId) }),
  })
}

/** Archive (subject:manage) — drops from active views, stops schedules, runs app cleanup hooks;
 *  keeps ALL history and frees a cap slot. */
export function useArchiveSubject(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<SubjectDto>(`/api/organizations/${orgId}/subjects/${id}/archive`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subjectsPrefix(orgId) }),
  })
}

/** Restore an archived subject (subject:manage; re-occupies a cap slot → the Worker may 402). */
export function useRestoreSubject(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<SubjectDto>(`/api/organizations/${orgId}/subjects/${id}/restore`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subjectsPrefix(orgId) }),
  })
}

/** Claim a subject as yourself (ANY member — linking yourself is not an admin action; 409 when
 *  the subject is taken or you already have a self-linked subject in this org). */
export function useLinkSelf(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<SubjectDto>(`/api/organizations/${orgId}/subjects/${id}/link-self`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subjectsPrefix(orgId) }),
  })
}

/** Release a self-link — your own always; someone else's requires subject:manage (offboarding). */
export function useUnlinkSelf(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<SubjectDto>(`/api/organizations/${orgId}/subjects/${id}/unlink-self`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subjectsPrefix(orgId) }),
  })
}

/** AsyncStorage key for the persisted per-org selection (SUBJECT_SPEC §5.2). */
const activeSubjectKey = (orgId: string) => `activeSubject:${orgId}`

/**
 * useActiveSubject — the persisted "who am I looking at right now?" selection (the RxMndr
 * active-person switcher pattern, per-org). Resolution order: the stored selection (if still in
 * the ACTIVE roster) → the caller's self-linked subject → the first active subject → null.
 * Self-healing: a stored id that no longer resolves (archived/deleted subject, or one outside the
 * current `kind` filter) is cleared from storage automatically, so the fallback sticks instead of
 * retrying forever. Storage failures are swallowed — the selection is a convenience, never state
 * the product depends on.
 */
export function useActiveSubject(
  orgId: string,
  kind?: string,
): {
  subject: SubjectDto | null
  setActiveSubject: (id: string | null) => void
  subjects: SubjectDto[]
  isLoading: boolean
} {
  const query = useSubjects(orgId, { kind })
  const subjects = useMemo(() => query.data ?? [], [query.data])

  // undefined = storage not read yet (don't self-heal against a value we haven't loaded).
  const [storedId, setStoredId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    setStoredId(undefined)
    if (!orgId) return
    AsyncStorage.getItem(activeSubjectKey(orgId))
      .then((v) => active && setStoredId(v))
      .catch(() => active && setStoredId(null))
    return () => {
      active = false
    }
  }, [orgId])

  const setActiveSubject = useCallback(
    (id: string | null) => {
      setStoredId(id)
      if (!orgId) return
      const write =
        id === null
          ? AsyncStorage.removeItem(activeSubjectKey(orgId))
          : AsyncStorage.setItem(activeSubjectKey(orgId), id)
      write.catch(() => {}) // best-effort persistence
    },
    [orgId],
  )

  const subject = useMemo(() => {
    if (subjects.length === 0) return null
    return (
      (storedId ? subjects.find((s) => s.id === storedId) : undefined) ??
      subjects.find((s) => s.isSelf) ??
      subjects[0] ??
      null
    )
  }, [subjects, storedId])

  // Auto-clear a stale stored id once BOTH the roster and storage have settled.
  useEffect(() => {
    if (storedId === undefined || query.isLoading || !query.isSuccess) return
    if (storedId && !subjects.some((s) => s.id === storedId)) {
      setActiveSubject(subject?.id ?? null)
    }
  }, [storedId, subjects, subject, query.isLoading, query.isSuccess, setActiveSubject])

  return { subject, setActiveSubject, subjects, isLoading: query.isLoading }
}
