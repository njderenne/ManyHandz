import { APP_CONFIG } from './app'

/**
 * Roles & permissions — the tenancy spine's single authority for who-can-do-what (SPINE_SPEC §2).
 *
 * PURE module (no React, no node/worker imports) — imported by BOTH the RN client and the Worker.
 * The Worker enforces it (worker/middleware/org.ts requireCapability); the client only mirrors it
 * to hide controls. An org's flavor is `organization.kind` (TEXT); each kind declares its own role
 * vocabulary + capability matrix in KIND_CONFIGS below.
 *
 * MANYHANDZ (SPINE §10.3 convergence): the old 3-mode spine (src/lib/config/modes.ts
 * MODE_CONFIGS × 19-permission boolean matrices) converged onto this file — `mode` IS `kind`,
 * each PermissionMatrix became the array of its true keys under domain:verb names, and the
 * two-layer kid gating (canWithHousehold) became `policyGates` + worker/lib/policy.ts
 * POLICY_FLAGS. The typed FeatureFlags/UiConfig views the app's screens consume live in
 * src/lib/config/modes.ts as a THIN derived layer over this file (no data of its own).
 */

// ─── Kinds ────────────────────────────────────────────────────────────────
/** App-declared org flavors. ManyHandz: one product, three household kinds. */
export const KINDS = ['family', 'roommate', 'office'] as const
export type Kind = (typeof KINDS)[number]
/** The kind used when none is specified — MUST match the DB default on organization.kind
 *  (src/lib/db/schema.ts; a vitest asserts equality). */
export const DEFAULT_KIND: Kind = 'family'
/** Reserved solo kind (worker/provision-user.ts). Never in KINDS, never user-creatable —
 *  beforeCreateOrganization rejects it arriving through the plugin API. */
export const PERSONAL_KIND = 'personal'

// ─── Capabilities ─────────────────────────────────────────────────────────
/**
 * Kind-neutral verbs. The chassis set is fixed; ManyHandz APPENDS its chore-economy verbs
 * (the old 19 PERMISSION_KEYS under domain:verb names — mapping table in SPINE_SPEC §10.3):
 *   createChores→chore:create · createRotations→rotation:create · assignChores→chore:assign ·
 *   viewAllAssignments→assignment:view_all · markOwnComplete→completion:mark_own ·
 *   submitPhotoProof→completion:submit_proof · approveCompletions→completion:approve ·
 *   createRewards→reward:create · redeemRewards→reward:redeem ·
 *   createGoalsForAnyone→goal:create_any · contributeToOwnGoals→goal:contribute_own ·
 *   inviteMembers→member:invite · changeRoles→member:set_role ·
 *   editHouseholdSettings→org:settings · accessBilling→org:billing ·
 *   createChallenges→challenge:create · giftPoints→points:gift ·
 *   createCompetitions→competition:create · configureAi→ai:configure
 */
export type Capability =
  // chassis
  | 'org:delete'
  | 'org:settings'     // rename/update the org (was editHouseholdSettings — isAdmin derives from it)
  | 'org:billing'      // checkout / portal / billing-sensitive surfaces (was accessBilling)
  | 'org:export'       // full-org data export (worker/routes/export.ts — B-1)
  | 'member:invite'
  | 'member:remove'
  | 'member:set_role'
  | 'member:oversee'   // read ANOTHER member's data (worker/lib/oversight.ts)
  | 'grant:manage'     // mint/revoke/delete share grants (worker/routes/grants.ts — B-1)
  | 'subject:manage'   // create/edit/archive Persons (the SUBJECT module seam, SPINE §9)
  | 'subject:view'     // read Person profiles/data in this org
  | 'content:write'    // generated-reports POST, catalog POST/PATCH, app content writes
  | 'content:read'
  // ManyHandz chore economy
  | 'chore:create'          // create / edit / delete chores
  | 'rotation:create'
  | 'chore:assign'
  | 'assignment:view_all'
  | 'completion:mark_own'   // may route through approval (approvalWorkflow feature)
  | 'completion:submit_proof'
  | 'completion:approve'
  | 'reward:create'
  | 'reward:redeem'         // may route through approval
  | 'goal:create_any'       // goal:contribute_own still allowed where goals enabled
  | 'goal:contribute_own'
  | 'challenge:create'      // kids: also gated by household.allowKidChallenges (policyGates)
  | 'points:gift'           // kids: also gated by household.allowKidGifting (policyGates)
  | 'competition:create'    // kids: also gated by household.allowKidCompetitions (policyGates)
  | 'ai:configure'

/**
 * CAPABILITY LAW (DESIGN_ISSUES B-1): every NEW privileged chassis route gates with
 * `requireCapability(...)`, never `requireRole('owner','admin')`. Hardcoded role literals lock
 * out every kind with a custom vocabulary (ManyHandz family orgs have NO owner/admin member once
 * member.role carries the household vocabulary — role-literal gates would 403 the household
 * creator on checkout, grants, export, and report generation). `requireRole` survives ONLY in
 * legacy call sites that must keep compiling during backports.
 */

/** Every capability as a VALUE array (personal-kind grants + the completeness vitest).
 *  Apps that append capabilities to the union MUST append them here too — roles.test.ts asserts
 *  every capability granted anywhere in KIND_CONFIGS appears in this list. */
export const ALL_CAPABILITIES: readonly Capability[] = [
  'org:delete',
  'org:settings',
  'org:billing',
  'org:export',
  'member:invite',
  'member:remove',
  'member:set_role',
  'member:oversee',
  'grant:manage',
  'subject:manage',
  'subject:view',
  'content:write',
  'content:read',
  'chore:create',
  'rotation:create',
  'chore:assign',
  'assignment:view_all',
  'completion:mark_own',
  'completion:submit_proof',
  'completion:approve',
  'reward:create',
  'reward:redeem',
  'goal:create_any',
  'goal:contribute_own',
  'challenge:create',
  'points:gift',
  'competition:create',
  'ai:configure',
]

// ─── Per-kind declaration ─────────────────────────────────────────────────
/** Names an org boolean column (declared in POLICY_FLAGS, worker/lib/policy.ts). */
export type PolicyFlagName = string

export type KindConfig = {
  /** Switcher section headers, onboarding chooser, empty states. NOT APP_CONFIG.tenant —
   *  one alias can't name two kinds. */
  label: { singular: string; plural: string }
  description?: string
  /** false ⇒ defined but hidden from create pickers (ManyHandz 'office' pattern). Default true. */
  enabled?: boolean
  /** Ordered role vocabulary, most-privileged first. */
  roles: readonly string[]
  /** Role assigned to the org creator / to a plain joiner (roleForJoin). */
  creatorRole: string
  defaultJoinerRole: string
  /** Capability grants per role — deny-by-default (absent role/cap ⇒ false). */
  permissions: Record<string, readonly Capability[]>
  /** Display labels per role. */
  roleLabels: Record<string, string>
  /** Per-kind feature view; key absent ⇒ falls back to APP_CONFIG.features[key].
   *  ManyHandz: the old 16 FeatureFlags live here (typed view in modes.ts). */
  features?: Record<string, boolean>
  /** Cosmetic knobs, app-typed (ManyHandz UiConfig: tonePlayful, difficultyDisplay, …). */
  ui?: Record<string, string | boolean>
  /** 2nd-layer runtime gates (the old canWithHousehold):
   *  role → capability → org boolean column that must ALSO be true. */
  policyGates?: Record<string, Partial<Record<Capability, PolicyFlagName>>>
  /** Max orgs of this kind per user. Enforced in beforeCreateOrganization. Absent ⇒ uncapped. */
  maxPerUser?: number
}

// --- Permission arrays (the old boolean matrices, converted to true-key lists) ---

/** Family parent — full admin (the old FAMILY_PARENT all-true matrix + chassis admin grants). */
const FAMILY_PARENT: readonly Capability[] = [
  'org:delete', 'org:settings', 'org:billing', 'org:export',
  'member:invite', 'member:remove', 'member:set_role', 'member:oversee',
  'grant:manage', 'subject:manage', 'subject:view', 'content:write', 'content:read',
  'chore:create', 'rotation:create', 'chore:assign', 'assignment:view_all',
  'completion:mark_own', 'completion:submit_proof', 'completion:approve',
  'reward:create', 'reward:redeem', 'goal:create_any', 'goal:contribute_own',
  'challenge:create', 'points:gift', 'competition:create', 'ai:configure',
]

/** Family kid — restricted; gift/compete are base-true but policy-gated (allowKid* flags). */
const FAMILY_KID: readonly Capability[] = [
  'content:read', 'subject:view',
  'assignment:view_all', 'completion:mark_own', 'completion:submit_proof',
  'reward:redeem', 'goal:contribute_own', 'points:gift', 'competition:create',
]

/** Roommate — equal peers; everything except rewards/goals/approvals (absent in this kind). */
const ROOMMATE: readonly Capability[] = [
  'org:delete', 'org:settings', 'org:billing', 'org:export',
  'member:invite', 'member:remove', 'member:set_role', 'member:oversee',
  'grant:manage', 'subject:manage', 'subject:view', 'content:write', 'content:read',
  'chore:create', 'rotation:create', 'chore:assign', 'assignment:view_all',
  'completion:mark_own', 'completion:submit_proof',
  'challenge:create', 'points:gift', 'competition:create', 'ai:configure',
]

/** Office manager — admin minus gamification/approvals/rewards/goals/challenges/gifting/AI. */
const OFFICE_MANAGER: readonly Capability[] = [
  'org:delete', 'org:settings', 'org:billing', 'org:export',
  'member:invite', 'member:remove', 'member:set_role', 'member:oversee',
  'grant:manage', 'subject:manage', 'subject:view', 'content:write', 'content:read',
  'chore:create', 'rotation:create', 'chore:assign', 'assignment:view_all',
  'completion:mark_own', 'completion:submit_proof',
]

/** Office colleague — create/edit chores + do own work; nothing administrative. */
const OFFICE_COLLEAGUE: readonly Capability[] = [
  'content:read', 'subject:view',
  'chore:create', 'assignment:view_all', 'completion:mark_own', 'completion:submit_proof',
]

/** THE per-app declaration — the old MODE_CONFIGS, one KindConfig per household kind. */
export const KIND_CONFIGS: Record<Kind, KindConfig> = {
  family: {
    label: { singular: 'Family', plural: 'Families' },
    description: 'Parents manage chores; kids earn points, levels, and rewards.',
    roles: ['parent', 'kid'],
    creatorRole: 'parent',
    defaultJoinerRole: 'kid',
    permissions: { parent: FAMILY_PARENT, kid: FAMILY_KID },
    roleLabels: { parent: 'Parent', kid: 'Kid' },
    features: {
      gamification: true, rewards: true, goals: true, approvalWorkflow: true, leaderboard: true,
      photoProofDefault: true, fairnessScoring: true, paymentHandles: true, bonusChallenges: true,
      pointGifting: true, weeklyReportCard: true, birthdaySystem: true, accentColors: true,
      headToHead: true, aiVerification: true, speedBonus: true,
    },
    ui: { difficultyDisplay: 'stars', completionAnimation: 'confetti', tonePlayful: true, showPointsProminent: true },
    // Two-layer kid gating — base grant above; these org flags are authoritative at runtime
    // (requireCapability consults POLICY_FLAGS; the client mirror is canWithHousehold in modes.ts).
    policyGates: {
      kid: {
        'points:gift': 'allowKidGifting',
        'competition:create': 'allowKidCompetitions',
        'challenge:create': 'allowKidChallenges',
      },
    },
  },
  roommate: {
    label: { singular: 'Roommates', plural: 'Roommates' },
    description: 'Equal housemates sharing responsibilities fairly.',
    roles: ['roommate'],
    creatorRole: 'roommate',
    defaultJoinerRole: 'roommate',
    permissions: { roommate: ROOMMATE },
    roleLabels: { roommate: 'Roommate' },
    features: {
      gamification: false, rewards: false, goals: false, approvalWorkflow: false, leaderboard: false,
      photoProofDefault: false, fairnessScoring: true, paymentHandles: true, bonusChallenges: true,
      pointGifting: true, weeklyReportCard: true, birthdaySystem: true, accentColors: true,
      headToHead: true, aiVerification: true, speedBonus: true,
    },
    ui: { difficultyDisplay: 'text', completionAnimation: 'checkmark', tonePlayful: false, showPointsProminent: false },
  },
  office: {
    label: { singular: 'Office', plural: 'Offices' },
    description: 'Professional task tracking, no gamification.',
    enabled: false, // defined for the future; hidden from the create-household picker
    roles: ['manager', 'colleague'],
    creatorRole: 'manager',
    defaultJoinerRole: 'colleague',
    permissions: { manager: OFFICE_MANAGER, colleague: OFFICE_COLLEAGUE },
    roleLabels: { manager: 'Manager', colleague: 'Colleague' },
    features: {
      gamification: false, rewards: false, goals: false, approvalWorkflow: false, leaderboard: false,
      photoProofDefault: false, fairnessScoring: true, paymentHandles: false, bonusChallenges: false,
      pointGifting: false, weeklyReportCard: true, birthdaySystem: false, accentColors: true,
      headToHead: false, aiVerification: false, speedBonus: false,
    },
    ui: { difficultyDisplay: 'text', completionAnimation: 'checkmark', tonePlayful: false, showPointsProminent: false },
  },
}

// ─── Runtime table (chassis-computed; includes the reserved personal kind) ─
/** The reserved solo kind grants EVERYTHING to its lone owner — it's your own personal org.
 *  Excluded from create pickers (enabled:false) and from KINDS/selectableKinds by construction. */
const RUNTIME_KIND_CONFIGS: Record<string, KindConfig> = {
  ...KIND_CONFIGS,
  [PERSONAL_KIND]: {
    label: { singular: 'Personal', plural: 'Personal' },
    enabled: false,
    roles: ['owner'],
    creatorRole: 'owner',
    defaultJoinerRole: 'owner',
    permissions: { owner: ALL_CAPABILITIES },
    roleLabels: { owner: 'Owner' },
  },
}

// ─── Derived exports (grindline back-compat surface) ─────────────────────
function derive<T>(pick: (cfg: KindConfig) => T): Record<Kind, T> {
  return Object.fromEntries(KINDS.map((k) => [k, pick(KIND_CONFIGS[k])])) as Record<Kind, T>
}

/** Roles per kind — the ordered vocabulary (most-privileged first). */
export const CONTEXT_ROLES: Record<Kind, readonly string[]> = derive((c) => c.roles)
/** Per-(kind, role) capability grants — derived; KIND_CONFIGS is the source of truth. */
export const PERMISSIONS: Record<Kind, Record<string, readonly Capability[]>> = derive((c) => c.permissions)
/** Display labels per (kind, role) — for role badges / pickers in the UI. */
export const ROLE_LABELS: Record<Kind, Record<string, string>> = derive((c) => c.roleLabels)
/** Display labels per kind — switcher section headers + the onboarding chooser. */
export const KIND_LABELS: Record<Kind, { singular: string; plural: string }> = derive((c) => c.label)
/** Role strings are per-kind vocabularies; apps that want a narrow union derive it themselves:
 *  `type FamilyRole = (typeof KIND_CONFIGS.family.roles)[number]`. */
export type ContextRole = string

// ─── Resolvers (all pure; unknown kind/role/cap ⇒ false — a stale role can never escalate) ─

/**
 * Own-property-guarded kind lookup (W-1): kind/role strings reach these resolvers from the DB, so
 * prototype-chain names ('toString', 'constructor', 'hasOwnProperty', …) must never resolve —
 * bare bracket access would leak Object.prototype members (normalizeKind('toString') passing
 * through; can() throwing a TypeError instead of returning false). Every resolver below routes
 * its kind lookup through here.
 */
function cfgFor(kind: string): KindConfig | undefined {
  return typeof kind === 'string' && Object.hasOwn(RUNTIME_KIND_CONFIGS, kind)
    ? RUNTIME_KIND_CONFIGS[kind]
    : undefined
}

/** Same hardening for role-keyed record reads (permissions/policyGates/features are plain
 *  objects too — `permissions['toString']` is a live prototype function, not undefined). */
function ownProp<T>(rec: Record<string, T> | undefined, key: string): T | undefined {
  return rec !== undefined && typeof key === 'string' && Object.hasOwn(rec, key)
    ? rec[key]
    : undefined
}

/**
 * Whether a (kind, role) is granted a capability. THE canonical check — the Worker
 * (requireCapability) and the client (to hide controls) both call this 3-arg form; there is
 * deliberately NO 2-arg overload (one calling convention fleet-wide).
 */
export function can(kind: string, role: string, cap: Capability): boolean {
  return ownProp(cfgFor(kind)?.permissions, role)?.includes(cap) ?? false
}

/**
 * `can` + the 2nd-layer org-policy gates: when a policyGate names an org boolean flag for this
 * (kind, role, cap), that flag must ALSO be true in `policy` (missing flag ⇒ deny — a wiring gap
 * can never escalate). Ungated (kind, role, cap) triples behave exactly like `can`.
 */
export function canWithPolicy(
  kind: string,
  role: string,
  cap: Capability,
  policy: Record<string, boolean>,
): boolean {
  if (!can(kind, role, cap)) return false
  const flag = ownProp(cfgFor(kind)?.policyGates, role)?.[cap]
  if (flag === undefined) return true
  return policy[flag] === true
}

/** True iff some policyGate applies to (kind, role, cap) — lets requireCapability skip the
 *  policy query for ungated caps. */
export function capNeedsPolicy(kind: string, role: string, cap: Capability): boolean {
  return ownProp(cfgFor(kind)?.policyGates, role)?.[cap] !== undefined
}

/** Role assigned on join: the creator gets creatorRole, everyone else defaultJoinerRole.
 *  Unknown kinds resolve through DEFAULT_KIND (total — never throws on stale data). */
export function roleForJoin(kind: string, isCreator: boolean): string {
  const cfg = cfgFor(kind) ?? RUNTIME_KIND_CONFIGS[DEFAULT_KIND]
  return isCreator ? cfg.creatorRole : cfg.defaultJoinerRole
}

/** Kinds a user may pick at create time (enabled !== false; personal excluded by construction). */
export function selectableKinds(): Array<{ kind: Kind } & KindConfig> {
  return KINDS.map((kind) => ({ kind, ...KIND_CONFIGS[kind] })).filter((c) => c.enabled !== false)
}

/** Per-kind feature flag with APP_CONFIG.features fallback (SPINE §7 lookup order 1+2). */
export function kindFeature(kind: string, key: string): boolean {
  const override = ownProp(cfgFor(kind)?.features, key)
  if (override !== undefined) return override
  return ownProp(APP_CONFIG.features as Record<string, boolean>, key) ?? false
}

/** Cosmetic per-kind UI knobs; unknown kind ⇒ empty (callers use their own defaults). */
export function kindUi(kind: string): Record<string, string | boolean> {
  return cfgFor(kind)?.ui ?? {}
}

/** Normalize a persisted kind string: known (incl. personal) ⇒ itself; unknown/legacy ⇒
 *  DEFAULT_KIND. Deliberately PRESERVES 'personal' (grindline collapsed it — wrong generically). */
export function normalizeKind(raw: unknown): string {
  return typeof raw === 'string' && cfgFor(raw) !== undefined ? raw : DEFAULT_KIND
}
