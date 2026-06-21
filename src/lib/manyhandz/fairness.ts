/**
 * Effort-weighted fairness — the roommate hero feature, and the differentiator the brief protects.
 * Each member's contribution is the SUM of (pointsEarned + speedBonus) over approved completions in
 * the period (so a hard 40-min chore outweighs an easy 2-min one — never a raw task count, never the
 * coarse 1–3 proxy the category is criticized for). Pure (Worker computes it for reports; client
 * renders it). Away / Birthday-Pass members are excluded by the caller before this runs.
 */

export type MemberContribution = { memberId: string; points: number }

export type FairnessStatus = 'balanced' | 'slightly_off' | 'significantly_off'

export type MemberFairness = {
  memberId: string
  points: number
  /** Share of the household's total effort, 0–100. */
  percentage: number
  /** percentage − idealShare (signed: positive = doing more than their share). */
  deviation: number
  status: FairnessStatus
}

export type FairnessResult = {
  perMember: MemberFairness[]
  /** Household balance score, 0–100 (100 = perfectly even, or a single-member household). */
  householdScore: number
  label: string
}

function statusFor(absDeviation: number): FairnessStatus {
  if (absDeviation <= 5) return 'balanced'
  if (absDeviation <= 15) return 'slightly_off'
  return 'significantly_off'
}

/** Household balance label (brief §5.11). */
export function fairnessLabel(score: number): string {
  if (score >= 90) return 'Perfectly Balanced'
  if (score >= 75) return 'Well Balanced'
  if (score >= 60) return 'Slightly Uneven'
  if (score >= 40) return 'Needs Attention'
  return 'Significantly Uneven'
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Compute fairness for the active members of a household. Pass each member's effort total
 * (pointsEarned + speedBonus over approved completions). A single-member household is always 100.
 */
export function computeFairness(members: MemberContribution[]): FairnessResult {
  const count = members.length
  if (count === 0) {
    return { perMember: [], householdScore: 100, label: fairnessLabel(100) }
  }
  const total = members.reduce((sum, m) => sum + Math.max(0, m.points), 0)
  const idealShare = 100 / count

  const perMember: MemberFairness[] = members.map((m) => {
    const points = Math.max(0, m.points)
    const percentage = total > 0 ? (points / total) * 100 : idealShare
    const deviation = percentage - idealShare
    return { memberId: m.memberId, points, percentage, deviation, status: statusFor(Math.abs(deviation)) }
  })

  // Single-member households are trivially "balanced" — don't penalize.
  const householdScore =
    count <= 1
      ? 100
      : clamp(
          Math.round(100 - perMember.reduce((sum, m) => sum + Math.abs(m.deviation), 0) / count),
          0,
          100,
        )

  return { perMember, householdScore, label: fairnessLabel(householdScore) }
}
