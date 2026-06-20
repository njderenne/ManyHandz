import { Hono } from 'hono'
import { getDb } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'
import { unlockAchievement } from '../achievements'
import { readStreak, recordActivity, resolveTimezone } from '../streaks'

/**
 * Streaks — org-scoped routes over the `streak` table, same shape as notifications.ts (the
 * canonical org-scoped resource route): `requireOrg` gates every endpoint and every query scopes
 * by organizationId + the SESSION user (a member only ever sees/advances their own streaks).
 * The helpers live in worker/streaks.ts; day boundaries use the caller's stored timezone
 * (user_settings.timezone, fallback 'UTC'), resolved HERE so the helpers never guess.
 *
 *   GET  /api/organizations/:orgId/streaks/:kind           → effective streak (broken reads as 0)
 *   POST /api/organizations/:orgId/streaks/:kind/check-in  → record today's activity
 *                                                            → { streak, grew }
 *
 * The check-in endpoint is for apps where acting in the client IS the activity (daily check-in
 * buttons, "I did it today"). Product routes can ALSO call recordActivity() directly server-side
 * after a domain action (workout completed, lesson finished) — see worker/streaks.ts for the
 * try/catch pattern that keeps a streak hiccup from failing the action.
 *
 * Pairs with the client hook (src/lib/query/hooks/useStreak.ts) and the org-scoped query key
 * (queryKeys.organizations.streak in src/lib/query/keys.ts).
 */
export const streakRoutes = new Hono<AuthEnv>()

/**
 * `kind` is a URL param that lands in a TEXT column — validate like any client input. Per-app
 * vocab tokens ('daily', 'workout', 'practice', …): short slugs, never free text.
 */
const KIND_MAX_LENGTH = 64
const KIND_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

function parseKind(raw: string | undefined): string | null {
  const kind = raw?.trim()
  if (!kind || kind.length > KIND_MAX_LENGTH || !KIND_PATTERN.test(kind)) return null
  return kind
}

streakRoutes.get('/:orgId/streaks/:kind', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const kind = parseKind(c.req.param('kind'))
  if (!kind) return c.json({ error: 'invalid streak kind' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  const timezone = await resolveTimezone(db, session.user.id)
  const streak = await readStreak(db, {
    organizationId: orgId,
    userId: session.user.id,
    kind,
    timezone,
  })
  return c.json(streak)
})

streakRoutes.post('/:orgId/streaks/:kind/check-in', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const kind = parseKind(c.req.param('kind'))
  if (!kind) return c.json({ error: 'invalid streak kind' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  const timezone = await resolveTimezone(db, session.user.id)
  // Scope comes from verified context (active org + session user), never the client body.
  const result = await recordActivity(db, {
    organizationId: orgId,
    userId: session.user.id,
    kind,
    timezone,
  })

  // Milestone achievements — wired HERE (not in recordActivity) because unlocking needs env for
  // notify(). THRESHOLDS (>=), not exact counts: unlockAchievement never throws, so an unlock
  // that fails transiently at exactly day 7/30 would otherwise be missed forever — with >=,
  // every later growing check-in retries until the row lands, and the unique (org, user, key)
  // index inside unlockAchievement makes the repeats free no-ops. Product routes that call
  // recordActivity() directly server-side should mirror this.
  if (result.grew) {
    const count = result.streak.currentCount
    if (count >= 7) {
      await unlockAchievement(db, c.env, {
        organizationId: orgId,
        userId: session.user.id,
        achievementKey: 'streak-7',
        metadata: { count },
      })
    }
    if (count >= 30) {
      await unlockAchievement(db, c.env, {
        organizationId: orgId,
        userId: session.user.id,
        achievementKey: 'streak-30',
        metadata: { count },
      })
    }
  }
  return c.json(result)
})
