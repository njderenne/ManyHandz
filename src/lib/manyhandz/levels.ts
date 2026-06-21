/**
 * XP & levels — cumulative XP (lifetime points earned, never decreases) drives 50 levels and titles.
 * Anchor thresholds from the brief §6; intermediate levels are linearly interpolated between anchors
 * so the curve is smooth. Pure (Worker + client share it). XP is computed as the SUM of positive
 * point awards from the credit ledger — derived, never a stored column.
 */

export const MAX_LEVEL = 50

/** [level, cumulative-XP] anchors; everything between is interpolated. */
const ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [2, 50], [3, 120], [4, 200], [5, 350], [6, 500], [7, 700], [8, 1000],
  [9, 1300], [10, 1700], [15, 4000], [20, 8000], [25, 14000], [30, 22000], [40, 45000], [50, 80000],
]

/** Full XP threshold per level 1..50 (index 0 unused), built once by interpolating the anchors. */
const THRESHOLDS: number[] = (() => {
  const t: number[] = new Array(MAX_LEVEL + 1).fill(0)
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [loLvl, loXp] = ANCHORS[i]
    const [hiLvl, hiXp] = ANCHORS[i + 1]
    for (let lvl = loLvl; lvl <= hiLvl; lvl++) {
      const frac = (lvl - loLvl) / (hiLvl - loLvl)
      t[lvl] = Math.round(loXp + frac * (hiXp - loXp))
    }
  }
  return t
})()

type Title =
  | 'Rookie' | 'Helper' | 'Contributor' | 'Household Pro'
  | 'Chore Master' | 'Household Legend' | 'ManyHandz Elite' | 'Hall of Fame'

/** Title for a level (brief §6 bands). */
export function titleForLevel(level: number): Title {
  if (level >= 50) return 'Hall of Fame'
  if (level >= 40) return 'ManyHandz Elite'
  if (level >= 30) return 'Household Legend'
  if (level >= 20) return 'Chore Master'
  if (level >= 15) return 'Household Pro'
  if (level >= 10) return 'Contributor'
  if (level >= 5) return 'Helper'
  return 'Rookie'
}

/** Cumulative XP required to reach a level (clamped to 1..MAX_LEVEL). */
export function xpForLevel(level: number): number {
  return THRESHOLDS[Math.min(Math.max(level, 1), MAX_LEVEL)]
}

/** The level for a given lifetime XP — the highest level whose threshold is met. */
export function levelForXp(xp: number): number {
  let level = 1
  for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
    if (xp >= THRESHOLDS[lvl]) level = lvl
    else break
  }
  return level
}

export type LevelProgress = {
  level: number
  title: Title
  xp: number
  /** XP earned into the current level. */
  xpIntoLevel: number
  /** XP span of the current level (0 at MAX_LEVEL). */
  xpForLevelSpan: number
  /** 0–1 progress to the next level (1 at MAX_LEVEL). */
  progress: number
  /** XP remaining to the next level (0 at MAX_LEVEL). */
  xpToNext: number
}

/** Full progress summary for an XP total — what the level/XP bar renders. */
export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp)
  const title = titleForLevel(level)
  if (level >= MAX_LEVEL) {
    return { level, title, xp, xpIntoLevel: 0, xpForLevelSpan: 0, progress: 1, xpToNext: 0 }
  }
  const floor = THRESHOLDS[level]
  const ceil = THRESHOLDS[level + 1]
  const span = ceil - floor
  const into = xp - floor
  return {
    level,
    title,
    xp,
    xpIntoLevel: into,
    xpForLevelSpan: span,
    progress: span > 0 ? Math.min(1, into / span) : 1,
    xpToNext: Math.max(0, ceil - xp),
  }
}
