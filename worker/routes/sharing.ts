import { Hono } from 'hono'
import { getDb } from '@/lib/db'
import { requireOrg, audit, requireSession, type AuthEnv } from '../middleware/org'
import { mintShareToken, resolveLiveToken, revokeShareToken, shareUrl } from '../lib/share-token'
import type { Env } from '../env'

/**
 * Sharing — public share links. Two surfaces, two mount prefixes:
 *
 *   publicShareRoutes → /api/share          NO AUTH. A shared link must resolve for someone with no
 *                       account, so this never touches requireSession/requireOrg and never leaks
 *                       userId/organizationId. The TOKEN is the capability.
 *   shareRoutes       → /api/organizations  requireOrg. Mint / revoke tokens, org-scoped to the
 *                       caller's active org (same shape as notifications.ts).
 *
 * This is the GENERIC capability layer (worker/lib/share-token.ts). The public resolve returns only
 * the entity REFERENCE (entityType, entityId, displayName); a minted app adds richer per-type
 * content resolvers on top — e.g. GET /api/shared/order/:token that resolveLiveToken-validates then
 * loads + snapshots the order. See builder/MINT.md.
 */

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PUBLIC (NO AUTH) — mounts at /api/share. NEVER add requireSession/requireOrg here.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const publicShareRoutes = new Hono<{ Bindings: Env }>()

/**
 * GET /api/share/:token — resolve a live share link to its minimal reference + bump viewCount.
 * 404 for a missing / revoked / expired token (don't distinguish — no oracle). A minted app's
 * per-type resolver returns richer content; this generic one returns the reference the client routes
 * on (entityType → which screen).
 */
publicShareRoutes.get('/:token', async (c) => {
  const token = c.req.param('token')
  const db = getDb(c.env.DATABASE_URL)
  const share = await resolveLiveToken(db, token)
  if (!share) return c.json({ error: 'not found' }, 404)
  return c.json({
    entityType: share.entityType,
    entityId: share.entityId,
    displayName: share.displayName,
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AUTHED (org-scoped) — mounts at /api/organizations.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const shareRoutes = new Hono<AuthEnv>()

/**
 * POST /:orgId/share { entityType, entityId?, displayName?, expiresInDays? } — mint a share token.
 *
 * OWNERSHIP: this generic route does NOT (cannot) verify the caller owns entityId — the chassis
 * doesn't know the app's entities. For anything sensitive, call mintShareToken() from a DOMAIN route
 * that first confirms ownership (the proven pattern). Use this open route only for entities whose
 * mere reference is safe to expose, or gate it per app. The token is stamped with the caller's org +
 * user and audited, so every mint is attributable.
 */
shareRoutes.post('/:orgId/share', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')
  const body = await c.req.json<{
    entityType?: string
    entityId?: string
    displayName?: string
    expiresInDays?: number
  }>().catch(() => null)
  if (!body || typeof body.entityType !== 'string' || !body.entityType.trim()) {
    return c.json({ error: 'entityType is required' }, 400)
  }

  const token = await mintShareToken(getDb(c.env.DATABASE_URL), {
    organizationId: orgId,
    userId: session.user.id,
    entityType: body.entityType.trim(),
    entityId: typeof body.entityId === 'string' ? body.entityId : null,
    displayName: typeof body.displayName === 'string' ? body.displayName : null,
    expiresInDays: typeof body.expiresInDays === 'number' ? body.expiresInDays : null,
  })
  await audit(c, { entityType: body.entityType.trim(), entityId: body.entityId ?? token, action: 'share.mint' })

  return c.json({ token, url: shareUrl(c.req.url, token) })
})

/** DELETE /:orgId/share/:token — revoke a token the caller's org owns (idempotent). */
shareRoutes.delete('/:orgId/share/:token', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const token = c.req.param('token')
  const revoked = await revokeShareToken(getDb(c.env.DATABASE_URL), { token, organizationId: orgId })
  if (!revoked) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'share_token', entityId: token, action: 'share.revoke' })
  return c.json({ ok: true })
})
