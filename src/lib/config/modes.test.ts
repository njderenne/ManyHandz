import { describe, it, expect } from 'vitest'
import {
  MODE_CONFIGS,
  HOUSEHOLD_MODES,
  PERMISSION_KEYS,
  can,
  isAdmin,
  canWithHousehold,
  featuresFor,
  permissionsFor,
  roleForJoin,
  selectableModes,
  type HouseholdKidPolicy,
} from './modes'

const ALL_TOGGLES_OFF: HouseholdKidPolicy = {
  allowKidGifting: false,
  allowKidChallenges: false,
  allowKidCompetitions: false,
}

describe('mode config integrity', () => {
  it('every role matrix defines all permission keys', () => {
    for (const mode of HOUSEHOLD_MODES) {
      const cfg = MODE_CONFIGS[mode]
      for (const role of cfg.roles) {
        const matrix = cfg.permissions[role]
        expect(matrix, `${mode}/${role} has a matrix`).toBeDefined()
        for (const key of PERMISSION_KEYS) {
          expect(typeof matrix[key], `${mode}/${role}.${key} is boolean`).toBe('boolean')
        }
      }
    }
  })

  it('office is defined but not selectable; family + roommate are', () => {
    expect(MODE_CONFIGS.office.enabled).toBe(false)
    const selectable = selectableModes().map((c) => c.mode)
    expect(selectable).toContain('family')
    expect(selectable).toContain('roommate')
    expect(selectable).not.toContain('office')
  })

  it('assigns creator/joiner roles per mode', () => {
    expect(roleForJoin('family', true)).toBe('parent')
    expect(roleForJoin('family', false)).toBe('kid')
    expect(roleForJoin('roommate', true)).toBe('roommate')
    expect(roleForJoin('roommate', false)).toBe('roommate')
  })
})

describe('family permissions', () => {
  it('parent is full admin', () => {
    expect(isAdmin('family', 'parent')).toBe(true)
    expect(can('family', 'parent', 'approveCompletions')).toBe(true)
    expect(can('family', 'parent', 'createChores')).toBe(true)
    expect(can('family', 'parent', 'configureAi')).toBe(true)
  })

  it('kid is restricted', () => {
    expect(isAdmin('family', 'kid')).toBe(false)
    expect(can('family', 'kid', 'createChores')).toBe(false)
    expect(can('family', 'kid', 'approveCompletions')).toBe(false)
    expect(can('family', 'kid', 'editHouseholdSettings')).toBe(false)
    // but can do their own work + redeem (which routes through approval)
    expect(can('family', 'kid', 'markOwnComplete')).toBe(true)
    expect(can('family', 'kid', 'submitPhotoProof')).toBe(true)
    expect(can('family', 'kid', 'redeemRewards')).toBe(true)
  })

  it('kid gift/compete are gated by household toggles (two-layer)', () => {
    // base-granted, but off when the household toggle is off
    expect(can('family', 'kid', 'giftPoints')).toBe(true)
    expect(canWithHousehold('family', 'kid', 'giftPoints', ALL_TOGGLES_OFF)).toBe(false)
    expect(
      canWithHousehold('family', 'kid', 'giftPoints', { ...ALL_TOGGLES_OFF, allowKidGifting: true }),
    ).toBe(true)
    expect(canWithHousehold('family', 'kid', 'createCompetitions', ALL_TOGGLES_OFF)).toBe(false)
    expect(
      canWithHousehold('family', 'kid', 'createCompetitions', { ...ALL_TOGGLES_OFF, allowKidCompetitions: true }),
    ).toBe(true)
  })

  it("parent permissions are unaffected by kid toggles", () => {
    expect(canWithHousehold('family', 'parent', 'giftPoints', ALL_TOGGLES_OFF)).toBe(true)
    expect(canWithHousehold('family', 'parent', 'createCompetitions', ALL_TOGGLES_OFF)).toBe(true)
  })
})

describe('roommate permissions', () => {
  it('roommate is admin but has no rewards/goals/approval surface', () => {
    expect(isAdmin('roommate', 'roommate')).toBe(true)
    expect(can('roommate', 'roommate', 'createChores')).toBe(true)
    expect(can('roommate', 'roommate', 'accessBilling')).toBe(true)
    expect(can('roommate', 'roommate', 'approveCompletions')).toBe(false)
    expect(can('roommate', 'roommate', 'createRewards')).toBe(false)
    expect(can('roommate', 'roommate', 'redeemRewards')).toBe(false)
  })
})

describe('feature flags', () => {
  it('family gamifies; roommate does not; both score fairness', () => {
    expect(featuresFor('family').gamification).toBe(true)
    expect(featuresFor('family').approvalWorkflow).toBe(true)
    expect(featuresFor('roommate').gamification).toBe(false)
    expect(featuresFor('roommate').rewards).toBe(false)
    expect(featuresFor('family').fairnessScoring).toBe(true)
    expect(featuresFor('roommate').fairnessScoring).toBe(true)
  })

  it('unknown role resolves to no permissions (fail-closed)', () => {
    // a roommate-mode household never has a "kid" — must deny, not throw
    const matrix = permissionsFor('roommate', 'kid')
    expect(Object.values(matrix).every((v) => v === false)).toBe(true)
  })
})
