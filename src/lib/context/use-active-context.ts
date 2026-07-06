import { useMemo } from 'react'
import { authClient } from '@/lib/auth/client'
import { KINDS, normalizeKind, type Kind } from '@/lib/config/roles'

/**
 * useActiveContext — the kind-aware lens over Better-Auth's active organization (SPINE_SPEC §6.1,
 * harvested from grindline's dual-context spine).
 *
 * The active context is NOT stored separately — it IS `session.activeOrganizationId`, surfaced by
 * `useActiveOrganization()`. This hook derives the shape product screens actually want: the org's
 * `kind`, the caller's role IN that context, plus the available-contexts list grouped by kind (for
 * the switcher) and a `hasContexts` boolean (for the context guard).
 *
 * `kind` flows through because both auth clients declare the org additionalFields
 * (src/lib/auth/org-fields.ts ↔ worker/auth.ts), so `activeOrg.kind` is typed.
 *
 * Role: the active org carries its `members`; the caller's role is the member row whose `userId`
 * matches the session user. (We avoid a separate `useActiveMember` atom so role + org resolve from
 * the same fetch — no second loading state to coordinate.)
 *
 * Deltas from the grindline donor (deliberate, SPINE §6.1):
 *  - `normalizeKind` comes from roles.ts and PRESERVES 'personal' (grindline collapsed
 *    personal→team — wrong generically: a personal org is not a team).
 *  - the app-sugar fields (`householdId`/`teamId`) are dropped from the chassis — an app that
 *    wants them derives locally: `const householdId = active?.kind === 'household' ? active.contextId : undefined`.
 */

/** A single switchable context — the org plus its derived kind/role, for the switcher list. */
export type AvailableContext = {
  id: string
  name: string
  /** normalizeKind(org.kind) — a KNOWN kind or 'personal'; unknown/legacy strings → DEFAULT_KIND. */
  kind: string
  /** The caller's role here, if known. Only the ACTIVE org carries members, so non-active rows
   *  resolve `role: undefined` — the switcher shows a role subtitle only where we know it. */
  role?: string
}

export type ActiveContext = {
  contextId: string
  contextName: string
  /** normalizeKind(activeOrg.kind) — typed via ORG_ADDITIONAL_FIELDS. */
  kind: string
  /** The caller's member.role inside the active org (undefined while members resolve). */
  role: string | undefined
}

export function useActiveContext(): {
  active: ActiveContext | null
  /** ALL orgs, personal included — `hasContexts` must count the auto-provisioned personal org
   *  (a solo-first user has a usable context; the guard must never bounce them to onboarding). */
  contexts: AvailableContext[]
  /** Available contexts grouped by kind, in KINDS order — for the switcher's sections. KINDS
   *  never contains the reserved 'personal' kind, so personal orgs are auto-excluded here. */
  grouped: { kind: Kind; contexts: AvailableContext[] }[]
  hasContexts: boolean
  isLoading: boolean
} {
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { data: orgs, isPending: orgsPending } = authClient.useListOrganizations()
  const { data: activeOrg, isPending: activePending } = authClient.useActiveOrganization()

  const userId = session?.user?.id

  const active = useMemo<ActiveContext | null>(() => {
    if (!activeOrg) return null
    const kind = normalizeKind(activeOrg.kind)
    // Guard against a non-array members payload — this hook mounts globally (guard + nav), so a
    // transient backend shape error must never white-screen the app.
    const members = Array.isArray(activeOrg.members) ? activeOrg.members : []
    const myMember = userId ? members.find((m) => m.userId === userId) : undefined
    return {
      contextId: activeOrg.id,
      contextName: activeOrg.name,
      kind,
      role: myMember?.role ?? undefined,
    }
  }, [activeOrg, userId])

  const contexts = useMemo<AvailableContext[]>(() => {
    // Same hardening for the org list: a non-array payload is "no contexts yet", not a crash.
    if (!Array.isArray(orgs)) return []
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      kind: normalizeKind((o as { kind?: unknown }).kind),
      // Only the active org exposes members, so role is known only for the active context.
      role: o.id === active?.contextId ? active?.role : undefined,
    }))
  }, [orgs, active])

  const grouped = useMemo(
    () =>
      KINDS.map((kind) => ({
        kind,
        contexts: contexts.filter((c) => c.kind === kind),
      })).filter((g) => g.contexts.length > 0),
    [contexts],
  )

  return {
    active,
    contexts,
    grouped,
    hasContexts: contexts.length > 0,
    // "Loading" until session + list resolve; the active-org atom can still be settling after that
    // (e.g. mid-switch), but the list is enough to drive the guard/switcher.
    isLoading: sessionPending || orgsPending || (activePending && !activeOrg && contexts.length > 0),
  }
}
