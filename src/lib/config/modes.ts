/**
 * HOUSEHOLD MODES — the spine of ManyHandz.
 *
 * One product, three modes (family / roommate / office). A household's `mode` (a column on the
 * organization) drives the ENTIRE UX through a per-mode `ModeConfig`: feature flags, UI tone, and a
 * per-role permission matrix. Components AND Worker routes read this config — they NEVER branch on
 * raw `mode`/`role` strings. Adding a new mode is a single entry here.
 *
 * This file is PURE (no React / React Native / lucide imports) so the Worker can import it to
 * re-derive permissions server-side — the client mirror is never the authority. The mode-aware
 * navigation tabs (which need icon components) live in the client-only `mode-nav.ts`.
 *
 * Two-layer kid gating: the matrix grants kids `giftPoints`/`createCompetitions`/`createChallenges`
 * at the BASE level, but household toggles (`allowKidGifting`, etc.) are authoritative at runtime.
 * Resolve the effective permission with `canWithHousehold()`.
 */

export const HOUSEHOLD_MODES = ['family', 'roommate', 'office'] as const
export type HouseholdMode = (typeof HOUSEHOLD_MODES)[number]

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

/** The 19 gated actions. `isAdmin` is derived purely as `editHouseholdSettings` (brief §3). */
export const PERMISSION_KEYS = [
  'createChores', // create / edit / delete chores
  'createRotations',
  'assignChores',
  'viewAllAssignments',
  'markOwnComplete', // may route through approval (see approvalWorkflow + householdRole)
  'submitPhotoProof',
  'approveCompletions',
  'createRewards',
  'redeemRewards', // may route through approval
  'createGoalsForAnyone', // false but createGoalsForSelf still allowed where goals enabled
  'contributeToOwnGoals',
  'inviteMembers',
  'changeRoles',
  'editHouseholdSettings', // == isAdmin
  'accessBilling',
  'createChallenges',
  'giftPoints', // kids: also gated by household.allowKidGifting
  'createCompetitions', // kids: also gated by household.allowKidCompetitions
  'configureAi',
] as const
export type Permission = (typeof PERMISSION_KEYS)[number]
export type PermissionMatrix = Record<Permission, boolean>

export type ModeConfig = {
  enabled: boolean // office is defined but hidden from the create-household picker
  label: string
  description: string
  roles: readonly HouseholdRole[]
  creatorRole: HouseholdRole
  defaultJoinerRole: HouseholdRole
  features: FeatureFlags
  ui: UiConfig
  permissions: Record<string, PermissionMatrix> // keyed by HouseholdRole
}

// --- Permission helpers (build matrices without 19-line literals everywhere) ---

const NO_PERMS: PermissionMatrix = Object.fromEntries(
  PERMISSION_KEYS.map((k) => [k, false]),
) as PermissionMatrix

function perms(overrides: Partial<PermissionMatrix>): PermissionMatrix {
  return { ...NO_PERMS, ...overrides }
}

// Family parent — full admin.
const FAMILY_PARENT: PermissionMatrix = perms({
  createChores: true, createRotations: true, assignChores: true, viewAllAssignments: true,
  markOwnComplete: true, submitPhotoProof: true, approveCompletions: true, createRewards: true,
  redeemRewards: true, createGoalsForAnyone: true, contributeToOwnGoals: true, inviteMembers: true,
  changeRoles: true, editHouseholdSettings: true, accessBilling: true, createChallenges: true,
  giftPoints: true, createCompetitions: true, configureAi: true,
})

// Family kid — restricted; gift/compete are base-true but household-toggle gated.
const FAMILY_KID: PermissionMatrix = perms({
  viewAllAssignments: true, markOwnComplete: true, submitPhotoProof: true, redeemRewards: true,
  contributeToOwnGoals: true, giftPoints: true, createCompetitions: true,
})

// Roommate — equal peers; everything except rewards/goals/approvals (which don't exist in this mode).
const ROOMMATE: PermissionMatrix = perms({
  createChores: true, createRotations: true, assignChores: true, viewAllAssignments: true,
  markOwnComplete: true, submitPhotoProof: true, inviteMembers: true, changeRoles: true,
  editHouseholdSettings: true, accessBilling: true, createChallenges: true, giftPoints: true,
  createCompetitions: true, configureAi: true,
})

// Office manager — admin minus gamification/approvals/rewards/goals/challenges/competitions/gifting/AI.
const OFFICE_MANAGER: PermissionMatrix = perms({
  createChores: true, createRotations: true, assignChores: true, viewAllAssignments: true,
  markOwnComplete: true, submitPhotoProof: true, inviteMembers: true, changeRoles: true,
  editHouseholdSettings: true, accessBilling: true,
})

// Office colleague — create/edit chores + do own work; nothing administrative.
const OFFICE_COLLEAGUE: PermissionMatrix = perms({
  createChores: true, viewAllAssignments: true, markOwnComplete: true, submitPhotoProof: true,
})

// --- The three mode configs ---

export const MODE_CONFIGS: Record<HouseholdMode, ModeConfig> = {
  family: {
    enabled: true,
    label: 'Family',
    description: 'Parents manage chores; kids earn points, levels, and rewards.',
    roles: ['parent', 'kid'],
    creatorRole: 'parent',
    defaultJoinerRole: 'kid',
    features: {
      gamification: true, rewards: true, goals: true, approvalWorkflow: true, leaderboard: true,
      photoProofDefault: true, fairnessScoring: true, paymentHandles: true, bonusChallenges: true,
      pointGifting: true, weeklyReportCard: true, birthdaySystem: true, accentColors: true,
      headToHead: true, aiVerification: true, speedBonus: true,
    },
    ui: { difficultyDisplay: 'stars', completionAnimation: 'confetti', tonePlayful: true, showPointsProminent: true },
    permissions: { parent: FAMILY_PARENT, kid: FAMILY_KID },
  },
  roommate: {
    enabled: true,
    label: 'Roommates',
    description: 'Equal housemates sharing responsibilities fairly.',
    roles: ['roommate'],
    creatorRole: 'roommate',
    defaultJoinerRole: 'roommate',
    features: {
      gamification: false, rewards: false, goals: false, approvalWorkflow: false, leaderboard: false,
      photoProofDefault: false, fairnessScoring: true, paymentHandles: true, bonusChallenges: true,
      pointGifting: true, weeklyReportCard: true, birthdaySystem: true, accentColors: true,
      headToHead: true, aiVerification: true, speedBonus: true,
    },
    ui: { difficultyDisplay: 'text', completionAnimation: 'checkmark', tonePlayful: false, showPointsProminent: false },
    permissions: { roommate: ROOMMATE },
  },
  office: {
    enabled: false, // defined for the future; hidden from the create-household picker
    label: 'Office',
    description: 'Professional task tracking, no gamification.',
    roles: ['manager', 'colleague'],
    creatorRole: 'manager',
    defaultJoinerRole: 'colleague',
    features: {
      gamification: false, rewards: false, goals: false, approvalWorkflow: false, leaderboard: false,
      photoProofDefault: false, fairnessScoring: true, paymentHandles: false, bonusChallenges: false,
      pointGifting: false, weeklyReportCard: true, birthdaySystem: false, accentColors: true,
      headToHead: false, aiVerification: false, speedBonus: false,
    },
    ui: { difficultyDisplay: 'text', completionAnimation: 'checkmark', tonePlayful: false, showPointsProminent: false },
    permissions: { manager: OFFICE_MANAGER, colleague: OFFICE_COLLEAGUE },
  },
}

/** Household policy toggles that gate kid actions a second time (authoritative at runtime). */
export type HouseholdKidPolicy = {
  allowKidGifting: boolean
  allowKidChallenges: boolean
  allowKidCompetitions: boolean
}

// --- Pure resolvers (the same logic the Worker uses) ---

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
  return MODE_CONFIGS[mode].permissions[role] ?? NO_PERMS
}

/** Base permission check (the mode matrix only). Use `canWithHousehold` where kid toggles apply. */
export function can(mode: HouseholdMode, role: HouseholdRole, permission: Permission): boolean {
  return permissionsFor(mode, role)[permission] === true
}

/** isAdmin is exactly `editHouseholdSettings` (brief §3). */
export function isAdmin(mode: HouseholdMode, role: HouseholdRole): boolean {
  return can(mode, role, 'editHouseholdSettings')
}

/**
 * Effective permission with the household's second-layer kid toggles applied. For a family kid,
 * `giftPoints`/`createCompetitions`/`createChallenges` also require the matching household policy
 * flag; everything else is the base matrix. The Worker calls this same function before any mutation.
 */
export function canWithHousehold(
  mode: HouseholdMode,
  role: HouseholdRole,
  permission: Permission,
  policy: HouseholdKidPolicy,
): boolean {
  if (!can(mode, role, permission)) return false
  if (mode === 'family' && role === 'kid') {
    if (permission === 'giftPoints') return policy.allowKidGifting
    if (permission === 'createCompetitions') return policy.allowKidCompetitions
    if (permission === 'createChallenges') return policy.allowKidChallenges
  }
  return true
}

/** Role assigned to a member when they create vs join a household of this mode. */
export function roleForJoin(mode: HouseholdMode, isCreator: boolean): HouseholdRole {
  const cfg = MODE_CONFIGS[mode]
  return isCreator ? cfg.creatorRole : cfg.defaultJoinerRole
}

/** Modes a user may pick when creating a household (office is hidden until enabled). */
export function selectableModes(): Array<ModeConfig & { mode: HouseholdMode }> {
  return HOUSEHOLD_MODES.map((m) => ({ mode: m, ...MODE_CONFIGS[m] })).filter((c) => c.enabled)
}
