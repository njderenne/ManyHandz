/**
 * The canonical points engine — ONE implementation, server-authoritative, used everywhere (the
 * Worker awards with it, the client previews with it, fairness reads its output). The previous app's
 * #1 bug was three divergent point formulas; this is the brief's §6 reconciliation, implemented once.
 *
 * Pure (no imports) so both the Worker and the client share it byte-for-byte. Points are integers.
 */

export type CompletionPhotos = 'both' | 'one' | 'none'

export type PointsInput = {
  /** Chore difficulty, 1–5. */
  difficulty: number
  /** Chore estimate in minutes. */
  estimatedMinutes: number
  /** Stopwatch result in whole minutes; null/undefined when the timer wasn't used. */
  actualMinutes?: number | null
  /** The member's current streak (consecutive days) BEFORE this completion. */
  currentStreak?: number
  /** Whether before/after photos were attached. */
  photos?: CompletionPhotos
  /** True when completed before the due date. */
  early?: boolean
  /** Active double-points challenge multiplier (1.5 / 2 / 3); 1 (or omitted) when none. */
  challengeMultiplier?: number
}

export type PointsBreakdown = {
  base: number
  streakBonus: number
  speedBonus: number
  photoBonus: number
  earlyBonus: number
  total: number
}

const clampNonNeg = (n: number) => (n > 0 ? n : 0)

/** Base points: difficulty weighted by the time estimate (a 1-pt unit ≈ 15 min of difficulty-1 work).
 *  Integer numerator before the divide — never `× (minutes/15)` — so float drift can't nudge an exact
 *  value over an integer boundary and make `ceil` round up. */
export function basePoints(difficulty: number, estimatedMinutes: number): number {
  return Math.ceil((clampNonNeg(difficulty) * clampNonNeg(estimatedMinutes)) / 15)
}

/** Streak bonus: +10%/consecutive day, capped at +50%. Integer percent math (×10/100, not ×0.1)
 *  to avoid `3 × 0.1 = 0.30000000000000004` rounding the bonus up. */
export function streakBonus(base: number, currentStreak: number): number {
  return Math.ceil((base * Math.min(clampNonNeg(currentStreak) * 10, 50)) / 100)
}

/**
 * Speed bonus: reward finishing under the estimate, capped at 50% of base. Zero unless the timer ran
 * for ≥ 2 minutes AND beat the estimate (guards against tap-through "0 minute" completions).
 */
export function speedBonus(base: number, estimatedMinutes: number, actualMinutes: number | null | undefined): number {
  if (actualMinutes == null || actualMinutes < 2 || estimatedMinutes <= 0) return 0
  if (actualMinutes >= estimatedMinutes) return 0
  const raw = Math.floor(((estimatedMinutes - actualMinutes) / estimatedMinutes) * base * 0.5)
  return Math.min(raw, Math.ceil(base * 0.5))
}

/** Compute the full points breakdown for a completion. The multiplier applies to performance points
 *  (base + streak + speed) only — flat photo/early bonuses are never multiplied. */
export function computePoints(input: PointsInput): PointsBreakdown {
  const base = basePoints(input.difficulty, input.estimatedMinutes)
  const streak = streakBonus(base, input.currentStreak ?? 0)
  const speed = speedBonus(base, input.estimatedMinutes, input.actualMinutes)
  const photoBonus = input.photos === 'both' ? 3 : input.photos === 'one' ? 1 : 0
  const earlyBonus = input.early ? 2 : 0
  const multiplier = Math.max(1, input.challengeMultiplier ?? 1)
  const total = Math.ceil((base + streak + speed) * multiplier) + photoBonus + earlyBonus
  return { base, streakBonus: streak, speedBonus: speed, photoBonus, earlyBonus, total }
}

/**
 * Next streak value given the prior completion date. Day strings are YYYY-MM-DD in the household tz.
 * +1 if the prior approved completion was yesterday; unchanged if already today; else reset to 1.
 */
export function nextStreak(current: number, lastDate: string | null, today: string, yesterday: string): number {
  if (lastDate === today) return current
  if (lastDate === yesterday) return current + 1
  return 1
}
