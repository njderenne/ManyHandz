/**
 * Streak + points derivation engine — the DERIVE-NEVER-STORE twin of the check-in flow in
 * worker/streaks.ts (which this module complements and never touches).
 *
 * worker/streaks.ts is the WRITE path: a check-in upserts one `streak` counter row and the
 * effective value is projected on read. This module is the READ-EVERYTHING path: given raw
 * event timestamps (workout rows, practice logs, journal entries — any `{ at }` shape) it
 * derives the same streak semantics with zero stored state, which is what leaderboards,
 * reports, and per-kind breakdowns need — they aggregate over rows that were never routed
 * through recordActivity(). The Project Gains lesson made this doctrine: a STORED derived
 * streak/leaderboard value drifts from its source rows the first time a write is missed or
 * backdated; deriving at read can never drift.
 *
 * Pure + deterministic per the engines convention (README.md): the clock is injectable
 * (`opts.now`), day boundaries use the caller's IANA timezone, and no I/O happens here — the
 * route/cron fetches the rows (org-scoped, rule 4) and hands them over as plain objects.
 */

/** Any timestamped fact — map your domain rows onto this ({ at: row.createdAt }, …). */
export type StreakEvent = { at: Date }

export type StreakOptions = {
  /** IANA zone for day boundaries — resolve from user_settings.timezone (worker/streaks.ts
   *  resolveTimezone); defaults to 'UTC'. Invalid zones fall back to UTC (never throw). */
  timezone?: string
  /** Missed days tolerated before a streak breaks — 0 (default) = strictly consecutive days;
   *  1 = a single skipped day doesn't break the run (RxMndr's once-only grace, generalized). */
  graceDays?: number
  /** Injectable clock (engines convention) — "is the streak still alive?" is relative to now. */
  now?: Date
}

/**
 * Mirrors the field names of worker/streaks.ts EffectiveStreak so screens can render either
 * source with one component. `activeDays` is the derivation bonus: total distinct active days.
 */
export type DerivedStreak = {
  /** Consecutive-day count ending at the last active day — 0 when broken as of `now`. */
  currentCount: number
  /** Longest run anywhere in the history — survives breaks. */
  longestCount: number
  /** YYYY-MM-DD (in `timezone`) of the most recent event; null = no events. */
  lastActivityDate: string | null
  /** Total distinct active days across the whole input — the "days logged" stat. */
  activeDays: number
}

/**
 * Local calendar date (YYYY-MM-DD) of `at` in `timezone`. Mirrors localDate() in
 * worker/streaks.ts (en-CA's default format IS ISO; explicit 2-digit options pin it against ICU
 * drift) — duplicated here so the engine stays import-free per the README purity rule; keep the
 * two in sync. An invalid zone falls back to the UTC calendar date instead of throwing.
 */
function localDay(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

/** Whole calendar days from `a` to `b` (both YYYY-MM-DD) — pure date math, tz-independent. */
function dayDiff(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  )
}

/**
 * Derive streak state from raw events. Semantics match worker/streaks.ts:
 *
 *   - Multiple events on one local day count once (distinct active DAYS, not event count).
 *   - A run continues while the gap between consecutive active days is ≤ graceDays + 1
 *     (gap 1 = adjacent days; graceDays 0 = strictly consecutive).
 *   - currentCount is the run ending at the last active day, read as 0 when that day is more
 *     than graceDays + 1 days before "today" — broken streaks are computed on READ, never by
 *     a reset job (the streak-table doc's no-cron design, inherited here).
 *   - Events "in the future" of `now` (clock skew, westward tz change) still count as their
 *     local day; a last-active day at or after today reads as alive.
 */
export function computeStreakFromEvents(
  events: StreakEvent[],
  opts: StreakOptions = {},
): DerivedStreak {
  const timezone = opts.timezone ?? 'UTC'
  const graceDays = Math.max(0, Math.floor(opts.graceDays ?? 0))
  const now = opts.now ?? new Date()
  const maxGap = graceDays + 1

  // Distinct active days, ascending. Set → sort keeps this O(n log n) and duplicate-proof.
  const days = [...new Set(events.map((e) => localDay(e.at, timezone)))].sort()
  if (days.length === 0) {
    return { currentCount: 0, longestCount: 0, lastActivityDate: null, activeDays: 0 }
  }

  // One pass: track the run ending at each day; remember the longest and the final run.
  let runLength = 1
  let longest = 1
  for (let i = 1; i < days.length; i++) {
    runLength = dayDiff(days[i - 1], days[i]) <= maxGap ? runLength + 1 : 1
    if (runLength > longest) longest = runLength
  }

  const lastDay = days[days.length - 1]
  const today = localDay(now, timezone)
  // Alive while today is within the grace window of the last active day. dayDiff is negative
  // for a future-dated last day (westward tz change) — still alive, mirroring streaks.ts.
  const alive = dayDiff(lastDay, today) <= maxGap

  return {
    currentCount: alive ? runLength : 0,
    longestCount: longest,
    lastActivityDate: lastDay,
    activeDays: days.length,
  }
}

// ---------------------------------------------------------------------------
// Points summary — the credit_ledger derivation twin
// ---------------------------------------------------------------------------

/** One ledger fact. Map credit_ledger rows as { amount: row.delta, kind: row.kind, at: row.createdAt }. */
export type PointsEntry = {
  /** Signed: positive = earn, negative = spend (credit_ledger.delta convention). */
  amount: number
  /** Per-app vocab ('signup', 'referral', 'purchase', …) — drives the byKind breakdown. */
  kind: string
  at: Date
}

/** Half-open window [start, end) — the standard "this week/month" report slice. */
export type PointsWindow = { start: Date; end: Date }

export type PointsSummary = {
  /** Net points inside the window (earned + spent, spent being negative). */
  total: number
  /** Sum of positive amounts only. */
  earned: number
  /** Sum of negative amounts only (a NEGATIVE number — the sign is information). */
  spent: number
  /** Net per kind — leaderboard/report breakdown rows. */
  byKind: Record<string, number>
  /** Ledger entries that landed in the window. */
  count: number
}

/**
 * Summarize a points/credit ledger over a window. Same doctrine as the balance read in
 * worker/credits.ts (SUM over the ledger IS the balance — no stored counter); this is the
 * windowed/report flavor over already-fetched rows. Deterministic: byKind keys are sorted so
 * two workers serialize identical JSON.
 */
export function pointsSummary(ledger: PointsEntry[], window: PointsWindow): PointsSummary {
  const startMs = window.start.getTime()
  const endMs = window.end.getTime()

  let total = 0
  let earned = 0
  let spent = 0
  let count = 0
  const byKind = new Map<string, number>()

  for (const entry of ledger) {
    const at = entry.at.getTime()
    if (at < startMs || at >= endMs) continue
    count += 1
    total += entry.amount
    if (entry.amount >= 0) earned += entry.amount
    else spent += entry.amount
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + entry.amount)
  }

  // Sorted keys → deterministic serialization (engines convention rule 2).
  const byKindSorted: Record<string, number> = {}
  for (const kind of [...byKind.keys()].sort()) byKindSorted[kind] = byKind.get(kind)!

  return { total, earned, spent, byKind: byKindSorted, count }
}
