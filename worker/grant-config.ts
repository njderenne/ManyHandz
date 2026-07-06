import { and, asc, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import { schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { grantHasScope, type Grant } from './lib/access-grant'

/**
 * Grant config — the APP-OWNED extension registry for the share-grant layer (SUBJECT_SPEC §6.4),
 * the same ownership model as worker/env.ts: the chassis ships a working default, a minted app
 * REPLACES the vocabulary and registries with its own. The public surface
 * (worker/routes/grant-public.ts) is generic; everything app-shaped lives here.
 *
 *   GRANT_SCOPES        the scope vocabulary grants can be minted with ('view:subjects',
 *                       'log:feeding', …). The mint route validates against this list.
 *   grantViewComposer   builds the 'view' object an ACTIVE grant's public page renders —
 *                       ALLOWLISTED fields only (privacy law below).
 *   grantActions        action verb → { scope, input, handler }: what a grantee can DO. The
 *                       public /act route re-checks the scope server-side per call and validates
 *                       `details` with the action's OWN `.strip()`-ing, per-field-capped zod
 *                       schema (untrusted account-less input landing in the owner's audit trail).
 *
 * ── PRIVACY LAW (SUBJECT_SPEC §7 rule 3, chassis-enforced by test) ────────────────────────────
 * Public payloads are explicit allowlists. The composer NEVER returns `notes`, `profile`,
 * `selfUserId`, member/user ids, org internals, or any media URL. Adding a field to the public
 * surface is a code-reviewable diff here — never a `SELECT *`.
 *
 * ── NO avatarUrl / media URLs (M-3) ───────────────────────────────────────────────────────────
 * Every media URL in the template is session+org-gated (worker/routes/media.ts mounts requireOrg
 * — correctly, per its stored-XSS header comment), so an account-less grantee's avatar fetch
 * would 401, and "fixing" that by opening media reads would be a tenant-isolation regression.
 * The public grant page renders initials avatars client-side (the Avatar primitive supports it).
 * FUTURE (designed follow-up — do NOT improvise it): exposing media to grantees requires a
 * grant-scoped signed endpoint, `GET /api/grant/:code/media/:id`, that re-validates the grant AND
 * allowlists the specific media id (e.g. the pinned subject's `avatarMediaId`).
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */

/** Scope vocabulary this app mints grants with. Template default: the curated subject roster.
 *  Apps replace/extend, e.g. ['view:subjects', 'view:schedules', 'log:feeding', 'log:walk']. */
export const GRANT_SCOPES: readonly string[] = ['view:subjects']

/** Builds the public 'view' object for an active grant — ALLOWLISTED fields only. */
export type GrantViewComposer = (db: DB, grant: Grant) => Promise<Record<string, unknown>>

/** Executes one grantee action. `subjectId` arrives pre-verified (grant's org + pin); `details`
 *  arrives already validated by the action's own zod schema. */
export type GrantActionHandler = (
  db: DB,
  grant: Grant,
  input: { subjectId: string | null; details: Record<string, unknown> },
) => Promise<
  | { ok: true; entityType?: string; entityId?: string }
  | { ok: false; error: string; status: 400 | 403 | 404 }
>

/**
 * Template default composer — works out of the box and demonstrates the privacy rule: with the
 * 'view:subjects' scope, return ACTIVE subjects (a pinned grant ⇒ just that one) as
 * `{ id, kind, displayName, birthDate }`. The pet-pilot "curated fields, never the owner's
 * vet/insurance/microchip" rule and RxMndr's "hand-picked DTO — never ids, userIds, org ids"
 * rule, promoted to chassis law.
 */
export const grantViewComposer: GrantViewComposer = async (db, grant) => {
  if (!APP_CONFIG.features.subjects || !grantHasScope(grant, 'view:subjects')) {
    return {}
  }
  const filters = [
    eq(schema.subject.organizationId, grant.organizationId),
    isNull(schema.subject.archivedAt),
  ]
  // Subject-pinned grant (visiting nurse for Mom): the view is that one subject, nobody else.
  if (grant.subjectId) filters.push(eq(schema.subject.id, grant.subjectId))
  const subjects = await db
    .select({
      id: schema.subject.id,
      kind: schema.subject.kind,
      displayName: schema.subject.displayName,
      birthDate: schema.subject.birthDate,
    })
    .from(schema.subject)
    .where(and(...filters))
    .orderBy(asc(schema.subject.displayName), asc(schema.subject.id))
  return { subjects }
}

/**
 * Grantee actions — verb → { scope, input, handler }. Template default: NONE (the chassis has no
 * domain rows for an outsider to write). A minted app registers its care/log verbs here, e.g.:
 *
 *   feeding: {
 *     scope: 'log:feeding',
 *     input: z.object({ amount: z.string().max(120), notes: z.string().max(2000).optional() }).strip(),
 *     handler: async (db, grant, { subjectId, details }) => {
 *       const [row] = await db.insert(schema.feedLog).values({
 *         organizationId: grant.organizationId, subjectId, grantId: grant.id, ...details,
 *       }).returning({ id: schema.feedLog.id })
 *       return { ok: true, entityType: 'feed_log', entityId: row.id }
 *     },
 *   },
 *
 * Each `input` MUST be a `.strip()`-ing zod object with per-field caps — `details` is
 * grantee-supplied on an ACCOUNT-LESS surface and lands verbatim in the household's audit trail,
 * so a code holder must never be able to store an arbitrary/unbounded blob (pet-pilot
 * sitter-public.ts rationale; defense-in-depth atop the /api/grant/* rate limiter).
 */
export const grantActions: Record<
  string,
  { scope: string; input: z.ZodTypeAny; handler: GrantActionHandler }
> = {}
