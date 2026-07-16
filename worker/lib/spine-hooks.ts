import { and, eq, isNull } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { schema, type DB } from '@/lib/db'
import {
  DEFAULT_KIND,
  KIND_CONFIGS,
  PERSONAL_KIND,
  roleForJoin,
  type Kind,
} from '@/lib/config/roles'

/**
 * Spine auth hooks (SPINE_SPEC §3.4) — the two organization-plugin hook bodies wired into
 * worker/auth.ts at integration (STAGE0 §7.1):
 *
 *   beforeCreateOrganization → assertKindCreatable(db, org, user)
 *   afterCreateOrganization  → applyCreatorRole(db, org, member)
 *   afterAcceptInvitation    → mapInvitationRole(org.kind, invitation.role)   (§10.3 cutover)
 *
 * They live here (not inline in auth.ts) so the orchestrator-owned auth.ts carries one import
 * line per concern and the logic stays unit-testable. Both are grindline-production-proven
 * (grindline/worker/auth.ts:110-133), generalized from its hardcoded household rules to the
 * KIND_CONFIGS declaration.
 */

/**
 * Validate the requested org kind BEFORE Better-Auth creates the row, and enforce the kind's
 * per-user creation cap. `kind` is client-writable (additionalFields `input: true`) so it MUST
 * be server-checked here:
 *
 *  - absent (undefined/null)   → fine: the DB default (= DEFAULT_KIND, asserted by roles.test.ts)
 *                                applies. The maxPerUser cap of DEFAULT_KIND still counts.
 *  - PERSONAL_KIND             → rejected: reserved for worker/provision-user.ts, which inserts
 *                                via Drizzle and BYPASSES this hook (verified — that's the one
 *                                sanctioned personal-org path).
 *  - not declared in KINDS     → rejected (unknown vocabulary can never enter the DB, so the
 *                                capability matrix + normalizeKind never meet a hostile kind).
 *  - KIND_CONFIGS[kind].maxPerUser → count the user's LIVE memberships (archived_at IS NULL) in
 *                                orgs of this kind; at/over cap ⇒ reject (grindline household ≤ 1).
 *
 * `enabled: false` kinds are deliberately NOT rejected here — that flag only hides a kind from
 * create pickers (ManyHandz 'office' pattern); server-side creatability is a per-app decision.
 *
 * Throws APIError('BAD_REQUEST') — Better-Auth surfaces the message to the client verbatim.
 */
export async function assertKindCreatable(
  db: DB,
  org: { name: string; slug?: string; kind?: unknown },
  user: { id: string },
): Promise<void> {
  const raw = org.kind
  let kind: Kind
  if (raw === undefined || raw === null) {
    kind = DEFAULT_KIND
  } else if (typeof raw !== 'string') {
    throw new APIError('BAD_REQUEST', { message: 'Organization kind must be a string.' })
  } else if (raw === PERSONAL_KIND) {
    throw new APIError('BAD_REQUEST', {
      message: 'This organization type is reserved and cannot be created directly.',
    })
  } else if (!Object.hasOwn(KIND_CONFIGS, raw)) {
    // Object.hasOwn (never `in`/truthy access): prototype-chain names ('toString', …) must
    // fail vocabulary validation like any other unknown kind.
    throw new APIError('BAD_REQUEST', { message: `Unknown organization kind '${raw}'.` })
  } else {
    kind = raw as Kind
  }

  const cfg = KIND_CONFIGS[kind]
  const cap = cfg.maxPerUser
  if (cap === undefined) return

  // Count LIVE memberships in orgs of this kind — an archived membership is not a live one
  // (same rule as requireOrg), so leaving/being removed frees the slot. LIMIT cap: we only need
  // to know whether the cap is already met, never the full count.
  const existing = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
    .where(
      and(
        eq(schema.member.userId, user.id),
        eq(schema.organization.kind, kind),
        isNull(schema.member.archivedAt),
      ),
    )
    .limit(cap)
  if (existing.length >= cap) {
    const label = (cap === 1 ? cfg.label.singular : cfg.label.plural).toLowerCase()
    throw new APIError('BAD_REQUEST', {
      message: `You can belong to at most ${cap} ${label}.`,
    })
  }
}

/**
 * Rewrite the creator's member.role AFTER Better-Auth creates the org, when the kind's
 * creatorRole isn't the plugin's static 'owner' (D2 — the plugin assigns a single hardcoded
 * creator role; custom vocabularies fix it up here, grindline auth.ts:126-133).
 *
 * Default mint: creatorRole === 'owner' ⇒ no-op, ZERO queries — byte-identical behavior.
 * (Personal orgs never reach this hook: provision-user.ts inserts them via Drizzle directly.)
 */
export async function applyCreatorRole(
  db: DB,
  org: { id: string; kind?: string | null },
  member: { id: string },
): Promise<void> {
  const creatorRole = roleForJoin(org.kind ?? DEFAULT_KIND, true)
  if (creatorRole === 'owner') return
  await db
    .update(schema.member)
    .set({ role: creatorRole })
    .where(eq(schema.member.id, member.id))
}

/**
 * Map an accepted invitation's role into the org kind's vocabulary (SPINE §4.2 join rule,
 * ManyHandz release N+1). Better-Auth's accept-invitation copies invitation.role verbatim onto
 * the member row, but the chassis Team screen invites with the plugin's static 'member'/'admin'
 * vocabulary — which no household kind declares. Pure; total (never throws on stale data):
 *
 *  - role already ∈ KIND_CONFIGS[kind].roles → keep it (an invite that carried a household role,
 *    e.g. via the capability-gated invite route, passes through untouched)
 *  - 'owner' / 'admin' (privileged Better-Auth vocabulary) → the kind's creatorRole
 *  - anything else ('member', unknown/legacy strings)     → the kind's defaultJoinerRole
 *  - reserved personal kind → role kept verbatim (personal orgs keep Better-Auth vocabulary,
 *    and never send invitations anyway)
 *  - unknown kind → resolved through DEFAULT_KIND (same posture as roleForJoin)
 */
export function mapInvitationRole(kind: unknown, invitedRole: string): string {
  if (kind === PERSONAL_KIND) return invitedRole
  const k: Kind =
    typeof kind === 'string' && Object.hasOwn(KIND_CONFIGS, kind) ? (kind as Kind) : DEFAULT_KIND
  const cfg = KIND_CONFIGS[k]
  if ((cfg.roles as readonly string[]).includes(invitedRole)) return invitedRole
  return invitedRole === 'owner' || invitedRole === 'admin' ? cfg.creatorRole : cfg.defaultJoinerRole
}
