import { describe, it, expect } from 'vitest'
import { computePoints, basePoints, streakBonus, speedBonus, nextStreak } from './points'
import { levelForXp, xpForLevel, titleForLevel, levelProgress, MAX_LEVEL } from './levels'
import { computeFairness, fairnessLabel } from './fairness'

describe('points engine', () => {
  it('base = ceil(difficulty × minutes / 15)', () => {
    expect(basePoints(3, 15)).toBe(3)
    expect(basePoints(5, 30)).toBe(10)
    expect(basePoints(1, 5)).toBe(1) // ceil(0.333)
    expect(basePoints(4, 20)).toBe(6) // ceil(5.333)
  })

  it('streak bonus is +10%/day capped at +50%', () => {
    expect(streakBonus(10, 0)).toBe(0)
    expect(streakBonus(10, 3)).toBe(3) // ceil(10 × 0.30)
    expect(streakBonus(10, 5)).toBe(5) // cap 0.50
    expect(streakBonus(10, 20)).toBe(5) // still capped
  })

  it('speed bonus rewards beating the estimate, capped at 50%, guarded', () => {
    expect(speedBonus(10, 30, 15)).toBe(2) // floor(0.5 × 10 × 0.5)
    expect(speedBonus(10, 30, 30)).toBe(0) // not faster
    expect(speedBonus(10, 30, 1)).toBe(0) // under the 2-min floor
    expect(speedBonus(10, 30, null)).toBe(0) // no timer
    expect(speedBonus(2, 100, 2)).toBe(0) // raw floor(0.98 × 2 × 0.5)=floor(0.98)=0; min(0, cap 1)=0
  })

  it('multiplier applies to performance points only; photo/early are flat', () => {
    const b = computePoints({
      difficulty: 4, estimatedMinutes: 20, actualMinutes: 10, currentStreak: 5,
      photos: 'both', early: true, challengeMultiplier: 2,
    })
    // base 6, streak ceil(6×0.5)=3, speed floor((10/20)×6×0.5)=1, photo 3, early 2
    // total = ceil((6+3+1)×2) + 3 + 2 = 20 + 5 = 25
    expect(b).toMatchObject({ base: 6, streakBonus: 3, speedBonus: 1, photoBonus: 3, earlyBonus: 2, total: 25 })
  })

  it('photo bonus: both=3, one=1, none=0', () => {
    expect(computePoints({ difficulty: 1, estimatedMinutes: 15, photos: 'both' }).photoBonus).toBe(3)
    expect(computePoints({ difficulty: 1, estimatedMinutes: 15, photos: 'one' }).photoBonus).toBe(1)
    expect(computePoints({ difficulty: 1, estimatedMinutes: 15, photos: 'none' }).photoBonus).toBe(0)
  })

  it('streak progression', () => {
    expect(nextStreak(4, '2026-06-20', '2026-06-21', '2026-06-20')).toBe(5) // yesterday → +1
    expect(nextStreak(4, '2026-06-21', '2026-06-21', '2026-06-20')).toBe(4) // already today → unchanged
    expect(nextStreak(4, '2026-06-18', '2026-06-21', '2026-06-20')).toBe(1) // gap → reset
    expect(nextStreak(0, null, '2026-06-21', '2026-06-20')).toBe(1) // first ever
  })
})

describe('levels', () => {
  it('maps XP to level at the anchors', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelForXp(49)).toBe(1)
    expect(levelForXp(50)).toBe(2)
    expect(levelForXp(1700)).toBe(10)
    expect(levelForXp(80000)).toBe(50)
    expect(levelForXp(999999)).toBe(MAX_LEVEL)
  })

  it('interpolates intermediate levels between anchors', () => {
    // L12 = round(1700 + (2/5)(4000-1700)) = round(1700 + 920) = 2620
    expect(xpForLevel(12)).toBe(2620)
    expect(levelForXp(2620)).toBe(12)
    expect(levelForXp(2619)).toBe(11)
  })

  it('titles by band', () => {
    expect(titleForLevel(1)).toBe('Rookie')
    expect(titleForLevel(5)).toBe('Helper')
    expect(titleForLevel(10)).toBe('Contributor')
    expect(titleForLevel(15)).toBe('Household Pro')
    expect(titleForLevel(20)).toBe('Chore Master')
    expect(titleForLevel(30)).toBe('Household Legend')
    expect(titleForLevel(40)).toBe('ManyHandz Elite')
    expect(titleForLevel(50)).toBe('Hall of Fame')
  })

  it('progress bar maths', () => {
    const p0 = levelProgress(0)
    expect(p0).toMatchObject({ level: 1, xpToNext: 50, progress: 0 })
    const pMax = levelProgress(80000)
    expect(pMax).toMatchObject({ level: 50, progress: 1, xpToNext: 0 })
    const mid = levelProgress(25) // halfway to L2 (0→50)
    expect(mid.progress).toBeCloseTo(0.5, 5)
  })
})

describe('fairness', () => {
  it('single-member and empty households are 100', () => {
    expect(computeFairness([]).householdScore).toBe(100)
    expect(computeFairness([{ memberId: 'a', points: 42 }]).householdScore).toBe(100)
  })

  it('equal split is perfectly balanced', () => {
    const r = computeFairness([{ memberId: 'a', points: 50 }, { memberId: 'b', points: 50 }])
    expect(r.householdScore).toBe(100)
    expect(r.perMember.every((m) => m.status === 'balanced')).toBe(true)
    expect(r.label).toBe('Perfectly Balanced')
  })

  it('skew lowers the score and flags the outliers', () => {
    const r = computeFairness([{ memberId: 'a', points: 90 }, { memberId: 'b', points: 10 }])
    // a: 90% (dev +40), b: 10% (dev -40); avgAbsDev 40 → score 60
    expect(r.householdScore).toBe(60)
    expect(r.perMember.find((m) => m.memberId === 'a')!.status).toBe('significantly_off')
    expect(r.label).toBe('Slightly Uneven')
  })

  it('zero total falls back to ideal share (no division by zero)', () => {
    const r = computeFairness([{ memberId: 'a', points: 0 }, { memberId: 'b', points: 0 }])
    expect(r.householdScore).toBe(100)
    expect(r.perMember.every((m) => m.percentage === 50 && m.status === 'balanced')).toBe(true)
  })

  it('labels', () => {
    expect(fairnessLabel(95)).toBe('Perfectly Balanced')
    expect(fairnessLabel(80)).toBe('Well Balanced')
    expect(fairnessLabel(65)).toBe('Slightly Uneven')
    expect(fairnessLabel(45)).toBe('Needs Attention')
    expect(fairnessLabel(20)).toBe('Significantly Uneven')
  })
})
