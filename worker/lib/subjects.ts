import { and, count, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { schema, type DB } from '@/lib/db'
import type { Subject } from '@/lib/db/schema'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Subject-primitive worker lib — caps, shared zod schemas, and the archive hook registry.
 *
 * ── STAGE-0 SEED (2026-07-05 harvest, STAGE0_SPEC §6.5) ──────────────────────────────────────
 * The `SubjectArchiveHook` type + `onSubjectArchived` registry below are orchestrator-seeded and
 * FROZEN — they must exist on every fleet branch from day 0 so A4 (share grants) can push its
 * revoke hook at module load without a cross-branch dependency. B2 (subject primitive) owns ALL
 * logic in this file and EXTENDS it per SUBJECT_SPEC §4: `subjectCap(db, orgId, kind)` + the
 * shared input-hygiene zod schemas. Nobody reshapes the seeded block.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

/** A cleanup to run when a subject is archived (cancel schedules, revoke subject-pinned grants…).
 *  Hook failures are LOGGED, never fail the archive (audit-helper convention — B2 enforces). */
export type SubjectArchiveHook = (db: DB, orgId: string, subjectId: string) => Promise<void>

/**
 * Apps + chassis modules push cleanups here AT MODULE LOAD (side-effect-free import — pushing a
 * function registers intent, it runs only when an archive actually happens). The template's one
 * default registrant is A4's grant revoker (worker/lib/access-grant.ts): soft-revoke all live
 * access_grant rows pinned to the archived subject (SUBJECT_SPEC §6). RxMndr ancestor:
 * persons.ts:154 cancels open escalations on archive.
 */
export const onSubjectArchived: SubjectArchiveHook[] = []

/**
 * Run every registered archive hook for a just-archived subject. Called by the archive route
 * AFTER the archivedAt write lands. Each hook is isolated: a throwing hook is structured-logged
 * and the rest still run — cleanup failures must never fail (or partially veto) the archive
 * itself, exactly like the audit() helper's posture.
 */
export async function runSubjectArchivedHooks(db: DB, orgId: string, subjectId: string): Promise<void> {
  for (const hook of onSubjectArchived) {
    try {
      await hook(db, orgId, subjectId)
    } catch (e) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'subject.archive_hook_failed',
          orgId,
          subjectId,
          message: e instanceof Error ? e.message : String(e),
        }),
      )
    }
  }
}

// ─── Tier cap (SUBJECT_SPEC §4) ────────────────────────────────────────────────────────────────

export type SubjectCap =
  | { limited: false }
  | { limited: true; limit: number; count: number; exceeded: boolean }

/**
 * Count ACTIVE (archivedAt IS NULL) subjects for the org against `monetization.limits.subjects`.
 * Archived subjects NEVER count (RxMndr rule: archiving frees a slot — history is not a paid
 * hostage), which also means a RESTORE re-occupies a slot and must re-pass the gate.
 *
 * The config key is a flat number in the shipped type (`limits: Record<string, number>`); an app
 * that widens it to a per-kind record (`{ pet: 2 }`) gets per-kind counting here for free —
 * per-kind caps count within the kind, a flat cap counts all kinds, and a kind absent from a
 * per-kind record is uncapped. Key absent entirely ⇒ `{ limited: false }` with ZERO queries
 * (the unconfigured mint pays nothing — limits.ts doctrine).
 *
 * This helper only counts; the route composes it with `requireTier` + `billingError` so the
 * entitlement read is skipped for unconfigured apps and the 402 envelope stays canonical
 * (code 'entity_cap_exceeded' — BILLING §8.1 supersedes SUBJECT_SPEC's earlier 'tier_limit').
 */
export async function subjectCap(db: DB, orgId: string, kind: string): Promise<SubjectCap> {
  const raw = (
    APP_CONFIG.monetization.limits as Record<string, number | Record<string, number> | undefined>
  ).subjects

  let limit: number | undefined
  let perKind = false
  if (typeof raw === 'number') {
    limit = raw
  } else if (raw !== undefined && raw !== null && typeof raw === 'object') {
    limit = raw[kind]
    perKind = true
  }
  if (limit === undefined) return { limited: false }

  const scope = perKind
    ? and(
        eq(schema.subject.organizationId, orgId),
        eq(schema.subject.kind, kind),
        isNull(schema.subject.archivedAt),
      )
    : and(eq(schema.subject.organizationId, orgId), isNull(schema.subject.archivedAt))

  const [row] = await db.select({ n: count() }).from(schema.subject).where(scope)
  const used = Number(row?.n ?? 0)
  return { limited: true, limit, count: used, exceeded: used >= limit }
}

// ─── Shared input hygiene (SUBJECT_SPEC §2) ────────────────────────────────────────────────────
// One schema pair serves POST and PATCH so the two can never drift. Field rules are the spec's:
// displayName 1–120 trimmed · notes ≤ 2000 · birthDate strict YYYY-MM-DD · timezone ≤ 64 ·
// profile a plain object whose JSON serialization is ≤ 8 KB (subjects are not blob storage).

/** Serialized-profile ceiling — the jsonb escape hatch is for low-churn extras, not blobs. */
export const MAX_PROFILE_BYTES = 8 * 1024

export const subjectDisplayNameSchema = z.string().trim().min(1).max(120)
export const subjectNotesSchema = z.string().max(2000)
/** Strict calendar-string birthday (RxMndr convention — no tz math on a birthday). */
export const subjectBirthDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD')
export const subjectTimezoneSchema = z.string().trim().min(1).max(64)

/** Plain object only (no arrays/classes), capped by serialized size — untrusted client jsonb. */
export const subjectProfileSchema = z
  .custom<Record<string, unknown>>(
    (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
    { message: 'profile must be a plain object' },
  )
  .refine(
    (v) => {
      try {
        return new TextEncoder().encode(JSON.stringify(v)).length <= MAX_PROFILE_BYTES
      } catch {
        return false // unserializable (circular can't arrive via JSON, but stay fail-safe)
      }
    },
    { message: `profile must serialize to at most ${MAX_PROFILE_BYTES} bytes` },
  )

/**
 * POST /subjects body. `kind` is validated against APP_CONFIG.subjects.kinds in the ROUTE (config
 * vocabulary, not schema shape); `isSelf` is a boolean INTENT — the server maps it to the CALLER's
 * user id and never accepts a client-supplied one (SUBJECT_SPEC §2). Unknown keys are stripped.
 */
export const createSubjectSchema = z.object({
  displayName: subjectDisplayNameSchema,
  kind: z.string().trim().min(1).max(64).optional(),
  timezone: subjectTimezoneSchema.nullish(),
  birthDate: subjectBirthDateSchema.nullish(),
  avatarMediaId: z.string().min(1).max(64).nullish(),
  notes: subjectNotesSchema.nullish(),
  profile: subjectProfileSchema.nullish(),
  isSelf: z.boolean().optional(),
})

/** PATCH /subjects/:id body — every field optional; `kind` and `isSelf` are NOT patchable
 *  (kind is identity, self-linking has its own caller-only routes). */
export const updateSubjectSchema = createSubjectSchema.omit({ kind: true, isSelf: true }).partial()

export type CreateSubjectBody = z.infer<typeof createSubjectSchema>
export type UpdateSubjectBody = z.infer<typeof updateSubjectSchema>

// ─── Wire DTO (SUBJECT_SPEC §7 privacy law) ────────────────────────────────────────────────────

/**
 * The org-scoped wire shape: `selfUserId` NEVER leaves the server raw. The roster only needs to
 * know (a) whether a subject is claimed (`selfLinked` — drives "link me" affordances) and
 * (b) whether it is the CALLER's own subject (`isSelf` — drives the active-subject default and
 * self badges). Exposing the raw user id would hand every member a stable cross-feature join key
 * for another person; the two booleans carry all the product signal with none of the linkage.
 */
export type SubjectDto = Omit<Subject, 'selfUserId'> & { selfLinked: boolean; isSelf: boolean }

/** Map a subject row to its wire DTO for `callerUserId` (pure — unit-tested). */
export function subjectToDto(row: Subject, callerUserId: string): SubjectDto {
  const { selfUserId, ...rest } = row
  return {
    ...rest,
    selfLinked: selfUserId != null,
    isSelf: selfUserId != null && selfUserId === callerUserId,
  }
}
