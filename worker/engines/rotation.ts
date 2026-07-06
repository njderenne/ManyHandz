/**
 * Rotation engine — "whose turn is it?" as a pure function (ManyHandz chore-assignment lesson:
 * its old app's rotation doubled/dropped assignments on missed days because the answer lived in
 * mutable state; the rebuild made the resolver pure and let the cron own persistence).
 *
 * The chassis generalization drops ManyHandz's ordered-list + index model for a stateless one:
 * the caller passes what it already knows about each candidate (when they were last assigned,
 * how much they currently carry) and the engine ranks them. That means no rotation-group table
 * is required — any domain table with an assignee + timestamp can derive its own rotation.
 *
 * DETERMINISTIC TIE-BREAK IS THE CONTRACT: every comparison falls through to a stable sort by
 * id, so two Workers (or a Worker and a test) given the same rows compute the same answer —
 * a rotation that depends on row order out of the DB is a distributed-systems bug in a party hat.
 *
 * Pure per the engines convention (README.md): callers fetch + org-scope the candidate rows
 * (skipping away/archived members THEMSELVES — availability is domain knowledge) and persist
 * the assignment; this module only ranks.
 */

/** One candidate. Map your rows onto this — id is the tie-break key, so use a stable row id. */
export type RotationMember = {
  id: string
  /** When this member last received an assignment (null = never — they go first). */
  lastAssignedAt: Date | null
  /** Current open workload (open assignments, active chores, …) — only 'least_loaded' reads it. */
  load: number
}

export type RotationStrategy = 'round_robin' | 'least_loaded'

export type RotationOptions = { strategy: RotationStrategy }

/**
 * All candidates in assignment order (best pick first). Exposed because "show the upcoming
 * rotation" is a real screen; nextAssignee() is just element zero.
 *
 *   round_robin  — least-recently-assigned first (never-assigned before everyone), so turns
 *                  circulate without any stored index; ties by id.
 *   least_loaded — lightest current load first; ties by least-recently-assigned, then id.
 *
 * Input is never mutated (callers may pass query results straight in).
 */
export function rotationOrder(
  members: RotationMember[],
  opts: RotationOptions,
): RotationMember[] {
  const byLastAssigned = (a: RotationMember, b: RotationMember): number => {
    // null = never assigned = infinitely long ago — sorts before any real timestamp.
    if (a.lastAssignedAt === null && b.lastAssignedAt === null) return 0
    if (a.lastAssignedAt === null) return -1
    if (b.lastAssignedAt === null) return 1
    return a.lastAssignedAt.getTime() - b.lastAssignedAt.getTime()
  }

  const compare =
    opts.strategy === 'least_loaded'
      ? (a: RotationMember, b: RotationMember) =>
          a.load - b.load || byLastAssigned(a, b) || a.id.localeCompare(b.id)
      : (a: RotationMember, b: RotationMember) =>
          byLastAssigned(a, b) || a.id.localeCompare(b.id)

  return [...members].sort(compare)
}

/**
 * The next assignee, or null when there are no candidates (everyone away/archived — the caller
 * skips the period rather than guessing; ManyHandz's vacation-safe rule: an empty pool means
 * NO assignment this round, never a stale default).
 */
export function nextAssignee(
  members: RotationMember[],
  opts: RotationOptions,
): RotationMember | null {
  if (members.length === 0) return null
  return rotationOrder(members, opts)[0]
}
