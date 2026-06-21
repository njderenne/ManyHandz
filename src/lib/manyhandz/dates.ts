/**
 * Household-timezone date helpers. Day boundaries (streaks, "overdue", "early", birthdays) are in the
 * household's IANA timezone, not UTC, so clock math never breaks across midnights/DST. Pure; shared
 * by the Worker (completion engine, crons) and the client. Dates are YYYY-MM-DD strings.
 */

/** Today as YYYY-MM-DD in an IANA timezone (en-CA formats as ISO date). */
export function todayInTz(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/** Shift a YYYY-MM-DD string by whole days (anchored at UTC-noon to dodge DST edges). */
export function shiftDate(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  return dt.toISOString().slice(0, 10)
}

export const yesterdayOf = (ymd: string) => shiftDate(ymd, -1)

/** Compare two YYYY-MM-DD strings: <0 if a before b, 0 equal, >0 after. (String compare is correct.) */
export function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
