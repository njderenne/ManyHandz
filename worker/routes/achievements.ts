import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'

/**
 * Achievements — read side of the engagement loop. Same shape as notifications.ts (the canonical
 * org-scoped resource route): `requireOrg` gates the endpoint and every query scopes by BOTH
 * organizationId and the session user.
 *
 * Only unlocks are served — the catalog (titles, icons, tiers) lives client-side in
 * src/lib/achievements.ts, and the WRITE path is server-internal (worker/achievements.ts
 * unlockAchievement(), called by product routes when milestones happen). There is deliberately
 * no client-callable unlock endpoint: clients could otherwise grant themselves achievements.
 *
 * No pagination: the unlock count per (org, user) is bounded by the size of the code-defined
 * catalog (a handful to a few dozen rows), never by user data volume.
 *
 *   GET /api/organizations/:orgId/achievements → caller's unlocks, newest first
 */
export const achievementRoutes = new Hono<AuthEnv>()

achievementRoutes.get('/:orgId/achievements', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.achievementUnlock)
    .where(
      and(
        eq(schema.achievementUnlock.organizationId, orgId),
        eq(schema.achievementUnlock.userId, session.user.id),
      ),
    )
    .orderBy(desc(schema.achievementUnlock.createdAt))
  return c.json(rows)
})
