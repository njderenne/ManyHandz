import { schema, type DB } from '@/lib/db'
import type { Env } from './env'
import { notify } from './notify'

/**
 * unlockAchievement() — THE server-side way to record an achievement unlock. Product routes call
 * it after the milestone happens (signup, org join, streak threshold, first referral,
 * subscription); nothing else writes `achievement_unlock` rows.
 *
 * The catalog (titles, descriptions, icons, tiers) lives CLIENT-SIDE in src/lib/achievements.ts —
 * the worker treats achievement keys as opaque strings on purpose: definitions are presentation;
 * the worker only records facts. That split means copy/icon/tier changes ship with the app build
 * and never require a Worker deploy or data migration (MINT §5 doctrine: definitions live in
 * code, only unlocks are data).
 *
 * Contract (same as notify() / audit() — an engagement side effect must never fail the action
 * that triggered it):
 *
 *   - IDEMPOTENT: the insert is `onConflictDoNothing` on the unique (org, user, key) index, so
 *     calling it on every occurrence of a repeatable event is safe — only the FIRST call inserts.
 *   - On that first unlock (the insert returned a row) it fires a congrats notification via
 *     notify() with entityType 'achievement', deep-linking into the achievements screen. The
 *     title is generic by design: the worker doesn't know the achievement's display name (see
 *     the opaque-keys note above), and the screen the tap lands on shows the freshly-lit card.
 *   - NEVER throws into callers. Failures are structured-logged instead.
 *
 * @example
 * // In a route, after the state change succeeds (ids from verified context, never the client):
 * const db = getDb(c.env.DATABASE_URL)
 * await unlockAchievement(db, c.env, {
 *   organizationId: orgId,
 *   userId: session.user.id,
 *   achievementKey: 'streak-7',
 *   metadata: { count: 7 }, // optional: the value that triggered it
 * })
 */

export type UnlockAchievementInput = {
  /** Org the unlock belongs to — pass the verified active org, never a client-sent id. */
  organizationId: string
  /** User who earned it — from the session (or verified server context), never the body. */
  userId: string
  /** Opaque achievement key — matches a src/lib/achievements.ts catalog entry on the client. */
  achievementKey: string
  /** Optional context to store with the fact, e.g. the value that crossed the threshold. */
  metadata?: Record<string, unknown>
}

/** Plain-object check — jsonb values must be objects, never arrays or primitives. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function unlockAchievement(
  db: DB,
  env: Env,
  input: UnlockAchievementInput,
): Promise<void> {
  try {
    // Defensive validation — callers are server code, but keys can originate from webhook/cron
    // paths; a malformed key is a caller bug we log loudly instead of throwing into the action.
    const key = input.achievementKey?.trim()
    if (!key || key.length > 255 || !input.organizationId || !input.userId) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'achievements.invalid_input',
          achievementKey: input.achievementKey ?? null,
          organizationId: input.organizationId ?? null,
          userId: input.userId ?? null,
        }),
      )
      return
    }

    // Idempotent insert: the unique (org, user, key) index absorbs repeats — only the first call
    // returns a row, so `inserted` doubles as the "is this the FIRST unlock?" signal.
    const [inserted] = await db
      .insert(schema.achievementUnlock)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        achievementKey: key,
        metadata: isPlainObject(input.metadata) ? input.metadata : null,
      })
      .onConflictDoNothing({
        target: [
          schema.achievementUnlock.organizationId,
          schema.achievementUnlock.userId,
          schema.achievementUnlock.achievementKey,
        ],
      })
      .returning()
    if (!inserted) return // already unlocked — repeat call, nothing to celebrate

    // Structured log carries the SPECIFIC key (the notification deliberately doesn't — see below),
    // so ops can trace which unlock fired without joining on entityId.
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'achievements.unlocked',
        achievementKey: key,
        organizationId: input.organizationId,
        userId: input.userId,
      }),
    )

    // First unlock → congrats. notify() is itself best-effort and never throws; the tap deep-links
    // via entityType 'achievement' (client routing in src/lib/native/notification-router.ts).
    // `kind` stays the STABLE 'achievement.unlocked' token and the title stays generic on purpose
    // (the opaque-keys doctrine above: the worker doesn't know display names, and clients key
    // copy/routing off stable kinds) — the info log above is where the specific key lives.
    await notify(db, env, {
      organizationId: input.organizationId,
      userId: input.userId,
      kind: 'achievement.unlocked',
      title: 'Achievement unlocked!',
      body: 'You just earned a new achievement. Tap to see it.',
      entityType: 'achievement',
      entityId: inserted.id,
    })
  } catch (e) {
    // Same contract as notify(): an engagement side effect never fails the triggering action.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'achievements.unlock_failed',
        achievementKey: input.achievementKey,
        organizationId: input.organizationId,
        userId: input.userId,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
  }
}
