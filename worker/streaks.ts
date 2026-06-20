import { and, eq, sql } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'

/**
 * Streaks — THE server-side way to touch the `streak` table (consecutive-day engagement
 * counters; see the table doc in src/lib/db/schema.ts). Two entry points:
 *
 *   recordActivity() — "the user did the thing today": same day = no-op, yesterday = increment,
 *                      older/none = reset to 1; longestCount tracks the high-water mark.
 *   readStreak()     — the EFFECTIVE state for display: a row whose lastActivityDate is before
 *                      yesterday reads as currentCount 0 (broken streaks are computed on READ,
 *                      not by a cron — rows never need a reset job, per the table doc).
 *
 * Day boundaries are YYYY-MM-DD strings in the USER'S timezone (user_settings.timezone), so
 * clock math never breaks streaks across midnights/DST. Both functions accept the timezone as a
 * param — ROUTES resolve it (resolveTimezone below); helpers never guess.
 *
 * Unlike notify(), these THROW on DB failure: a check-in route needs the result. Product routes
 * recording a streak as a side effect of a domain action should wrap the call in try/catch so a
 * streak hiccup never fails the action itself.
 *
 * @example
 * // In a product route, after the domain action succeeds:
 * const db = getDb(c.env.DATABASE_URL)
 * try {
 *   const timezone = await resolveTimezone(db, session.user.id)
 *   await recordActivity(db, { organizationId: orgId, userId: session.user.id, kind: 'workout', timezone })
 * } catch (e) {
 *   console.warn(JSON.stringify({ level: 'warn', event: 'streak.record_failed', message: String(e) }))
 * }
 */

/** Row type for the streak table — internal; callers see EffectiveStreak. */
type StreakRow = typeof schema.streak.$inferSelect

/** Identifies one streak counter. kind defaults to 'daily'; timezone to 'UTC'. */
export type StreakScope = {
  /** Verified active org — never a client-sent id. */
  organizationId: string
  /** Session user — streaks are per-member. */
  userId: string
  /** Streak vocabulary — 'daily' default; per-app kinds ('workout', 'practice', …). */
  kind?: string
  /** IANA zone for "today" — resolve from user_settings.timezone (resolveTimezone). */
  timezone?: string
}

/**
 * What callers (and the client) see — the stored row with currentCount replaced by the EFFECTIVE
 * value. Mirrored by the client in src/lib/query/hooks/useStreak.ts — keep the two in sync.
 */
export type EffectiveStreak = {
  kind: string
  /** Effective consecutive-day count — 0 when broken (lastActivityDate < yesterday) or never started. */
  currentCount: number
  /** All-time high-water mark — survives breaks. */
  longestCount: number
  /** YYYY-MM-DD in the user's timezone at the time of the last activity; null = never. */
  lastActivityDate: string | null
  /** True when today's activity is already recorded — UIs disable the check-in affordance. */
  checkedInToday: boolean
}

export type RecordActivityResult = {
  streak: EffectiveStreak
  /** True when the count advanced (increment or fresh start); false for a same-day no-op. */
  grew: boolean
}

/**
 * Today as YYYY-MM-DD in `timezone`. en-CA is the locale whose default date format IS ISO
 * (explicit 2-digit options pin it against ICU drift). An invalid stored zone falls back to UTC
 * instead of throwing — a corrupt user_settings.timezone must not 500 every check-in.
 */
export function localDate(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  } catch {
    // Last-resort only: resolveTimezone() probes zones before they get here, so this fires only
    // when a caller bypassed it. Logged — a silent UTC fallback would quietly shift the user's
    // day boundary and make streak behavior look haunted.
    console.warn(JSON.stringify({ level: 'warn', event: 'streak.timezone_invalid', timezone }))
    return at.toISOString().slice(0, 10) // UTC calendar date
  }
}

/** The calendar day before a YYYY-MM-DD string — pure date math, timezone-independent. */
function dayBefore(isoDate: string): string {
  return new Date(new Date(`${isoDate}T00:00:00Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/**
 * The user's stored IANA timezone (user_settings.timezone), falling back to 'UTC'. Validated
 * HERE — blank rejected, then probed via Intl (the only reliable zone-validity check) — so
 * localDate() always receives a real zone and its UTC fallback stays a never-path. A corrupt
 * stored value is warn-logged and falls back instead of 500ing every check-in.
 */
export async function resolveTimezone(db: DB, userId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: schema.userSettings.timezone })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1)
  const stored = row?.timezone?.trim()
  if (!stored) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: stored }) // throws on unknown/malformed zones
    return stored
  } catch {
    console.warn(
      JSON.stringify({ level: 'warn', event: 'streak.timezone_invalid', userId, stored }),
    )
    return 'UTC'
  }
}

/** Project a stored row onto its effective state for the given "today". */
function toEffective(row: StreakRow, today: string): EffectiveStreak {
  const last = row.lastActivityDate
  // String comparison is safe for YYYY-MM-DD. `>=` (not `===`) on both checks tolerates a
  // lastActivityDate "in the future" after a westward timezone change — still alive, still today.
  const alive = last !== null && last >= dayBefore(today)
  return {
    kind: row.kind,
    currentCount: alive ? row.currentCount : 0,
    longestCount: row.longestCount,
    lastActivityDate: last,
    checkedInToday: last !== null && last >= today,
  }
}

/**
 * Record one day of activity for (org, user, kind) and return the updated effective state.
 * Same day = no-op (grew: false); yesterday = increment; older/none = reset to 1. Upserts on the
 * table's (org, user, kind) unique index; the conflict branch recomputes the day transition IN
 * SQL from the row's live values, so a same-instant race can never double-increment (both racers
 * may report grew, but the count advances exactly once).
 *
 * Two abuse/edge guards on top of the day math:
 *   - Westward timezone change: a "future-dated" lastActivityDate is a no-op, never a reset.
 *   - Eastward flip-abuse: increments are floored at 6 hours since the row's last write (see the
 *     inline comment) — rapid timezone flips can't farm a week of streak in an afternoon.
 */
export async function recordActivity(db: DB, input: StreakScope): Promise<RecordActivityResult> {
  const kind = input.kind ?? 'daily'
  const today = localDate(input.timezone ?? 'UTC')
  const yesterday = dayBefore(today)

  const [existing] = await db
    .select()
    .from(schema.streak)
    .where(
      and(
        eq(schema.streak.organizationId, input.organizationId),
        eq(schema.streak.userId, input.userId),
        eq(schema.streak.kind, kind),
      ),
    )
    .limit(1)

  // Already counted today (`>=` also covers a future-dated row after a westward timezone change —
  // re-counting OR resetting there would corrupt the streak, so it's a no-op too).
  if (existing?.lastActivityDate && existing.lastActivityDate >= today) {
    return { streak: toEffective(existing, today), grew: false }
  }

  // Flip-abuse floor (timezone-INDEPENDENT, unlike the date math above): "today" trusts the
  // user's stored timezone, so flipping it eastward relabels the same wall-clock moment as the
  // next calendar day and would re-increment within minutes. If the row was written < 6 hours
  // ago, an increment is a no-op instead. Legitimate late-night → early-morning check-ins still
  // count — a no-op here doesn't break the streak, and a re-check-in later that day (≥ 6h after
  // the last write) lands. Residual abuse is bounded (a patient flipper gains at most ~4 streak
  // days per real day) and ACCEPTED: streaks gate engagement points, not money — same stance as
  // spendCredits' POINTS-ONLY contract in worker/credits.ts.
  const MIN_INCREMENT_GAP_MS = 6 * 60 * 60 * 1000
  if (
    existing?.lastActivityDate === yesterday &&
    Date.now() - existing.updatedAt.getTime() < MIN_INCREMENT_GAP_MS
  ) {
    return { streak: toEffective(existing, today), grew: false }
  }

  const nextCurrent =
    existing?.lastActivityDate === yesterday ? existing.currentCount + 1 : 1
  const nextLongest = Math.max(existing?.longestCount ?? 0, nextCurrent)

  // The conflict branch recomputes the transition IN SQL from the row's LIVE values — never the
  // `existing` read above, which can be stale under a same-instant race: already-today keeps the
  // count, yesterday increments, older/null resets. Two concurrent check-ins therefore advance
  // the count exactly once regardless of interleaving. The JS-computed values only seed the
  // no-conflict INSERT path (first-ever activity), where there is no row to race against.
  const sqlNextCurrent = sql`CASE
    WHEN ${schema.streak.lastActivityDate} >= ${today} THEN ${schema.streak.currentCount}
    WHEN ${schema.streak.lastActivityDate} = ${yesterday} THEN ${schema.streak.currentCount} + 1
    ELSE 1
  END`
  const [row] = await db
    .insert(schema.streak)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      kind,
      currentCount: nextCurrent,
      longestCount: nextLongest,
      lastActivityDate: today,
    })
    .onConflictDoUpdate({
      target: [schema.streak.organizationId, schema.streak.userId, schema.streak.kind],
      set: {
        currentCount: sqlNextCurrent,
        longestCount: sql`GREATEST(${schema.streak.longestCount}, ${sqlNextCurrent})`,
        // GREATEST keeps a future-dated row (westward timezone change) instead of pulling it back.
        lastActivityDate: sql`GREATEST(${schema.streak.lastActivityDate}, ${today})`,
        updatedAt: new Date(), // $onUpdate only fires on .update(), not upserts — set explicitly
      },
    })
    .returning()
  if (!row) throw new Error('streak upsert returned no row')

  return { streak: toEffective(row, today), grew: true }
}

/**
 * The effective streak for display — never null: no row reads as the zero state, and a row whose
 * lastActivityDate is before yesterday reads as currentCount 0 (the table doc's no-cron design).
 */
export async function readStreak(db: DB, scope: StreakScope): Promise<EffectiveStreak> {
  const kind = scope.kind ?? 'daily'
  const today = localDate(scope.timezone ?? 'UTC')

  const [row] = await db
    .select()
    .from(schema.streak)
    .where(
      and(
        eq(schema.streak.organizationId, scope.organizationId),
        eq(schema.streak.userId, scope.userId),
        eq(schema.streak.kind, kind),
      ),
    )
    .limit(1)
  if (!row) {
    return { kind, currentCount: 0, longestCount: 0, lastActivityDate: null, checkedInToday: false }
  }
  return toEffective(row, today)
}
