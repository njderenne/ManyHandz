import { useSession } from '@/lib/auth/client'
import { useHousehold, type HouseholdConfig } from '@/lib/query/hooks/useHousehold'
import {
  canWithHousehold,
  featuresFor,
  getModeConfig,
  permissionsFor,
  uiFor,
  type FeatureFlags,
  type HouseholdMode,
  type HouseholdRole,
  type ModeConfig,
  type Permission,
  type PermissionMatrix,
  type UiConfig,
} from '@/lib/config/modes'
import { navTabsFor, type ModeNavTab } from '@/lib/config/mode-nav'

/** The active organization (household) id from the Better-Auth session, or undefined when none. */
export function useActiveOrgId(): string | undefined {
  const { data } = useSession()
  return data?.session.activeOrganizationId ?? undefined
}

export type HouseholdModeState = {
  orgId: string | undefined
  isLoading: boolean
  /** True once orgId + mode + role are all known — gate mode-dependent UI on this. */
  ready: boolean
  mode: HouseholdMode | undefined
  role: HouseholdRole | undefined
  household: HouseholdConfig | undefined
  config: ModeConfig | undefined
  features: FeatureFlags | undefined
  ui: UiConfig | undefined
  navTabs: ModeNavTab[]
  permissions: PermissionMatrix | undefined
  /** Effective permission check (mode matrix + the household's kid toggles). Fail-closed until ready. */
  can: (permission: Permission) => boolean
}

/**
 * useHouseholdMode — THE hook every screen reads to drive mode-aware UI. It resolves the active
 * household's mode + the caller's role, then exposes the per-mode config (features, UI tone, nav
 * tabs) and a `can()` that mirrors the Worker's server-side check. Components read this; they never
 * branch on raw mode/role strings, and the client `can()` is a UI affordance — the Worker enforces.
 */
export function useHouseholdMode(): HouseholdModeState {
  const orgId = useActiveOrgId()
  const { data, isLoading } = useHousehold(orgId ?? '')

  const mode = data?.household.mode
  const role = data?.me.householdRole
  const ready = Boolean(orgId && mode && role)

  const policy = {
    allowKidGifting: data?.household.allowKidGifting ?? false,
    allowKidChallenges: data?.household.allowKidChallenges ?? false,
    allowKidCompetitions: data?.household.allowKidCompetitions ?? false,
  }

  return {
    orgId,
    isLoading,
    ready,
    mode,
    role,
    household: data?.household,
    config: mode ? getModeConfig(mode) : undefined,
    features: mode ? featuresFor(mode) : undefined,
    ui: mode ? uiFor(mode) : undefined,
    navTabs: mode && role ? navTabsFor(mode, role) : [],
    permissions: mode && role ? permissionsFor(mode, role) : undefined,
    can: (permission) => (mode && role ? canWithHousehold(mode, role, permission, policy) : false),
  }
}
