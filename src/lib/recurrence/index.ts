/**
 * Generic recurrence occurrence math — a pure, dependency-free engine for projecting the dates a
 * recurring template fires on. Designed to be shared by a spawn Cron (materializing due instances)
 * and the client (previewing upcoming instances), so both compute the same set.
 *
 * Two correctness properties the engine guarantees:
 *
 *   1. **UTC date-only math.** Every date is a tz-free 'YYYY-MM-DD' string and stepping is pure UTC,
 *      so a DST boundary can never shift or drop an occurrence (a naive `dateStr + 'T00:00:00'`
 *      LOCAL parse with `setDate` stepping drifts a day across spring-forward under Hermes/UTC).
 *   2. **Calendar-correct clamping.** MONTHLY/QUARTERLY clamp the 31st down to each month's last day
 *      (31 → 28/29/30), and YEARLY clamps the same way so Feb 29 → Feb 28 in non-leap years rather
 *      than overflowing to Mar 1.
 *
 * `getOccurrences` returns every occurrence in [startDate, min(throughDate, endDate)]; a caller that
 * only wants the newly-due set (e.g. a Cron) uses `dueOccurrences(spec, lastSpawnedDate, …)`.
 */

/** The supported recurrence cadences. Inlined here so the engine carries no app vocabulary. */
export type RecurrencePattern = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'

/** Frozen list of the cadences, e.g. for populating a picker. */
export const RECURRENCE_PATTERNS: readonly RecurrencePattern[] = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
] as const

export interface RecurrenceSpec {
  pattern: RecurrencePattern
  dayOfWeek?: number | null // 0 (Sun) – 6 (Sat); WEEKLY / BIWEEKLY
  dayOfMonth?: number | null // 1 – 31; MONTHLY / QUARTERLY / YEARLY (clamped to month length)
  startDate: string // 'YYYY-MM-DD' (the anchor — biweekly parity is measured from here)
  endDate?: string | null // inclusive; 'YYYY-MM-DD'
}

/** Hard safety cap so a malformed template can never loop forever. */
const MAX_OCCURRENCES = 1000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function iso(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`
}
function parse(s: string): [number, number, number] {
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10))
  return [y, m - 1, d] // month → 0-based
}
function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

export function getOccurrences(spec: RecurrenceSpec, throughDate: string): string[] {
  const results: string[] = []
  const { startDate, endDate } = spec
  // The effective horizon is the earlier of throughDate and endDate.
  const horizon = endDate && endDate < throughDate ? endDate : throughDate
  if (horizon < startDate) return results

  const [sy, sm, sd] = parse(startDate)

  if (spec.pattern === 'WEEKLY' || spec.pattern === 'BIWEEKLY') {
    const step = spec.pattern === 'BIWEEKLY' ? 14 : 7
    let dt = new Date(Date.UTC(sy, sm, sd))
    if (spec.dayOfWeek != null) {
      const diff = (spec.dayOfWeek - dt.getUTCDay() + 7) % 7
      dt = new Date(Date.UTC(sy, sm, sd + diff)) // first target weekday on/after the anchor
    }
    while (results.length < MAX_OCCURRENCES) {
      const s = iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
      if (s > horizon) break
      if (s >= startDate) results.push(s)
      dt = new Date(dt.getTime() + step * 86_400_000) // UTC step — DST-immune
    }
    return results
  }

  if (spec.pattern === 'MONTHLY' || spec.pattern === 'QUARTERLY') {
    const dom = spec.dayOfMonth ?? sd
    const monthStep = spec.pattern === 'QUARTERLY' ? 3 : 1
    let y = sy
    let m = sm
    while (results.length < MAX_OCCURRENCES) {
      const day = Math.min(dom, daysInMonth(y, m)) // clamp 31st → 28/29/30
      const s = iso(y, m, day)
      if (s > horizon) break
      if (s >= startDate) results.push(s)
      m += monthStep
      if (m > 11) {
        y += Math.floor(m / 12)
        m %= 12
      }
    }
    return results
  }

  // YEARLY — same month as the anchor, clamped day (Feb 29 → Feb 28 in non-leap years).
  const dom = spec.dayOfMonth ?? sd
  let y = sy
  while (results.length < MAX_OCCURRENCES) {
    const day = Math.min(dom, daysInMonth(y, sm))
    const s = iso(y, sm, day)
    if (s > horizon) break
    if (s >= startDate) results.push(s)
    y += 1
  }
  return results
}

/** Occurrences strictly after `lastSpawnedDate` (exclusive) through `throughDate` — the due set. */
export function dueOccurrences(
  spec: RecurrenceSpec,
  lastSpawnedDate: string | null,
  throughDate: string,
): string[] {
  const all = getOccurrences(spec, throughDate)
  return lastSpawnedDate ? all.filter((d) => d > lastSpawnedDate) : all
}
