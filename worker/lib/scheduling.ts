/**
 * Scheduling — PURE functions to compute due slots WITHOUT materializing them, plus the
 * adherence/streak math. Generalized from RxMndr's production dose engine (scheduling.ts),
 * domain-neutralized: a `SchedulableItem` is anything with wall-clock times of day, an optional
 * weekday rule, and an optional date window (a medication schedule, a chore rota, a check-in).
 *
 * THE DOCTRINE (computed-not-materialized): never write a row per upcoming slot. "What is due"
 * is computed on read for any window — which makes the system downtime-safe by construction
 * (a cron that was down overnight recomputes yesterday's slots and catches up; there is no
 * pre-written table to have gone stale). A slot only becomes a DB row once something HAPPENS to
 * it (completed / escalated / missed).
 *
 * Everything here is pure (no DB, no clock except the explicit date args) so it is trivially
 * unit-testable — see scheduling.test.ts. Pairs with worker/lib/escalation.ts: an app's
 * `escalationSources` entry typically calls `computeDueSlots` for today + yesterday and emits
 * the still-unconfirmed past-due ones (RxMndr cron.ts step 3, the reference orchestration).
 */

/** Chassis-neutral fallback zone. RxMndr defaulted to the app's home zone (America/Chicago) —
 *  that was app policy; the template defaults to UTC and apps pass real user zones. */
const DEFAULT_TZ = 'UTC'

/** Completed more than this long after `scheduledFor` counts as late (donor's §26 threshold). */
export const ON_TIME_GRACE_MS = 30 * 60 * 1000

// ---------------------------------------------------------------------------
// Timezone conversion
// ---------------------------------------------------------------------------

/**
 * Convert a local wall-clock time in an IANA timezone to the corresponding UTC `Date`.
 *
 * Workers have no Temporal and no tz database beyond Intl, so we use the "offset trick":
 *   1. Make a UTC guess as if the wall-clock numbers were already UTC (Date.UTC).
 *   2. Format that instant *in the target tz* (Intl, hour12:false, all numeric parts).
 *   3. Parse the formatted local time back to numbers — this is what the guess actually reads
 *      as in the target zone.
 *   4. delta = intendedLocal - formattedLocal. Shift the guess by delta to land on the instant
 *      whose local rendering equals the requested wall-clock time.
 *
 * One correction pass is exact for all standard fixed-offset and DST cases (the offset is locally
 * constant away from the ~1hr/year transition seams). At the seams it stays deterministic: a
 * spring-forward wall time that doesn't exist (e.g. 02:30 the night clocks jump 02:00→03:00)
 * lands on the equivalent post-jump instant (03:30 local), and a fall-back wall time that exists
 * twice resolves to the FIRST occurrence. `timeZone` null/empty falls back to UTC.
 */
export function zonedWallTimeToUtc(dateStr: string, hhmm: string, timeZone: string | null | undefined): Date {
  const tz = timeZone && timeZone.trim() ? timeZone.trim() : DEFAULT_TZ
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)

  // Intended local wall-clock as a "fake UTC" epoch (the number we want the tz to read back).
  const intendedUtc = Date.UTC(y, mo - 1, d, hh, mm, 0, 0)

  const guess = new Date(intendedUtc)
  const formattedLocal = wallClockEpochInTz(guess, tz)

  // How far the guess's local rendering is from what we intended. Correct by exactly that.
  const delta = intendedUtc - formattedLocal
  return new Date(guess.getTime() + delta)
}

/**
 * Render `instant` in `tz` and return the wall-clock components as a "fake UTC" epoch (i.e.
 * Date.UTC of the local Y/M/D H:M:S). Lets us diff two wall-clock readings as plain numbers.
 * A bad/unknown tz string falls back to UTC — never let formatting break a sweep.
 */
function wallClockEpochInTz(instant: Date, tz: string): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(instant)
  } catch {
    return instant.getTime() // unknown tz — read the instant as already-UTC
  }

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  let hour = get('hour')
  // Intl can emit "24" for midnight under hour12:false in some engines — normalize to 0.
  if (hour === 24) hour = 0
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
}

// ---------------------------------------------------------------------------
// Due-slot computation
// ---------------------------------------------------------------------------

/**
 * Anything with a recurring wall-clock schedule. The app maps its domain rows into this shape
 * (RxMndr: medication+schedule pairs; a chore app: rota rows) — the engine never sees domain
 * tables. Date strings are 'YYYY-MM-DD' in the ITEM'S OWN local zone.
 */
export interface SchedulableItem {
  id: string
  /** First day the item is schedulable; null/absent = no lower bound. */
  startDate?: string | null
  /** Last day (INCLUSIVE); null/absent = open-ended. */
  endDate?: string | null
  /** Local wall-clock 'HH:MM' slots — one due slot per entry per firing day. */
  timesOfDay: string[]
  /** Weekday rule, 0=Sun..6=Sat; null/absent = fires every day. Empty array = never fires. */
  daysOfWeek?: number[] | null
  /** IANA zone the wall-clock times live in; falls back to args.timeZone, then UTC. */
  timezone?: string | null
}

export interface DueSlot {
  itemId: string
  /** The UTC instant the slot is due. */
  scheduledFor: Date
  /** Local wall-clock "HH:MM" of the slot. */
  localTime: string
}

export interface ComputeDueSlotsArgs {
  items: SchedulableItem[]
  /** Target day, 'YYYY-MM-DD' in the items' local zone. */
  dateStr: string
  /** Fallback tz for items without their own. Defaults to UTC. */
  timeZone?: string | null
}

/** Local weekday (0=Sun..6=Sat) of a 'YYYY-MM-DD' — computed from the date parts, tz-independent. */
function weekdayOf(dateStr: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
}

/** dateStr within [start, end] (either bound nullable = open). String compare is valid for ISO. */
function inDateRange(dateStr: string, start: string | null | undefined, end: string | null | undefined): boolean {
  if (start && dateStr < start) return false
  if (end && dateStr > end) return false
  return true
}

/** Coerce a stored time to canonical "HH:MM" (zero-padded), or null if unparseable — bad rows
 *  are skipped, never thrown on (schedules are user input that predates validation). */
function normalizeHHMM(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * Compute the due slots for `dateStr`: for each in-window item that fires that weekday, one slot
 * per entry in timesOfDay. Slots are sorted by scheduledFor for stable downstream rendering.
 * Pure — call it for ANY date (today, yesterday's catch-up window, a report range) at zero risk.
 */
export function computeDueSlots(args: ComputeDueSlotsArgs): DueSlot[] {
  const { items, dateStr } = args
  const fallbackTz = args.timeZone && args.timeZone.trim() ? args.timeZone : DEFAULT_TZ

  const slots: DueSlot[] = []

  for (const item of items) {
    if (!inDateRange(dateStr, item.startDate, item.endDate)) continue

    // Weekday rule: absent/null = daily; [] = never (an explicitly emptied rule stays silent).
    if (item.daysOfWeek != null && !item.daysOfWeek.includes(weekdayOf(dateStr))) continue

    const tz = item.timezone && item.timezone.trim() ? item.timezone : fallbackTz

    for (const raw of item.timesOfDay) {
      const localTime = normalizeHHMM(raw)
      if (!localTime) continue
      slots.push({
        itemId: item.id,
        scheduledFor: zonedWallTimeToUtc(dateStr, localTime, tz),
        localTime,
      })
    }
  }

  slots.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
  return slots
}

// ---------------------------------------------------------------------------
// Adherence & streak math (donor §26, domain-neutralized)
// ---------------------------------------------------------------------------

/** Minimal event shape for adherence: was the slot completed, and when. The CALLER maps its
 *  domain statuses ('taken'/'applied' → completed) and excludes ad-hoc/unscheduled events. */
export interface AdherenceEvent {
  /** true = the slot was completed (done/taken/logged). Skipped/missed events are false. */
  completed: boolean
  scheduledFor: Date | string | null
  completedAt: Date | string | null
}

export interface AdherenceStats {
  /** completed ÷ scheduled, 0–100 (rounded). */
  adherencePct: number
  /** on-time ÷ scheduled, 0–100 (rounded). on-time = completed within ON_TIME_GRACE_MS of scheduled. */
  onTimePct: number
  scheduled: number
  completed: number
  onTime: number
}

function toMs(v: Date | string | null): number | null {
  if (v == null) return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Adherence over a window. `scheduledCount` is the number of scheduled slots in the window —
 * computed upstream from computeDueSlots across the date range (the denominator comes from the
 * SCHEDULE, never from the events, so unlogged slots count against adherence). A completed event
 * with no scheduled time is counted as completed but not on-time.
 */
export function adherenceStats(
  events: AdherenceEvent[],
  scheduledCount: number,
  opts: { onTimeGraceMs?: number } = {},
): AdherenceStats {
  const graceMs = opts.onTimeGraceMs ?? ON_TIME_GRACE_MS
  let completed = 0
  let onTime = 0

  for (const ev of events) {
    if (!ev.completed) continue
    completed++

    const sched = toMs(ev.scheduledFor)
    const done = toMs(ev.completedAt)
    if (sched != null && done != null && done <= sched + graceMs) {
      onTime++
    }
  }

  const denom = scheduledCount > 0 ? scheduledCount : 0
  const pct = (n: number) => (denom === 0 ? 0 : Math.round((n / denom) * 100))

  return {
    adherencePct: pct(completed),
    onTimePct: pct(onTime),
    scheduled: denom,
    completed,
    onTime,
  }
}

/** Per-day rollup for streak computation. */
export interface PerfectDayFlag {
  /** 'YYYY-MM-DD' (local). Ordered or unordered — computeStreak sorts descending internally. */
  date: string
  /** Scheduled slots that day. A day with 0 scheduled slots is neutral (skipped). */
  scheduled: number
  /** Completed slots that day. */
  completed: number
}

/**
 * Streak: count consecutive days (walking backwards from the most recent) where ALL scheduled
 * slots were completed. A day with no scheduled slots is neutral — it does not break the streak
 * and does not increment it.
 *
 * With `graceEnabled`, a day with exactly one miss (completed === scheduled - 1) still counts —
 * but grace is consumed at most ONCE across the whole streak walk (a single-miss grace, not
 * one-per-day). This deliberately replaces the naïve done→+1 / missed→0 trigger every legacy
 * codebase seems to grow (RxMndr's LEGACY_DOMAIN_REFERENCE §5.1, the DB-bug-not-to-port).
 */
export function computeStreak(perfectDayFlags: PerfectDayFlag[], graceEnabled = false): number {
  // Most-recent first.
  const days = [...perfectDayFlags].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  let streak = 0
  let graceUsed = false

  for (const day of days) {
    if (day.scheduled <= 0) {
      // Neutral day — doesn't extend or break the streak.
      continue
    }
    if (day.completed >= day.scheduled) {
      streak++
      continue
    }
    // Imperfect day. Grace covers exactly-one-miss, once.
    if (graceEnabled && !graceUsed && day.completed === day.scheduled - 1) {
      graceUsed = true
      streak++
      continue
    }
    break
  }

  return streak
}
