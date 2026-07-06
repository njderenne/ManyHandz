import {
  KIND_CONFIGS,
  KINDS,
  can as canCapability,
  canWithPolicy,
  roleForJoin as roleForJoinKind,
  selectableKinds,
  type Capability,
  type Kind,
  type KindConfig,
} from './roles'

/**
 * HOUSEHOLD MODES — ManyHandz's typed view over the tenancy spine.
 *
 * SPINE §10.3 CONVERGENCE NOTE: this file used to OWN the 3-mode spine (MODE_CONFIGS × 19-permission
 * boolean matrices × canWithHousehold). That authority now lives in `src/lib/config/roles.ts`
 * (KIND_CONFIGS — `mode` IS `organization.kind`; permissions are capability lists; the two-layer
 * kid gating is policyGates + worker/lib/policy.ts POLICY_FLAGS, enforced by requireCapability).
 * What remains here is a THIN, DATA-FREE derived layer: the app-typed FeatureFlags/UiConfig shapes
 * and mode-vocabulary helpers ManyHandz screens consume. Nothing in this file declares a grant —
 * change permissions in roles.ts only.
 *
 * Still PURE (no React / RN / lucide imports) so the Worker may import it. Mode-aware navigation
 * moved to navigation.ts (NAV_BY_CONTEXT / navForContext).
 */

export const HOUSEHOLD_MODES = KINDS
export type HouseholdMode = Kind

export const HOUSEHOLD_ROLES = ['parent', 'kid', 'roommate', 'manager', 'colleague'] as const
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number]

/** The 16 feature flags. A `false` flag hides the feature's surfaces AND blocks its Worker writes. */
export type FeatureFlags = {
  gamification: boolean // points/XP/levels/badges shown prominently
  rewards: boolean // point-priced reward catalog + redemption
  goals: boolean // point-savings goals
  approvalWorkflow: boolean // completions need admin approval before points
  leaderboard: boolean // XP leaderboard
  photoProofDefault: boolean // chores default to requiring before/after photos
  fairnessScoring: boolean // effort-weighted fairness (the universal feature)
  paymentHandles: boolean // Venmo/PayPal/Cash App handles on profiles + settle-up
  bonusChallenges: boolean // time-boxed household challenges
  pointGifting: boolean // member-to-member point gifts
  weeklyReportCard: boolean // weekly per-member report
  birthdaySystem: boolean // birthday banners + pass + gift prompts
  accentColors: boolean // per-member 12-color accent
  headToHead: boolean // competitions + winner-picks-reward
  aiVerification: boolean // optional AI photo-check of completions
  speedBonus: boolean // timer-based speed bonus points
}

/** Cosmetic knobs — change tone without touching logic. */
export type UiConfig = {
  difficultyDisplay: 'stars' | 'text' // 1-5 ★ vs Easy/Medium/Hard
  completionAnimation: 'confetti' | 'checkmark'
  tonePlayful: boolean // playful copy/greetings vs clean/adult
  showPointsProminent: boolean // points front-and-center vs lightweight text
}

/** Gated actions are now spine capabilities (domain:verb) — see roles.ts for the rename map. */
export type Permission = Capability
export type PermissionMatrix = Record<string, boolean>

/** The screen-facing per-mode view (label flattened to the singular string, as screens render it). */
export type ModeConfig = {
  enabled: boolean
  label: string
  description: string
  roles: readonly HouseholdRole[]
  creatorRole: HouseholdRole
  defaultJoinerRole: HouseholdRole
  features: FeatureFlags
  ui: UiConfig
  permissions: Record<string, readonly Capability[]>
}

function toModeConfig(cfg: KindConfig): ModeConfig {
  return {
    enabled: cfg.enabled !== false,
    label: cfg.label.singular,
    description: cfg.description ?? '',
    roles: cfg.roles as readonly HouseholdRole[],
    creatorRole: cfg.creatorRole as HouseholdRole,
    defaultJoinerRole: cfg.defaultJoinerRole as HouseholdRole,
    features: cfg.features as FeatureFlags,
    ui: cfg.ui as UiConfig,
    permissions: cfg.permissions,
  }
}

/** Derived view of KIND_CONFIGS — roles.ts is the source of truth. */
export const MODE_CONFIGS: Record<HouseholdMode, ModeConfig> = Object.fromEntries(
  KINDS.map((k) => [k, toModeConfig(KIND_CONFIGS[k])]),
) as Record<HouseholdMode, ModeConfig>

/** Household policy toggles that gate kid actions a second time (authoritative at runtime).
 *  Mirrors worker/lib/policy.ts POLICY_FLAGS — the Worker consults them via requireCapability. */
export type HouseholdKidPolicy = {
  allowKidGifting: boolean
  allowKidChallenges: boolean
  allowKidCompetitions: boolean
}

// --- Pure resolvers (thin wrappers over roles.ts — the same logic the Worker enforces) ---

export function getModeConfig(mode: HouseholdMode): ModeConfig {
  return MODE_CONFIGS[mode]
}

export function featuresFor(mode: HouseholdMode): FeatureFlags {
  return MODE_CONFIGS[mode].features
}

export function uiFor(mode: HouseholdMode): UiConfig {
  return MODE_CONFIGS[mode].ui
}

export function permissionsFor(mode: HouseholdMode, role: HouseholdRole): PermissionMatrix {
  const granted = MODE_CONFIGS[mode]?.permissions[role] ?? []
  return Object.fromEntries(granted.map((c) => [c, true]))
}

/** Base capability check (the kind matrix only). Use `canWithHousehold` where kid toggles apply. */
export function can(mode: string, role: string, permission: Capability): boolean {
  return canCapability(mode, role, permission)
}

/** isAdmin is exactly the old `editHouseholdSettings` grant — now the org:settings capability. */
export function isAdmin(mode: string, role: string): boolean {
  return canCapability(mode, role, 'org:settings')
}

/**
 * Effective permission with the household's second-layer kid toggles applied — the client mirror
 * of requireCapability's policy step (POLICY_FLAGS). For a family kid, `points:gift` /
 * `competition:create` / `challenge:create` also require the matching household policy flag.
 */
export function canWithHousehold(
  mode: string,
  role: string,
  permission: Capability,
  policy: HouseholdKidPolicy,
): boolean {
  return canWithPolicy(mode, role, permission, policy as unknown as Record<string, boolean>)
}

/** Role assigned to a member when they create vs join a household of this mode. */
export function roleForJoin(mode: string, isCreator: boolean): HouseholdRole {
  return roleForJoinKind(mode, isCreator) as HouseholdRole
}

/** Modes a user may pick when creating a household (office is hidden until enabled). */
export function selectableModes(): Array<ModeConfig & { mode: HouseholdMode }> {
  return selectableKinds().map((c) => ({ mode: c.kind, ...toModeConfig(c) }))
}
