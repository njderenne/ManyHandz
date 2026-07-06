import { describe, it, expect } from 'vitest'
import {
  ALL_CAPABILITIES,
  CONTEXT_ROLES,
  DEFAULT_KIND,
  KINDS,
  KIND_CONFIGS,
  PERSONAL_KIND,
  ROLE_LABELS,
  can,
  canWithPolicy,
  capNeedsPolicy,
  kindFeature,
  normalizeKind,
  roleForJoin,
  selectableKinds,
  type Capability,
} from './roles'
import { POLICY_FLAGS } from '../../../worker/lib/policy'
import { organization } from '@/lib/db/schema'
import { APP_CONFIG } from './app'

/**
 * Tenancy-spine config guards (SPINE_SPEC §11.1). roles.ts is the SINGLE authority for
 * who-can-do-what — the Worker enforces it (requireCapability), the client mirrors it. These
 * tests pin the invariants that turn config drift into a CI failure instead of a mystery 403
 * (or worse, an escalation) at 3am. All pure — no DB, no React.
 *
 * Several loops below are "armed but vacuous" in the default mint (no policyGates, no custom
 * vocab): they iterate whatever KIND_CONFIGS declares, so the moment an app adds gates or kinds,
 * the full truth tables light up with zero test edits.
 */

/** Every (kind, role, cap) triple declared anywhere — the exhaustive iteration base. */
function allTriples(): Array<{ kind: string; role: string; cap: Capability }> {
  const out: Array<{ kind: string; role: string; cap: Capability }> = []
  for (const [kind, cfg] of Object.entries(KIND_CONFIGS)) {
    for (const role of cfg.roles) {
      for (const cap of ALL_CAPABILITIES) out.push({ kind, role, cap })
    }
  }
  return out
}

describe('roles — kinds', () => {
  it('DEFAULT_KIND is a declared kind', () => {
    expect(KINDS).toContain(DEFAULT_KIND)
  })

  it("the reserved 'personal' kind is never app-declared", () => {
    expect(KINDS as readonly string[]).not.toContain(PERSONAL_KIND)
    expect(Object.keys(KIND_CONFIGS)).not.toContain(PERSONAL_KIND)
  })

  it('schema guard: DEFAULT_KIND equals the drizzle default on organization.kind (SPINE §3.2)', () => {
    // Read from the schema export so a mint that renames its kind (e.g. 'care_circle') and flips
    // the DB default in the same migration keeps this green — while a one-sided edit fails here.
    expect(organization.kind.default).toBe(DEFAULT_KIND)
  })

  it('selectableKinds excludes personal and disabled kinds', () => {
    const kinds = selectableKinds().map((k) => k.kind)
    expect(kinds).not.toContain(PERSONAL_KIND)
    for (const k of kinds) {
      expect(KIND_CONFIGS[k].enabled !== false).toBe(true)
    }
    // The default mint sells exactly its one kind.
    expect(kinds.length).toBeGreaterThan(0)
  })

  it('normalizeKind: known kinds (incl. personal) pass through; unknown/legacy → DEFAULT_KIND', () => {
    for (const k of KINDS) expect(normalizeKind(k)).toBe(k)
    expect(normalizeKind(PERSONAL_KIND)).toBe(PERSONAL_KIND) // grindline collapsed this — fixed in the spec
    expect(normalizeKind('legacy-nope')).toBe(DEFAULT_KIND)
    expect(normalizeKind(undefined)).toBe(DEFAULT_KIND)
    expect(normalizeKind(null)).toBe(DEFAULT_KIND)
    expect(normalizeKind(42)).toBe(DEFAULT_KIND)
  })

  // W-1 (fixed at 0b integration): lookups route through Object.hasOwn-guarded cfgFor/ownProp,
  // so prototype-chain key names ('toString', 'constructor', …) never resolve to a config.
  it('W-1: prototype-chain kind/role names never resolve (Object.hasOwn hardening)', () => {
    expect(normalizeKind('toString')).toBe(DEFAULT_KIND)
    expect(normalizeKind('constructor')).toBe(DEFAULT_KIND)
    expect(can('toString', 'owner', 'content:read')).toBe(false)
    expect(can(DEFAULT_KIND, 'toString', 'content:read')).toBe(false)
    expect(roleForJoin('hasOwnProperty', false)).toBe(KIND_CONFIGS[DEFAULT_KIND].defaultJoinerRole)
  })
})

describe('roles — capability matrix', () => {
  it('deny-by-default: unknown kind, unknown role, ungranted cap are all false', () => {
    expect(can('nope', 'owner', 'content:read')).toBe(false)
    expect(can(DEFAULT_KIND, 'ghost-role', 'content:read')).toBe(false)
    // Kids and colleagues never hold administrative capabilities.
    expect(can('family', 'kid', 'org:delete')).toBe(false)
    expect(can('family', 'kid', 'completion:approve')).toBe(false)
    expect(can('office', 'colleague', 'org:settings')).toBe(false)
  })

  it('the matrices mirror the old MODE_CONFIGS permission booleans (SPINE §10.3 byte-compat)', () => {
    // accessBilling → org:billing: parents/roommates/managers yes, kids/colleagues no.
    expect(can('family', 'parent', 'org:billing')).toBe(true)
    expect(can('family', 'kid', 'org:billing')).toBe(false)
    expect(can('roommate', 'roommate', 'org:billing')).toBe(true)
    expect(can('office', 'manager', 'org:billing')).toBe(true)
    expect(can('office', 'colleague', 'org:billing')).toBe(false)
    // editHouseholdSettings → org:settings (isAdmin derives from it).
    expect(can('family', 'parent', 'org:settings')).toBe(true)
    expect(can('roommate', 'roommate', 'org:settings')).toBe(true)
    // approveCompletions → completion:approve is family-parent-only (approval workflow kind).
    expect(can('family', 'parent', 'completion:approve')).toBe(true)
    expect(can('roommate', 'roommate', 'completion:approve')).toBe(false)
  })

  it('ALL_CAPABILITIES completeness: every capability granted or policy-gated anywhere appears in it', () => {
    const granted = new Set<string>()
    for (const cfg of Object.values(KIND_CONFIGS)) {
      for (const caps of Object.values(cfg.permissions)) caps.forEach((c) => granted.add(c))
      for (const gates of Object.values(cfg.policyGates ?? {})) {
        Object.keys(gates).forEach((c) => granted.add(c))
      }
    }
    for (const cap of granted) {
      expect(ALL_CAPABILITIES, `capability '${cap}' is granted but missing from ALL_CAPABILITIES`).toContain(cap)
    }
    // And the list itself is duplicate-free.
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length)
  })

  it('personal grants everything — your own solo org has no locked doors', () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(can(PERSONAL_KIND, 'owner', cap), `personal owner denied '${cap}'`).toBe(true)
    }
  })

  it('matrix hygiene: permission/label keys and creator/joiner roles all live in the declared vocabulary', () => {
    for (const [kind, cfg] of Object.entries(KIND_CONFIGS)) {
      expect(cfg.roles, `${kind}.creatorRole`).toContain(cfg.creatorRole)
      expect(cfg.roles, `${kind}.defaultJoinerRole`).toContain(cfg.defaultJoinerRole)
      for (const role of Object.keys(cfg.permissions)) {
        expect(cfg.roles, `${kind}.permissions has undeclared role '${role}'`).toContain(role)
      }
      for (const role of cfg.roles) {
        expect(cfg.roleLabels[role], `${kind}.roleLabels missing '${role}'`).toBeTruthy()
      }
    }
  })

  it('derived exports stay in lockstep with KIND_CONFIGS', () => {
    for (const kind of KINDS) {
      expect(CONTEXT_ROLES[kind]).toEqual(KIND_CONFIGS[kind].roles)
      expect(ROLE_LABELS[kind]).toEqual(KIND_CONFIGS[kind].roleLabels)
    }
  })
})

describe('roles — roleForJoin', () => {
  it('creator gets creatorRole, joiner gets defaultJoinerRole, per kind', () => {
    for (const [kind, cfg] of Object.entries(KIND_CONFIGS)) {
      expect(roleForJoin(kind, true)).toBe(cfg.creatorRole)
      expect(roleForJoin(kind, false)).toBe(cfg.defaultJoinerRole)
    }
  })

  it('is total: unknown kinds resolve through DEFAULT_KIND (stale data never throws)', () => {
    expect(roleForJoin('legacy-nope', true)).toBe(KIND_CONFIGS[DEFAULT_KIND].creatorRole)
    expect(roleForJoin('legacy-nope', false)).toBe(KIND_CONFIGS[DEFAULT_KIND].defaultJoinerRole)
  })

  it('personal resolves to owner/owner', () => {
    expect(roleForJoin(PERSONAL_KIND, true)).toBe('owner')
    expect(roleForJoin(PERSONAL_KIND, false)).toBe('owner')
  })
})

describe('roles — policy gates (2nd layer)', () => {
  it('twin assertion: every PolicyFlagName used in KIND_CONFIGS has a POLICY_FLAGS entry (worker/lib/policy.ts)', () => {
    // Config drift fails HERE instead of surfacing as a fail-safe (but mysterious) 403 in prod:
    // requireCapability denies when a gate names a flag the policy SELECT can't fetch.
    for (const [kind, cfg] of Object.entries(KIND_CONFIGS)) {
      for (const [role, gates] of Object.entries(cfg.policyGates ?? {})) {
        for (const [cap, flag] of Object.entries(gates)) {
          expect(
            Object.hasOwn(POLICY_FLAGS, flag as string),
            `${kind}.${role} gates '${cap}' on flag '${flag}' — missing from POLICY_FLAGS`,
          ).toBe(true)
        }
      }
    }
  })

  it('ungated triples: canWithPolicy behaves exactly like can (empty policy, exhaustive)', () => {
    for (const { kind, role, cap } of allTriples()) {
      if (capNeedsPolicy(kind, role, cap)) continue
      expect(
        canWithPolicy(kind, role, cap, {}),
        `canWithPolicy(${kind}, ${role}, ${cap}, {}) diverged from can`,
      ).toBe(can(kind, role, cap))
    }
  })

  it('gated triples truth table: flag true ⇒ can(); flag false/missing ⇒ deny (armed — vacuous until an app declares gates)', () => {
    for (const { kind, role, cap } of allTriples()) {
      if (!capNeedsPolicy(kind, role, cap)) continue
      const flag = KIND_CONFIGS[kind as keyof typeof KIND_CONFIGS].policyGates?.[role]?.[cap] as string
      expect(canWithPolicy(kind, role, cap, { [flag]: true })).toBe(can(kind, role, cap))
      expect(canWithPolicy(kind, role, cap, { [flag]: false })).toBe(false)
      expect(canWithPolicy(kind, role, cap, {})).toBe(false) // missing flag ⇒ fail-safe deny
    }
  })

  it('ManyHandz declares exactly the three kid gates (family kid gift/compete/challenge)', () => {
    expect(capNeedsPolicy('family', 'kid', 'points:gift')).toBe(true)
    expect(capNeedsPolicy('family', 'kid', 'competition:create')).toBe(true)
    expect(capNeedsPolicy('family', 'kid', 'challenge:create')).toBe(true)
    // Parents are never policy-gated; other kinds declare no gates.
    expect(capNeedsPolicy('family', 'parent', 'points:gift')).toBe(false)
    expect(capNeedsPolicy('roommate', 'roommate', 'points:gift')).toBe(false)
    expect(Object.keys(POLICY_FLAGS).sort()).toEqual([
      'allowKidChallenges',
      'allowKidCompetitions',
      'allowKidGifting',
    ])
  })
})

describe('roles — kindFeature (SPINE §7 lookup order)', () => {
  it('falls back to APP_CONFIG.features when the kind has no override', () => {
    // 'export' ships ON in the chassis (the marketing page promises it); harvest flags ship off.
    expect(kindFeature(DEFAULT_KIND, 'export')).toBe(APP_CONFIG.features.export)
    expect(kindFeature(DEFAULT_KIND, 'subjects')).toBe(APP_CONFIG.features.subjects)
    expect(kindFeature(DEFAULT_KIND, 'not-a-feature')).toBe(false)
  })

  it('per-kind overrides win over the app-wide flag (armed — vacuous until an app declares one)', () => {
    for (const [kind, cfg] of Object.entries(KIND_CONFIGS)) {
      for (const [key, value] of Object.entries(cfg.features ?? {})) {
        expect(kindFeature(kind, key)).toBe(value)
      }
    }
  })
})
