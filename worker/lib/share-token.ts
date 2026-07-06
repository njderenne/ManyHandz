import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'

/**
 * Share-token engine — the GENERIC capability layer behind public share links. A share_token row is
 * an unguessable, revocable, optionally-expiring pointer to one entity (entityType + entityId); the
 * TOKEN itself is the capability, so a resolve needs no session. This module is domain-agnostic: it
 * mints / resolves / revokes tokens and bumps view counts. A minted app composes these primitives
 * into its own public content resolvers (e.g. GET /api/shared/:type/:token that loads + snapshots
 * the entity AFTER resolveLiveToken validates the token), and into domain mint routes that verify
 * ownership of entityId BEFORE calling mintShareToken.
 *
 * Security contract:
 *   - Resolve returns the MINIMAL reference (entityType, entityId, displayName) — never the owning
 *     userId / organizationId. The app's content resolver pins its load to the share's own
 *     entityId, so a token only ever resolves the exact row it was minted for.
 *   - A missing / revoked / expired token is indistinguishable (no oracle) — callers 404 all three.
 *   - mintShareToken stamps org + user from the verified session, never the client body.
 */

/** A share_token is live when not revoked and either never expires or has not yet expired. */
export function liveTokenWhere(token: string, entityType?: string) {
  return and(
    eq(schema.shareToken.token, token),
    entityType ? eq(schema.shareToken.entityType, entityType) : undefined,
    isNull(schema.shareToken.revokedAt),
    or(isNull(schema.shareToken.expiresAt), gt(schema.shareToken.expiresAt, new Date())),
  )
}

/** The minimal, leak-free reference a public resolve returns. */
export type ResolvedShare = {
  token: string
  entityType: string
  entityId: string | null
  displayName: string | null
}

/**
 * Resolve a live token to its reference and bump viewCount. Returns null for a missing / revoked /
 * expired token (callers 404 without distinguishing — no oracle). Pass entityType to additionally
 * pin the resolve to a specific kind (e.g. a per-type content resolver).
 */
export async function resolveLiveToken(
  db: DB,
  token: string,
  entityType?: string,
): Promise<ResolvedShare | null> {
  const [share] = await db
    .select({
      token: schema.shareToken.token,
      entityType: schema.shareToken.entityType,
      entityId: schema.shareToken.entityId,
      displayName: schema.shareToken.displayName,
    })
    .from(schema.shareToken)
    .where(liveTokenWhere(token, entityType))
    .limit(1)
  if (!share) return null

  // Fire-and-forget the view bump — a counter must never fail the read (or leak timing).
  await db
    .update(schema.shareToken)
    .set({ viewCount: sql`${schema.shareToken.viewCount} + 1` })
    .where(eq(schema.shareToken.token, token))

  return share
}

export type MintShareInput = {
  organizationId: string | null
  userId: string
  entityType: string
  /** null for feed-type tokens (a whole-collection link rather than one row). */
  entityId?: string | null
  displayName?: string | null
  /** null/absent = never expires. */
  expiresInDays?: number | null
}

/**
 * Mint a share token. Stamp org + user from the VERIFIED session at the call site — domain routes
 * call this AFTER confirming the caller owns entityId. Returns the token (the public URL is built by
 * the route via shareUrl, which derives the host from the request).
 */
export async function mintShareToken(db: DB, input: MintShareInput): Promise<string> {
  const expiresAt =
    typeof input.expiresInDays === 'number' && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null
  const token = `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}` // long, unguessable
  await db.insert(schema.shareToken).values({
    token,
    organizationId: input.organizationId,
    userId: input.userId,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    displayName: input.displayName ?? null,
    expiresAt,
  })
  return token
}

/** Revoke a token the caller owns (org-scoped). Idempotent; returns whether a row was revoked. */
export async function revokeShareToken(
  db: DB,
  input: { token: string; organizationId: string },
): Promise<boolean> {
  const revoked = await db
    .update(schema.shareToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.shareToken.token, input.token),
        eq(schema.shareToken.organizationId, input.organizationId),
        isNull(schema.shareToken.revokedAt),
      ),
    )
    .returning({ token: schema.shareToken.token })
  return revoked.length > 0
}

/** Build the public link a client renders (host comes from the request, never hard-coded). */
export function shareUrl(reqUrl: string, token: string): string {
  const host = new URL(reqUrl).host
  return `https://${host}/share/${token}`
}
