import { Hono, type Context } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { can } from '@/lib/config/roles'
import { requireOrg, requireCapability, audit, type AuthEnv } from '../middleware/org'
import { requireTier } from '../entitlements'
import { billingError } from '../billing/limits'
import {
  createSubjectSchema,
  updateSubjectSchema,
  runSubjectArchivedHooks,
  subjectCap,
  subjectToDto,
} from '../lib/subjects'

/**
 * Subjects — the org-scoped "who/what this org tracks" roster (SUBJECT_SPEC §2): care recipient,
 * pet, child, athlete… A subject MAY be account-less (selfUserId null) or self-linked to the
 * caller's user. Follows the canonical resource shape (routes/notifications.ts): requireOrg on
 * every endpoint + every query filtered by organizationId, including by-id reads (golden rule 4).
 *
 *   GET   /:orgId/subjects                 [subject:view]    ?kind=&includeArchived=1
 *   GET   /:orgId/subjects/:id             [subject:view]
 *   POST  /:orgId/subjects                 [subject:manage]  cap-gated; `isSelf` honored for the CALLER only
 *   PATCH /:orgId/subjects/:id             [subject:manage]  displayName/timezone/birthDate/avatarMediaId/notes/profile
 *   POST  /:orgId/subjects/:id/archive     [subject:manage]  sets archivedAt; runs onSubjectArchived hooks
 *                                          (idempotent — hooks/audit fire once per actual transition)
 *   POST  /:orgId/subjects/:id/restore     [subject:manage]  cap-gated (restore re-occupies a slot)
 *   POST  /:orgId/subjects/:id/link-self   any member        selfUserId = session.user.id (409 when taken)
 *   POST  /:orgId/subjects/:id/unlink-self caller, or subject:manage for others
 *
 * AUTHORIZATION (M-7): the KIND_CONFIGS capability matrix is the ONE authority — writes gate with
 * requireCapability('subject:manage'), reads with requireCapability('subject:view'); the default
 * matrix (owner/admin manage, member views) reproduces the old writeRoles default byte-identically.
 * Link-self stays ANY member (linking *yourself* is not an admin action); admin unlink of others
 * handles offboarding. TIER CAPS gate creates/restores ONLY — reads, edits, archives, and existing
 * rows are NEVER gated (a lapsed org keeps everything it has; caps gate roster growth, never the
 * recording of care/safety events against existing subjects — SUBJECT_SPEC §4).
 *
 * PRIVACY DTO: rows leave through subjectToDto — `selfUserId` never serializes; the roster carries
 * `selfLinked`/`isSelf` booleans instead (SUBJECT_SPEC §7 rule 3; see worker/lib/subjects.ts).
 *
 * ── The Person ≠ Member privacy seam (SPINE_SPEC §9 rule 3) ─────────────────────────────────
 * Subject-scoped data (org-owned rows keyed subject_id — care logs, dose events) is gated by the
 * subject capabilities above, full stop. But when a subject is SELF-LINKED to another user, any
 * read that JOINS that user's USER-scoped data (rows keyed user_id in user-owned tables) must
 * ALSO pass assertCanOverseeMember (worker/lib/oversight.ts) — the stricter member fence wins;
 * modeling a person as a subject never weakens a real user's privacy. Worked example for an app
 * route that surfaces a subject's own logged workouts (user-scoped rows):
 *
 *   // GET /:orgId/subjects/:id/workouts
 *   const [subj] = await db.select().from(schema.subject)
 *     .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id))).limit(1)
 *   if (!subj) return c.json({ error: 'not found' }, 404)
 *   if (subj.selfUserId && subj.selfUserId !== session.user.id) {
 *     const ok = await assertCanOverseeMember({
 *       db, orgId, orgKind: c.get('orgKind'), requesterRole: c.get('orgRole'),
 *       requesterUserId: session.user.id, targetUserId: subj.selfUserId,
 *     })
 *     if (!ok) return c.json({ error: 'forbidden' }, 403)
 *   }
 *   // …now join the user-scoped table. Account-less subjects (selfUserId null) have no
 *   // user-scoped data — nothing to gate; subject-scoped joins skip this block entirely.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Mounted by worker/index.ts ONLY when APP_CONFIG.features.subjects (stage-0 §3 wiring); the
 * internal guard below is defense-in-depth so a stray mount can never expose the surface.
 */
export const subjectRoutes = new Hono<AuthEnv>()

/** Feature-off ⇒ 404 (not 403): the surface should not exist, and its absence isn't an oracle. */
subjectRoutes.use('*', async (c, next) => {
  if (!APP_CONFIG.features.subjects) return c.json({ error: 'not found' }, 404)
  return next()
})

/** The app's configured subject-kind vocabulary (APP_CONFIG.subjects.kinds; first = default). */
function kindConfig(kind: string) {
  return APP_CONFIG.subjects.kinds.find((k) => k.kind === kind)
}

/** Lowercased plural label for cap-error copy ("…tracks up to 2 pets."). */
function kindLabel(kind: string): string {
  return (kindConfig(kind)?.plural ?? 'subjects').toLowerCase()
}

/** Postgres unique-violation (the partial index subject_org_self_unique_idx) → API 409. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}

/**
 * avatarMediaId must reference a media row of THIS org — the same verify-every-client-supplied-id
 * posture as the grant subject pin. A cross-tenant (or dangling) id never persists: today the
 * media bytes stay org-fenced regardless (GET /api/media/:id), but a stored foreign reference is
 * exactly the kind of seam a future allowlist (e.g. grant-scoped avatar serving) would leak
 * through.
 */
async function assertMediaInOrg(
  db: ReturnType<typeof getDb>,
  orgId: string,
  mediaId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(and(eq(schema.media.organizationId, orgId), eq(schema.media.id, mediaId)))
    .limit(1)
  return Boolean(row)
}

/**
 * Free-tier cap gate for POST + restore (SUBJECT_SPEC §4, RxMndr persons.ts:67-84 generalized).
 * Key absent ⇒ zero queries. Entitled (trialTier↑, incl. live trial/grace via requireTier) orgs
 * sail past with one indexed read. Denial = the canonical BILLING §8.1 envelope → 402.
 * Returns a Response to send, or null to proceed.
 */
async function subjectCapGate(
  c: Context<AuthEnv>,
  db: ReturnType<typeof getDb>,
  orgId: string,
  kind: string,
): Promise<Response | null> {
  const limitCfg = (APP_CONFIG.monetization.limits as Record<string, unknown>).subjects
  if (limitCfg === undefined) return null
  const gate = await requireTier(db, orgId, APP_CONFIG.subscription.trialTier)
  if (gate.ok) return null
  const cap = await subjectCap(db, orgId, kind)
  if (cap.limited && cap.exceeded) {
    return billingError(c, {
      ok: false,
      code: 'entity_cap_exceeded',
      error: `The free plan tracks up to ${cap.limit} ${kindLabel(kind)}. Upgrade to add more.`,
      limit: cap.limit,
      used: cap.count,
      upgradeTier: APP_CONFIG.subscription.trialTier,
    })
  }
  return null
}

// ─── Reads ─────────────────────────────────────────────────────────────────────────────────────

subjectRoutes.get('/:orgId/subjects', requireOrg, requireCapability('subject:view'), async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const kind = c.req.query('kind')
  const includeArchived = c.req.query('includeArchived') === '1'

  const filters = [eq(schema.subject.organizationId, orgId)]
  if (kind) filters.push(eq(schema.subject.kind, kind))
  if (!includeArchived) filters.push(isNull(schema.subject.archivedAt))

  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.subject)
    .where(and(...filters))
    .orderBy(asc(schema.subject.displayName), asc(schema.subject.id))
  return c.json(rows.map((r) => subjectToDto(r, session.user.id)))
})

subjectRoutes.get('/:orgId/subjects/:id', requireOrg, requireCapability('subject:view'), async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const id = c.req.param('id')
  const [row] = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.subject)
    .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(subjectToDto(row, session.user.id))
})

// ─── Create ────────────────────────────────────────────────────────────────────────────────────

subjectRoutes.post('/:orgId/subjects', requireOrg, requireCapability('subject:manage'), async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const db = getDb(c.env.DATABASE_URL)

  const raw = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!raw || typeof raw !== 'object') return c.json({ error: 'a JSON object body is required' }, 400)
  const parsed = createSubjectSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
  }
  const body = parsed.data

  // Kind comes from the app's configured vocabulary; the first entry is the default (SUBJECT §1.3).
  const kind = body.kind ?? APP_CONFIG.subjects.kinds[0]?.kind ?? 'person'
  const cfg = kindConfig(kind)
  if (!cfg) {
    return c.json({ error: `unknown subject kind '${kind}'` }, 400)
  }

  // Self-link is only ever honorable for the CALLER (RxMndr persons.ts:93): `isSelf: true` maps to
  // the session's user id — a client-supplied user id is never accepted, anywhere.
  const isSelf = body.isSelf === true
  if (isSelf && !cfg.allowSelfLink) {
    return c.json({ error: `self-link is not available for ${kindLabel(kind)}` }, 400)
  }

  const denied = await subjectCapGate(c, db, orgId, kind)
  if (denied) return denied

  // Client-supplied media reference — verified against the org before it persists.
  if (body.avatarMediaId && !(await assertMediaInOrg(db, orgId, body.avatarMediaId))) {
    return c.json({ error: 'media not found' }, 404)
  }

  try {
    const [created] = await db
      .insert(schema.subject)
      .values({
        organizationId: orgId,
        kind,
        displayName: body.displayName,
        selfUserId: isSelf ? session.user.id : null,
        timezone: body.timezone ?? null,
        birthDate: body.birthDate ?? null,
        avatarMediaId: body.avatarMediaId ?? null,
        notes: body.notes ?? null,
        profile: body.profile ?? null,
        createdByMemberId: c.get('orgMemberId'),
      })
      .returning()
    await audit(c, {
      entityType: 'subject',
      entityId: created.id,
      action: 'subject.created',
      metadata: { displayName: created.displayName, kind, isSelf },
    })
    return c.json(subjectToDto(created, session.user.id), 201)
  } catch (e) {
    // subject_org_self_unique_idx: a user is at most one "self" per org (SUBJECT §1.1).
    if (isUniqueViolation(e)) {
      return c.json({ error: 'you already have a self-linked subject in this organization' }, 409)
    }
    throw e
  }
})

// ─── Update ────────────────────────────────────────────────────────────────────────────────────

subjectRoutes.patch('/:orgId/subjects/:id', requireOrg, requireCapability('subject:manage'), async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const id = c.req.param('id')
  const db = getDb(c.env.DATABASE_URL)

  const raw = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!raw || typeof raw !== 'object') return c.json({ error: 'a JSON object body is required' }, 400)
  const parsed = updateSubjectSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
  }
  const body = parsed.data

  // Key-presence (not undefined-ness) decides what gets patched, so `"notes": null` CLEARS while
  // an omitted field is untouched — the RxMndr PATCH convention.
  const patch: Partial<typeof schema.subject.$inferInsert> = {}
  if ('displayName' in raw && body.displayName !== undefined) patch.displayName = body.displayName
  if ('timezone' in raw) patch.timezone = body.timezone ?? null
  if ('birthDate' in raw) patch.birthDate = body.birthDate ?? null
  if ('avatarMediaId' in raw) patch.avatarMediaId = body.avatarMediaId ?? null
  if ('notes' in raw) patch.notes = body.notes ?? null
  if ('profile' in raw) patch.profile = body.profile ?? null
  if (Object.keys(patch).length === 0) return c.json({ error: 'no updatable fields' }, 400)

  // Client-supplied media reference — verified against the org before it persists (null clears).
  if (patch.avatarMediaId && !(await assertMediaInOrg(db, orgId, patch.avatarMediaId))) {
    return c.json({ error: 'media not found' }, 404)
  }

  const [updated] = await db
    .update(schema.subject)
    .set(patch)
    .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id)))
    .returning()
  if (!updated) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'subject', entityId: id, action: 'subject.updated' })
  return c.json(subjectToDto(updated, session.user.id))
})

// ─── Archive / restore ─────────────────────────────────────────────────────────────────────────

subjectRoutes.post('/:orgId/subjects/:id/archive', requireOrg, requireCapability('subject:manage'), async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const id = c.req.param('id')
  const db = getDb(c.env.DATABASE_URL)

  // Read first (mirrors restore): archiving is IDEMPOTENT. An already-archived subject returns
  // unchanged — the original archivedAt is history ("archived on X", and in capped apps the record
  // of when the slot freed), onSubjectArchived hooks fire once per ACTUAL transition (app hooks
  // may carry side effects — cancel-and-notify, SMS), and no duplicate audit row lands.
  const [row] = await db
    .select()
    .from(schema.subject)
    .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  if (row.archivedAt !== null) return c.json(subjectToDto(row, session.user.id))

  // isNull guard closes the read-then-write race: two concurrent archives resolve to ONE winner
  // (the loser matches zero rows and takes the idempotent no-op path below).
  const [updated] = await db
    .update(schema.subject)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(schema.subject.organizationId, orgId),
        eq(schema.subject.id, id),
        isNull(schema.subject.archivedAt),
      ),
    )
    .returning()
  if (!updated) {
    // Lost the race after our read — the row exists and is archived; return it unchanged.
    const [current] = await db
      .select()
      .from(schema.subject)
      .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id)))
      .limit(1)
    if (!current) return c.json({ error: 'not found' }, 404)
    return c.json(subjectToDto(current, session.user.id))
  }

  // App cleanups (cancel schedules, soft-revoke subject-pinned grants…). Each hook is isolated
  // and log-never-throw — a cleanup failure never fails the archive (worker/lib/subjects.ts).
  await runSubjectArchivedHooks(db, orgId, id)

  await audit(c, { entityType: 'subject', entityId: id, action: 'subject.archived' })
  return c.json(subjectToDto(updated, session.user.id))
})

subjectRoutes.post('/:orgId/subjects/:id/restore', requireOrg, requireCapability('subject:manage'), async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const id = c.req.param('id')
  const db = getDb(c.env.DATABASE_URL)

  // Read first: the cap gate needs the row's kind, and an already-active row must not burn a
  // cap read (restore is idempotent — restoring an active subject is a no-op success).
  const [row] = await db
    .select()
    .from(schema.subject)
    .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  if (row.archivedAt === null) return c.json(subjectToDto(row, session.user.id))

  // Restore counts as re-adding an active subject (SUBJECT §4 — archiving freed the slot).
  const denied = await subjectCapGate(c, db, orgId, row.kind)
  if (denied) return denied

  const [updated] = await db
    .update(schema.subject)
    .set({ archivedAt: null })
    .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id)))
    .returning()
  if (!updated) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'subject', entityId: id, action: 'subject.restored' })
  return c.json(subjectToDto(updated, session.user.id))
})

// ─── Self-link lifecycle ───────────────────────────────────────────────────────────────────────

subjectRoutes.post('/:orgId/subjects/:id/link-self', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const id = c.req.param('id')
  const db = getDb(c.env.DATABASE_URL)

  const [row] = await db
    .select()
    .from(schema.subject)
    .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)

  const cfg = kindConfig(row.kind)
  if (!cfg?.allowSelfLink) {
    return c.json({ error: `self-link is not available for ${kindLabel(row.kind)}` }, 400)
  }
  // Idempotent: linking a subject you already own is a success, not a conflict.
  if (row.selfUserId === session.user.id) return c.json(subjectToDto(row, session.user.id))
  // You cannot claim a subject someone else already claimed (privacy rule 4: no re-pointing).
  if (row.selfUserId !== null) {
    return c.json({ error: 'this subject is already linked to another account' }, 409)
  }

  try {
    // isNull guard in the WHERE closes the read-then-write race: two concurrent claims can't both
    // land — the loser matches zero rows and 409s like any late arrival.
    const [updated] = await db
      .update(schema.subject)
      .set({ selfUserId: session.user.id })
      .where(
        and(
          eq(schema.subject.organizationId, orgId),
          eq(schema.subject.id, id),
          isNull(schema.subject.selfUserId),
        ),
      )
      .returning()
    if (!updated) return c.json({ error: 'this subject is already linked to another account' }, 409)
    await audit(c, { entityType: 'subject', entityId: id, action: 'subject.self_linked' })
    return c.json(subjectToDto(updated, session.user.id))
  } catch (e) {
    // subject_org_self_unique_idx: the caller is already someone else's "self" in this org.
    if (isUniqueViolation(e)) {
      return c.json({ error: 'you already have a self-linked subject in this organization' }, 409)
    }
    throw e
  }
})

subjectRoutes.post('/:orgId/subjects/:id/unlink-self', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')
  const id = c.req.param('id')
  const db = getDb(c.env.DATABASE_URL)

  const [row] = await db
    .select()
    .from(schema.subject)
    .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  // Nothing linked — idempotent no-op (and no audit noise).
  if (row.selfUserId === null) return c.json(subjectToDto(row, session.user.id))

  // The caller may always unlink THEMSELVES; unlinking someone else (offboarding) is a
  // subject:manage action. Inline `can` (not requireCapability middleware) because the decision
  // depends on WHOSE link it is — resolvable only after the row is read.
  const unlinkingSelf = row.selfUserId === session.user.id
  if (!unlinkingSelf && !can(c.get('orgKind'), c.get('orgRole'), 'subject:manage')) {
    return c.json({ error: 'forbidden — insufficient permission' }, 403)
  }

  const [updated] = await db
    .update(schema.subject)
    .set({ selfUserId: null })
    .where(and(eq(schema.subject.organizationId, orgId), eq(schema.subject.id, id)))
    .returning()
  if (!updated) return c.json({ error: 'not found' }, 404)
  await audit(c, {
    entityType: 'subject',
    entityId: id,
    action: 'subject.self_unlinked',
    metadata: { by: unlinkingSelf ? 'self' : 'manager' },
  })
  return c.json(subjectToDto(updated, session.user.id))
})
