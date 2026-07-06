import { and, eq, isNull } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'
import { can } from '@/lib/config/roles'

/**
 * Oversight authorization — the SINGLE server-side gate for a requester reading ANOTHER member's
 * data (SPINE_SPEC §8; grindline donor, generalized to the capability matrix). Every cross-user
 * read in roster/report/summary routes MUST flow through `assertCanOverseeMember`; never trust a
 * `:userId` from the URL/body without it. This is what fences a coach in one team off from another
 * team's athletes, and a household admin off from another family's kids.
 *
 * Opt-in by import: nothing references this module until a route does, so a mint that never reads
 * cross-member data pays zero cost (`features.oversight` gates the reference route's mount).
 *
 * A requester may read member `targetUserId`'s data ONLY when ALL hold:
 *   1. The requester is in the active org — guaranteed by `requireOrg` running first (it sets
 *      orgId/orgKind/orgRole and 403s a non-member). The route passes those through.
 *   2. The requester's (kind, role) grants `member:oversee` in the KIND_CONFIGS matrix — the PURE
 *      `roleCanOversee` below, checked BEFORE any query so most attackers are denied for free.
 *   3. The target is ALSO an ACTIVE (non-archived) member of the SAME org — a `member` row for
 *      (orgId, targetUserId) with archived_at IS NULL. Queried here; false if absent.
 *
 * Reading your OWN userId is ALWAYS allowed (self) — short-circuited before the role check, so a
 * member can always read their own detail through the same endpoint.
 *
 * DATA-CLASS ESCALATION: `member:oversee` is only the OUTER door. Stricter data classes (raw
 * health, private messages) get their OWN app-declared capabilities (`health:view_raw`-style,
 * appended to the app's Capability union + matrices) layered on top — grindline keeps coach reads
 * at aggregates-only exactly this way. Pair with COLUMN-SELECTION privacy: an oversight read never
 * `select()`s the full row (see worker/routes/oversight.ts, the reference reader).
 */

/** The decision result — `false` denies; the route maps a denial to 403. */
export type OversightDecision = boolean

/**
 * PURE role gate (condition 2) — no DB, no I/O, fully unit-testable. Is (kind, role) allowed to
 * read ANOTHER member's data at all? One line on purpose: the capability matrix
 * (src/lib/config/roles.ts KIND_CONFIGS) is the single authority — apps tune WHO oversees by
 * granting/revoking `member:oversee` per (kind, role), never by editing this function.
 * Unknown kind/role/malformed input ⇒ false (deny by default, `can`'s contract).
 */
export function roleCanOversee(kind: string, role: string): boolean {
  return can(kind, role, 'member:oversee')
}

/** Inputs the DB-backed gate needs — all resolved by `requireOrg` + the route param. */
export type OversightContext = {
  db: DB
  /** Verified active org (from requireOrg → c.get('orgId')) — NEVER a client-sent id. */
  orgId: string
  /** Active org kind (from requireOrg → c.get('orgKind')). */
  orgKind: string
  /** Requester's role in the active org (from requireOrg → c.get('orgRole')). */
  requesterRole: string
  /** The signed-in requester's user id (from the session). */
  requesterUserId: string
  /** The member being read (the `:userId` route param). */
  targetUserId: string
}

/**
 * Assert the requester may oversee `targetUserId` in the active org. Resolves `true` when access
 * is allowed, `false` when denied — routes map `false` to a bare 403 (never reveal WHICH condition
 * failed; "forbidden" is the only thing the client should learn).
 *
 * Order matters and is SECURITY-CRITICAL (grindline's proven sequence):
 *   - self short-circuits first (always allowed — own data needs no oversight role),
 *   - then the PURE role gate — an attacker with the wrong role is denied with ZERO queries,
 *   - then the target-membership read — the cross-org / archived-member fence.
 * Condition 1 is the caller's responsibility: pass the requireOrg-verified orgId/orgKind/orgRole.
 */
export async function assertCanOverseeMember(ctx: OversightContext): Promise<OversightDecision> {
  // Self is always allowed — a member reading their OWN detail needs no oversight role.
  if (ctx.targetUserId === ctx.requesterUserId) return true

  // Condition 2 (pure): the requester's (kind, role) must grant member:oversee. Checked before
  // the query so a non-oversight role is denied without a round-trip.
  if (!roleCanOversee(ctx.orgKind, ctx.requesterRole)) return false

  // Condition 3: the target must be an ACTIVE (non-archived) member of the SAME active org. This
  // is the fence that stops an admin/coach from reading a user who isn't on their roster — and an
  // ARCHIVED member is off the roster (kept history, lost access — schema.ts member.archivedAt).
  const [targetMember] = await ctx.db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, ctx.orgId),
        eq(schema.member.userId, ctx.targetUserId),
        isNull(schema.member.archivedAt),
      ),
    )
    .limit(1)
  if (!targetMember) return false

  return true
}

/**
 * The Person ≠ Member seam (SPINE_SPEC §9): the same-org fence for SUBJECT targets. True iff the
 * subject exists, belongs to this org, and is NOT archived — the check every route that accepts a
 * `subjectId` in a param/body runs before touching the subject's data (SUBJECT_SPEC §3 rule 4;
 * A4's grant composers and app domain routes compose it the same way). A leaked subjectId alone
 * can never cross a tenant boundary. NOTE: when the resolved subject is SELF-LINKED to another
 * user and the read joins that user's USER-scoped data, routes must ALSO pass
 * `assertCanOverseeMember` — see the seam rule + worked example in worker/routes/subjects.ts.
 */
export async function assertSubjectInOrg(db: DB, orgId: string, personId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.subject.id })
    .from(schema.subject)
    .where(
      and(
        eq(schema.subject.organizationId, orgId),
        eq(schema.subject.id, personId),
        isNull(schema.subject.archivedAt),
      ),
    )
    .limit(1)
  return Boolean(row)
}
