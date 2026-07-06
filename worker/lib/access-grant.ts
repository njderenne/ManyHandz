import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { onSubjectArchived } from './subjects'

/**
 * Access-grant lib — the share-grant capability layer (SUBJECT_SPEC §6): a NAMED, permission-
 * scoped, time-boxed, auditable credential for an account-less outsider (the sitter, the visiting
 * nurse, grandma this week). Generalizes pet-pilot Sitter Mode + RxMndr's public-link lifecycle.
 *
 * The CODE is the credential: short, human-typeable, CSPRNG-minted, and re-validated on EVERY
 * request (resolveGrant — never cached). `worker/lib/share-token.ts` is deliberately untouched:
 * share_token stays the anonymous read-only link; access_grant is the named, scoped, read-AND-act
 * grant with a mandatory time box and a bounded audit trail (decision matrix in SUBJECT_SPEC §6).
 *
 * Grants are bounded BY CONSTRUCTION — `expiresAt` is NOT NULL and mintGrant caps the window at
 * APP_CONFIG.grants.maxDurationDays — which is what makes the lapsed-org wind-down safe with no
 * cron: a lapsed org's worst-case residual exposure is one grant window, then the resolve
 * predicate kills it mechanically (§6.6).
 */

/** Unambiguous charset — no I/O/0/1. Length 32 divides 256 ⇒ `byte % 32` has ZERO modulo bias. */
export const GRANT_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const GRANT_CODE_LENGTH = 10 // 32^10 ≈ 1.1e15; with the /api/grant/* rate limit (60 req /
//                                     5 min) brute force needs ~10^11 years per code.

/** CSPRNG code via crypto.getRandomValues (Workers global). */
export function mintGrantCode(len: number = GRANT_CODE_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let out = ''
  for (let i = 0; i < len; i++) out += GRANT_CODE_CHARSET[bytes[i] % GRANT_CODE_CHARSET.length]
  return out
}

export type Grant = typeof schema.accessGrant.$inferSelect
export type GrantStatus = 'active' | 'invalid' | 'not_started' | 'expired'
export type GrantResult =
  | { status: 'invalid' }
  | { status: Exclude<GrantStatus, 'invalid'>; grant: Grant }

/**
 * Resolve + validate by code. The predicate is re-run on EVERY request — never cached:
 *   revokedAt IS NULL AND startsAt <= now < expiresAt
 * Missing and revoked are BOTH 'invalid' (no oracle — a code holder can't learn whether a code
 * ever existed). not_started/expired return the grant so the public page can tell the NAMED
 * grantee when their window is — grant metadata only, zero org data ever rides on those states.
 * On 'active', bumps useCount + lastUsedAt fire-and-forget (a bump failure never fails the read).
 */
export async function resolveGrant(db: DB, code: string): Promise<GrantResult> {
  const [grant] = await db
    .select()
    .from(schema.accessGrant)
    .where(eq(schema.accessGrant.code, code))
    .limit(1)
  if (!grant || grant.revokedAt !== null) return { status: 'invalid' }
  const now = Date.now()
  if (new Date(grant.startsAt).getTime() > now) return { status: 'not_started', grant }
  if (new Date(grant.expiresAt).getTime() <= now) return { status: 'expired', grant }
  try {
    await db
      .update(schema.accessGrant)
      .set({ useCount: sql`${schema.accessGrant.useCount} + 1`, lastUsedAt: new Date() })
      .where(eq(schema.accessGrant.id, grant.id))
  } catch {
    /* best-effort usage telemetry — never fail the read */
  }
  return { status: 'active', grant }
}

/** Case-normalized scope check ('log:feeding' ∈ grant.scopes). The server re-checks per action,
 *  always — the client's buttons are decoration, never the authorization. */
export function grantHasScope(grant: Grant, scope: string): boolean {
  const want = scope.trim().toLowerCase()
  return grant.scopes.some((s) => s.trim().toLowerCase() === want)
}

export const GRANT_ACTIVITY_MAX_ROWS = 500 // per grant

/**
 * Append to the per-grant audit trail, then opportunistically prune to the newest
 * GRANT_ACTIVITY_MAX_ROWS for this grant. The prune runs when `useCount % 25 === 0` — amortized,
 * no cron needed (pet-pilot mechanism). NEVER throws: audit failure must not fail the care action
 * (the same posture as the org-level audit() helper).
 */
export async function logGrantActivity(
  db: DB,
  grant: Grant,
  entry: {
    action: string
    subjectId?: string | null
    entityType?: string | null
    entityId?: string | null
    details?: Record<string, unknown> | null
  },
): Promise<void> {
  try {
    await db.insert(schema.accessGrantActivity).values({
      organizationId: grant.organizationId,
      grantId: grant.id,
      subjectId: entry.subjectId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      details: entry.details ?? null,
    })
    if (grant.useCount % 25 === 0) {
      // Amortized prune: keep the newest N rows, delete the tail. Two cheap indexed statements
      // every 25th use — bounded storage without a cron sweep.
      const stale = await db
        .select({ id: schema.accessGrantActivity.id })
        .from(schema.accessGrantActivity)
        .where(eq(schema.accessGrantActivity.grantId, grant.id))
        .orderBy(desc(schema.accessGrantActivity.createdAt))
        .offset(GRANT_ACTIVITY_MAX_ROWS)
      if (stale.length > 0) {
        await db.delete(schema.accessGrantActivity).where(
          inArray(
            schema.accessGrantActivity.id,
            stale.map((s) => s.id),
          ),
        )
      }
    }
  } catch (e) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'grant.activity_write_failed',
        grantId: grant.id,
        action: entry.action,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
  }
}

/** Postgres unique-violation (the access_grant.code UNIQUE index) — the re-mint trigger. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}

/**
 * Mint a grant with unique-code retry: insert, on unique-violation re-mint, ≤ 6 attempts
 * (pet-pilot loop; the code UNIQUE index is the source of truth — no read-then-write race).
 * `expiresAt − startsAt` must be > 0 and ≤ APP_CONFIG.grants.maxDurationDays — grants are bounded
 * BY CONSTRUCTION (the route pre-validates for a friendly 400; this re-check is the invariant).
 */
export async function mintGrant(
  db: DB,
  input: {
    organizationId: string
    subjectId?: string | null
    granteeName: string
    granteeEmail?: string | null
    scopes: string[]
    startsAt: Date
    expiresAt: Date
    createdByUserId: string
  },
): Promise<Grant> {
  const durationMs = input.expiresAt.getTime() - input.startsAt.getTime()
  if (durationMs <= 0) throw new Error('grant expiry must be after its start')
  const maxMs = APP_CONFIG.grants.maxDurationDays * 86_400_000
  if (durationMs > maxMs) {
    throw new Error(`grants are capped at ${APP_CONFIG.grants.maxDurationDays} days`)
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const [created] = await db
        .insert(schema.accessGrant)
        .values({
          organizationId: input.organizationId,
          subjectId: input.subjectId ?? null,
          granteeName: input.granteeName,
          granteeEmail: input.granteeEmail ?? null,
          code: mintGrantCode(),
          scopes: input.scopes,
          startsAt: input.startsAt,
          expiresAt: input.expiresAt,
          createdByUserId: input.createdByUserId,
        })
        .returning()
      return created
    } catch (e) {
      // Only a code collision earns a retry; 6 straight collisions on 32^10 codes means
      // something else is broken — surface it.
      if (!isUniqueViolation(e) || attempt >= 5) throw e
    }
  }
}

/**
 * onSubjectArchived hook (SUBJECT_SPEC §6.6): soft-revoke every LIVE grant pinned to the archived
 * subject. Whole-org grants survive — an archived subject simply drops out of composed views
 * because composers filter `archivedAt IS NULL`. Registered at module load (below); the registry
 * runner isolates + logs failures, so this never fails (or vetoes) the archive itself.
 */
export async function revokeGrantsForSubject(db: DB, orgId: string, subjectId: string): Promise<void> {
  await db
    .update(schema.accessGrant)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.accessGrant.organizationId, orgId),
        eq(schema.accessGrant.subjectId, subjectId),
        isNull(schema.accessGrant.revokedAt),
      ),
    )
}

// Registered at module load: importing this lib (grants routes do, via worker/index.ts's static
// imports) declares the cleanup; it only RUNS when an archive actually happens. Registration is
// unconditional on purpose — even with features.shareGrants off the revoke is a harmless no-op
// (no grant rows exist), and a later flag flip never leaves dangling subject-pinned grants.
onSubjectArchived.push(revokeGrantsForSubject)

/**
 * The `revokeOnLapse` lever (SUBJECT_SPEC §6.6 layer 3): bulk-soft-revoke every live grant for an
 * org. INERT BY DEFAULT — nothing in the chassis calls it this wave. When an app sets
 * `APP_CONFIG.grants.revokeOnLapse: true`, the billing-webhook downgrade path
 * (worker/routes/stripe.ts → resolveOrgEntitlement consumers) is the intended caller: on a
 * downgrade-to-FREE it revokes outstanding outsider access immediately instead of letting grants
 * run out their (already bounded) windows. Deliberately NOT wired by default: the sitter
 * mid-house-sit / nurse mid-shift must not be locked out of care logging because the owner's card
 * declined — for safety-class apps that grace IS the requirement.
 */
export async function revokeGrantsForLapsedOrg(db: DB, orgId: string): Promise<number> {
  const revoked = await db
    .update(schema.accessGrant)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(schema.accessGrant.organizationId, orgId), isNull(schema.accessGrant.revokedAt)),
    )
    .returning({ id: schema.accessGrant.id })
  return revoked.length
}
