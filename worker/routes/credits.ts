import { Hono } from 'hono'
import { and, desc, eq, lt } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'
import { getBalance } from '../credits'

/**
 * Credits — READ-ONLY client surface over the `credit_ledger` table. Same shape as
 * notifications.ts (the canonical org-scoped resource route): `requireOrg` gates every endpoint,
 * and every query scopes by organizationId AND the session user.
 *
 * Deliberately no POST: clients never mint or burn their own points. All writes go through the
 * server-side engine (worker/credits.ts — awardCredits/spendCredits), called by product routes,
 * webhooks, and cron after a state change they verified themselves.
 *
 *   GET /api/organizations/:orgId/credits/balance?kind=  → { balance }
 *   GET /api/organizations/:orgId/credits/history?cursor= → caller's ledger rows, newest first
 */
export const creditRoutes = new Hono<AuthEnv>()

/** TEXT column — cap client-sent filters defensively (matches worker/credits.ts MAX_KIND). */
const MAX_KIND = 100
/**
 * Slug-shaped kinds only ('referral_credit', 'reward_points', 'promo', per-app vocab) — eq() is
 * injection-safe today, but a charset whitelist keeps the param safe against future refactors
 * that might interpolate it.
 */
const KIND_PATTERN = /^[a-z0-9_-]+$/i

creditRoutes.get('/:orgId/credits/balance', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  // Optional ?kind= narrows the sum to one ledger namespace; absent = all kinds combined.
  const kindParam = c.req.query('kind')
  let kind: string | undefined
  if (kindParam !== undefined) {
    const trimmed = kindParam.trim()
    if (!trimmed || trimmed.length > MAX_KIND || !KIND_PATTERN.test(trimmed)) {
      return c.json(
        { error: `kind must be 1-${MAX_KIND} characters of letters, digits, '_' or '-'` },
        400,
      )
    }
    kind = trimmed
  }

  const balance = await getBalance(getDb(c.env.DATABASE_URL), orgId, session.user.id, kind)
  return c.json({ balance })
})

creditRoutes.get('/:orgId/credits/history', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  // Cursor pagination: ?cursor=<ISO createdAt of the last row seen> → rows strictly older.
  // Boundary caveat (same as notifications.ts): lt() skips rows sharing the cursor's EXACT
  // timestamp on the next page. Acceptable for per-event ledger rows; a composite (createdAt, id)
  // cursor is the upgrade path if a minted app bulk-awards credits in one statement.
  const cursor = c.req.query('cursor')
  const cursorDate = cursor ? new Date(cursor) : null
  const scope = and(
    eq(schema.creditLedger.organizationId, orgId),
    // User-scoped on top of org-scoped: a member only ever sees their OWN ledger. Org-wide rows
    // (userId null — see schema.ts) are an admin/reporting concern, not this feed's.
    eq(schema.creditLedger.userId, session.user.id),
  )
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.creditLedger)
    .where(
      cursorDate && !Number.isNaN(cursorDate.getTime())
        ? and(scope, lt(schema.creditLedger.createdAt, cursorDate))
        : scope,
    )
    // id desc as the tiebreaker — keeps the order stable when createdAt collides.
    .orderBy(desc(schema.creditLedger.createdAt), desc(schema.creditLedger.id))
    .limit(50)
  return c.json(rows)
})
