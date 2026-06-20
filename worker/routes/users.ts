import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireSession, type AuthEnv } from '../middleware/org'

/**
 * Public user profiles — the USER-scoped "who is this?" read for anywhere a member's name shows
 * up (chat, messages, events, comments). Session-gated like settings.ts — there is NO :orgId
 * because identity crosses org boundaries the same way blocks do (see schema.ts user_block);
 * `requireSession` is the gate and the response shape is the authorization.
 *
 * PRIVACY CONTRACT — the response is an explicit allow-list; never `select()` the whole user row:
 *
 *   id          — needed to key client caches and target moderation actions
 *   name, image — what members already see attached to this user's content
 *   memberSince — createdAt truncated to month ('YYYY-MM'): month/year is harmless social proof,
 *                 while a full signup timestamp is a correlation/fingerprinting vector
 *   blocked     — whether the CALLER has blocked this user (the caller's own state, so it leaks
 *                 nothing about the target)
 *
 * Explicitly NOT returned: email, emailVerified, updatedAt, or anything else on the user row.
 * Minted apps extend this only with fields EVERY signed-in member should see (e.g. a bio column).
 *
 *   GET /api/users/:userId/public → { id, name, image, memberSince, blocked } | 404
 *
 * Pairs with the client hook (src/lib/query/hooks/usePublicProfile.ts) and the worked-example
 * screen (app/users/[id].tsx), which is also where the moderation UI (report/block) mounts.
 */
export const usersRoutes = new Hono<AuthEnv>()

usersRoutes.get('/:userId/public', requireSession, async (c) => {
  const session = c.get('session')
  const userId = c.req.param('userId')
  // Length cap mirrors moderation.ts — ids are short TEXT keys; oversized params are junk.
  if (!userId || userId.length > 255) return c.json({ error: 'invalid userId' }, 400)

  const db = getDb(c.env.DATABASE_URL)
  // Allow-listed columns only — the SELECT enforces the privacy contract, not a later pick().
  const [target] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      // Converted to month-granularity memberSince (UTC) below — the full timestamp never leaves
      // this handler.
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
  if (!target) return c.json({ error: 'user not found' }, 404)

  // Blocks are user-level (no organizationId column — see moderation.ts header), so ONE existence
  // check answers "has the caller blocked this user in any shared org": any row by caller → target.
  // A block is GLOBAL and follows the user across orgs by design; a minted app that needs per-org
  // blocking must add organizationId to user_block and scope this check (and moderation.ts) by it.
  const [blockRow] = await db
    .select({ blockedUserId: schema.userBlock.blockedUserId })
    .from(schema.userBlock)
    .where(
      and(
        eq(schema.userBlock.blockerUserId, session.user.id),
        eq(schema.userBlock.blockedUserId, userId),
      ),
    )
    .limit(1)

  // Month granularity by design — see the privacy contract above. UTC so every Worker region
  // serves the same label for the same row.
  const created = new Date(target.createdAt)
  const memberSince = `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, '0')}`

  return c.json({
    id: target.id,
    name: target.name,
    image: target.image,
    memberSince,
    blocked: blockRow !== undefined,
  })
})
