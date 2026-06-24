import { Hono } from 'hono'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { resolveHousehold, type HouseholdEnv } from '../household'
import { can } from '@/lib/config/modes'
import { computePoints, type CompletionPhotos } from '@/lib/manyhandz/points'
import { todayInTz, compareDate } from '@/lib/manyhandz/dates'
import { awardCompletion } from '../manyhandz/completion-engine'
import { createAI } from '../ai'
import { verifyPhotos } from '../ai/verify-photos'
import { signVerdict, verifyVerdictToken } from '../ai/verify-token'

/**
 * Completions + approval — the centerpiece. Completing an assignment runs the CANONICAL points
 * engine; APPROVAL GATES POINTS (the brief's §11 fix): a family kid's completion is `pending_approval`
 * and writes NO ledger entry until a parent approves; everyone else auto-approves and the engine
 * awards instantly. Credit always goes to the ASSIGNEE.
 *
 *   POST /api/organizations/:orgId/assignments/:assignmentId/complete  → complete
 *   GET  /api/organizations/:orgId/completions?status=pending_approval → approval queue
 *   POST /api/organizations/:orgId/completions/:id/approve             → approve   (approveCompletions)
 *   POST /api/organizations/:orgId/completions/:id/reject  { reason }  → reject    (approveCompletions)
 */
export const completionRoutes = new Hono<HouseholdEnv>()

const completeInput = z.object({
  beforePhotoMediaId: z.string().max(64).nullish(),
  afterPhotoMediaId: z.string().max(64).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  actualMinutes: z.number().int().min(0).max(100000).nullish(),
  /** Signed verdict from /verify-preview — lets the commit reuse the verdict the user already saw. */
  verificationToken: z.string().max(8192).nullish(),
})

const previewInput = z.object({
  afterPhotoMediaId: z.string().min(1).max(64),
  beforePhotoMediaId: z.string().max(64).nullish(),
})

function photosOf(before?: string | null, after?: string | null): CompletionPhotos {
  if (before && after) return 'both'
  if (before || after) return 'one'
  return 'none'
}

/** Active double-points multiplier for the household right now (×1 if none). */
async function activeMultiplier(env: HouseholdEnv['Bindings'], orgId: string): Promise<number> {
  const now = new Date()
  const [ch] = await getDb(env.DATABASE_URL)
    .select({ mult: schema.bonusChallenge.pointsMultiplier })
    .from(schema.bonusChallenge)
    .where(
      and(
        eq(schema.bonusChallenge.organizationId, orgId),
        eq(schema.bonusChallenge.status, 'active'),
        eq(schema.bonusChallenge.challengeType, 'double_points'),
        lte(schema.bonusChallenge.startsAt, now),
        gte(schema.bonusChallenge.endsAt, now),
      ),
    )
    .limit(1)
  return ch ? Math.max(1, ch.mult / 10) : 1
}

/**
 * Photo check (preview) — runs AI verification on the submitted after photo WITHOUT committing a
 * completion, so the assignee sees the verdict and can fix-and-retake or send as-is. Returns the
 * verdict plus a short-lived SIGNED token the /complete call passes back, so the commit applies the
 * exact verdict the user saw — no second model call, and the client can't forge it.
 */
completionRoutes.post('/:orgId/assignments/:assignmentId/verify-preview', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const assignmentId = c.req.param('assignmentId')

  const [a] = await db
    .select({
      id: schema.assignment.id,
      assignedToMemberId: schema.assignment.assignedToMemberId,
      aiVerificationEnabled: schema.chore.aiVerificationEnabled,
      referencePhotoMediaId: schema.chore.referencePhotoMediaId,
      choreName: schema.chore.name,
      choreDescription: schema.chore.description,
    })
    .from(schema.assignment)
    .innerJoin(schema.chore, eq(schema.chore.id, schema.assignment.choreId))
    .where(and(eq(schema.assignment.id, assignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
    .limit(1)
  if (!a) return c.json({ error: 'not found' }, 404)
  if (!a.aiVerificationEnabled) return c.json({ error: 'AI verification is not enabled for this chore' }, 400)

  // Same actor rule as completing: the assignee, or an admin acting on their behalf.
  const isAssignee = a.assignedToMemberId === ctx.memberId
  if (!isAssignee && !can(ctx.mode, ctx.householdRole, 'assignChores')) return c.json({ error: 'forbidden' }, 403)

  const parsed = previewInput.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)

  const verdict = await verifyPhotos(c.env, createAI(c.env), {
    orgId: ctx.orgId,
    task: a.choreName,
    instructions: a.choreDescription,
    afterMediaId: parsed.data.afterPhotoMediaId,
    referenceMediaId: a.referencePhotoMediaId,
  })
  if (!verdict) return c.json({ error: "Couldn't check that photo — you can still submit it for review." }, 502)

  const token = await signVerdict(c.env.BETTER_AUTH_SECRET, {
    assignmentId: a.id,
    afterPhotoMediaId: parsed.data.afterPhotoMediaId,
    verdict,
  })
  return c.json({ verdict, token })
})

completionRoutes.post('/:orgId/assignments/:assignmentId/complete', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const assignmentId = c.req.param('assignmentId')

  const [a] = await db
    .select({
      id: schema.assignment.id,
      choreId: schema.assignment.choreId,
      assignedToMemberId: schema.assignment.assignedToMemberId,
      dueDate: schema.assignment.dueDate,
      status: schema.assignment.status,
      difficulty: schema.chore.difficulty,
      estimatedMinutes: schema.chore.estimatedMinutes,
      requiresApproval: schema.chore.requiresApproval,
      aiVerificationEnabled: schema.chore.aiVerificationEnabled,
      referencePhotoMediaId: schema.chore.referencePhotoMediaId,
      choreName: schema.chore.name,
      choreDescription: schema.chore.description,
    })
    .from(schema.assignment)
    .innerJoin(schema.chore, eq(schema.chore.id, schema.assignment.choreId))
    .where(and(eq(schema.assignment.id, assignmentId), eq(schema.assignment.organizationId, ctx.orgId)))
    .limit(1)
  if (!a) return c.json({ error: 'not found' }, 404)
  if (a.status === 'completed' || a.status === 'pending_review') {
    return c.json({ error: 'already completed' }, 409)
  }

  // The assignee completes their own; an admin (assignChores) may complete on their behalf. Credit
  // always goes to the assignee.
  const isAssignee = a.assignedToMemberId === ctx.memberId
  if (!isAssignee && !can(ctx.mode, ctx.householdRole, 'assignChores')) return c.json({ error: 'forbidden' }, 403)

  const [assignee] = await db
    .select({ id: schema.member.id, userId: schema.member.userId, householdRole: schema.member.householdRole })
    .from(schema.member)
    .where(and(eq(schema.member.id, a.assignedToMemberId), eq(schema.member.organizationId, ctx.orgId)))
    .limit(1)
  if (!assignee?.userId) return c.json({ error: 'assignee not found' }, 404)

  const parsed = completeInput.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // Household config (timezone, requireApproval) for the points/approval calc.
  const [org] = await db
    .select({ timezone: schema.organization.timezone, requireApproval: schema.organization.requireApproval })
    .from(schema.organization)
    .where(eq(schema.organization.id, ctx.orgId))
    .limit(1)
  const tz = org?.timezone ?? 'America/New_York'

  // Pre-completion streak (the bonus reflects the streak AT completion time).
  const [streakRow] = await db
    .select({ current: schema.streak.currentCount })
    .from(schema.streak)
    .where(and(eq(schema.streak.organizationId, ctx.orgId), eq(schema.streak.userId, assignee.userId), eq(schema.streak.kind, 'chore')))
    .limit(1)

  const photos = photosOf(d.beforePhotoMediaId, d.afterPhotoMediaId)
  const breakdown = computePoints({
    difficulty: a.difficulty,
    estimatedMinutes: a.estimatedMinutes,
    actualMinutes: d.actualMinutes,
    currentStreak: streakRow?.current ?? 0,
    photos,
    early: compareDate(todayInTz(tz), a.dueDate) <= 0,
    challengeMultiplier: await activeMultiplier(c.env, ctx.orgId),
  })

  // ── Resolve the completion outcome ─────────────────────────────────────────────────────────────
  // Two independent gates can hold points back; otherwise we auto-approve and award instantly:
  //  1. AI photo verification — when the chore opted in AND an after photo was submitted, the vision
  //     model's verdict drives the outcome (it exists to REPLACE a human approver).
  //  2. Human approval — a family KID's work waits for a parent (only consulted when AI didn't run).

  // 1. AI verification. verifyPhotos reads the R2 bytes itself (the model can't fetch our auth-gated
  //    media URLs); any failure or unloadable photo returns null → we FLAG for a human, never a
  //    silent pass. Synchronous on purpose: the client shows a "verifying…" state and the verdict.
  let aiVerdict: Awaited<ReturnType<typeof verifyPhotos>> = null
  // reviewedByUser = the verdict came from a signed /verify-preview token, i.e. the user already SAW it
  // and chose to submit. That consent flips an auto_rejected verdict from a hard "redo" into a
  // "send for a human's eyes" — the user is allowed to override the AI, just not silently bypass it.
  let reviewedByUser = false
  const aiRan = a.aiVerificationEnabled && !!d.afterPhotoMediaId
  if (aiRan) {
    // Prefer the verdict the user already reviewed (same photo, no second model call, tamper-proof).
    if (d.verificationToken) {
      const payload = await verifyVerdictToken(c.env.BETTER_AUTH_SECRET, d.verificationToken)
      if (payload && payload.assignmentId === a.id && payload.afterPhotoMediaId === d.afterPhotoMediaId) {
        aiVerdict = payload.verdict
        reviewedByUser = true
      }
    }
    if (!aiVerdict) {
      try {
        aiVerdict = await verifyPhotos(c.env, createAI(c.env), {
          orgId: ctx.orgId,
          task: a.choreName,
          instructions: a.choreDescription,
          afterMediaId: d.afterPhotoMediaId!,
          referenceMediaId: a.referencePhotoMediaId,
        })
      } catch {
        aiVerdict = null
      }
    }
  }

  // 2. Human approval (only when AI didn't run).
  const humanNeedsApproval =
    ctx.mode === 'family' && assignee.householdRole === 'kid' && org?.requireApproval === true && a.requiresApproval === true

  const outcome: 'approved' | 'pending_approval' | 'rejected' = aiRan
    ? aiVerdict?.decision === 'auto_approved'
      ? 'approved'
      : aiVerdict?.decision === 'auto_rejected' && !reviewedByUser
        ? 'rejected' // AI said no on a raw submit (no preview) → bounce back for a redo
        : 'pending_approval' // flagged, OR rejected-but-user-chose-to-submit-anyway, OR unavailable
    : humanNeedsApproval
      ? 'pending_approval'
      : 'approved'

  const [completion] = await db
    .insert(schema.completion)
    .values({
      organizationId: ctx.orgId,
      assignmentId: a.id,
      completedByMemberId: assignee.id,
      beforePhotoMediaId: d.beforePhotoMediaId ?? null,
      afterPhotoMediaId: d.afterPhotoMediaId ?? null,
      notes: d.notes ?? null,
      actualMinutes: d.actualMinutes ?? null,
      pointsEarned: breakdown.total,
      speedBonus: breakdown.speedBonus,
      needsApproval: outcome === 'pending_approval',
      status: outcome,
      rejectionReason: outcome === 'rejected' ? (aiVerdict?.reasoning ?? null) : null,
    })
    .returning()

  // Persist the AI verdict next to the completion (audit trail + UI surface).
  if (aiVerdict) {
    await db.insert(schema.aiVerification).values({
      organizationId: ctx.orgId,
      completionId: completion.id,
      provider: aiVerdict.provider,
      model: aiVerdict.model,
      confidenceScore: aiVerdict.score,
      referenceMatchScore: aiVerdict.referenceMatch,
      reasoning: aiVerdict.reasoning,
      decision: aiVerdict.decision,
    })
  }

  // Approved → assignment done + points awarded. Rejected → back to in_progress for a redo (no points).
  // Pending → awaits a human; points award on /approve.
  await db
    .update(schema.assignment)
    .set({ status: outcome === 'approved' ? 'completed' : outcome === 'rejected' ? 'in_progress' : 'pending_review' })
    .where(eq(schema.assignment.id, a.id))

  if (outcome === 'approved') {
    await awardCompletion(db, {
      orgId: ctx.orgId,
      timezone: tz,
      completionId: completion.id,
      completerUserId: assignee.userId,
      completerMemberId: assignee.id,
      choreId: a.choreId,
      points: breakdown.total,
    })
  }
  await audit(c, {
    entityType: 'completion',
    entityId: completion.id,
    action:
      outcome === 'approved'
        ? 'completion.approved'
        : outcome === 'rejected'
          ? 'completion.rejected'
          : 'completion.pending_approval',
    metadata: { points: breakdown.total, ...(aiVerdict ? { aiDecision: aiVerdict.decision, aiScore: aiVerdict.score } : {}) },
  })
  return c.json({ completion, breakdown, needsApproval: outcome === 'pending_approval', aiVerdict }, 201)
})

completionRoutes.get('/:orgId/completions', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const status = c.req.query('status') ?? 'pending_approval'
  const rows = await getDb(c.env.DATABASE_URL)
    .select({
      id: schema.completion.id,
      assignmentId: schema.completion.assignmentId,
      completedByMemberId: schema.completion.completedByMemberId,
      completedAt: schema.completion.completedAt,
      beforePhotoMediaId: schema.completion.beforePhotoMediaId,
      afterPhotoMediaId: schema.completion.afterPhotoMediaId,
      notes: schema.completion.notes,
      pointsEarned: schema.completion.pointsEarned,
      status: schema.completion.status,
      choreName: schema.chore.name,
      choreIcon: schema.chore.icon,
      referencePhotoMediaId: schema.chore.referencePhotoMediaId,
      memberName: schema.member.displayName,
      // The AI verdict (when this completion was flagged by AI verification) — so the approver sees
      // the score + WHY it was flagged instead of a black-box "needs review".
      aiDecision: schema.aiVerification.decision,
      aiScore: schema.aiVerification.confidenceScore,
      aiReferenceMatch: schema.aiVerification.referenceMatchScore,
      aiReasoning: schema.aiVerification.reasoning,
    })
    .from(schema.completion)
    .innerJoin(schema.assignment, eq(schema.assignment.id, schema.completion.assignmentId))
    .innerJoin(schema.chore, eq(schema.chore.id, schema.assignment.choreId))
    .leftJoin(schema.member, eq(schema.member.id, schema.completion.completedByMemberId))
    .leftJoin(schema.aiVerification, eq(schema.aiVerification.completionId, schema.completion.id))
    .where(and(eq(schema.completion.organizationId, orgId), eq(schema.completion.status, status)))
    .orderBy(asc(schema.completion.createdAt))
    .limit(200)
  return c.json(rows)
})

async function loadPendingCompletion(env: HouseholdEnv['Bindings'], orgId: string, completionId: string) {
  const [row] = await getDb(env.DATABASE_URL)
    .select({
      id: schema.completion.id,
      assignmentId: schema.completion.assignmentId,
      completedByMemberId: schema.completion.completedByMemberId,
      pointsEarned: schema.completion.pointsEarned,
      status: schema.completion.status,
      choreId: schema.assignment.choreId,
    })
    .from(schema.completion)
    .innerJoin(schema.assignment, eq(schema.assignment.id, schema.completion.assignmentId))
    .where(and(eq(schema.completion.id, completionId), eq(schema.completion.organizationId, orgId)))
    .limit(1)
  return row
}

completionRoutes.post('/:orgId/completions/:id/approve', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'approveCompletions')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const comp = await loadPendingCompletion(c.env, ctx.orgId, c.req.param('id'))
  if (!comp) return c.json({ error: 'not found' }, 404)
  if (comp.status !== 'pending_approval') return c.json({ error: 'not pending approval' }, 409)

  const [assignee] = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.id, comp.completedByMemberId))
    .limit(1)
  if (!assignee?.userId) return c.json({ error: 'assignee not found' }, 404)

  const [org] = await db.select({ timezone: schema.organization.timezone }).from(schema.organization).where(eq(schema.organization.id, ctx.orgId)).limit(1)

  await db
    .update(schema.completion)
    .set({ status: 'approved', approvedByMemberId: ctx.memberId, approvedAt: new Date() })
    .where(eq(schema.completion.id, comp.id))
  await db.update(schema.assignment).set({ status: 'completed' }).where(eq(schema.assignment.id, comp.assignmentId))

  await awardCompletion(db, {
    orgId: ctx.orgId,
    timezone: org?.timezone ?? 'America/New_York',
    completionId: comp.id,
    completerUserId: assignee.userId,
    completerMemberId: comp.completedByMemberId,
    choreId: comp.choreId,
    points: comp.pointsEarned,
  })
  await audit(c, { entityType: 'completion', entityId: comp.id, action: 'completion.approved_by_parent' })
  return c.json({ ok: true })
})

completionRoutes.post('/:orgId/completions/:id/reject', requireOrg, async (c) => {
  const ctx = await resolveHousehold(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'approveCompletions')) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const parsed = z.object({ reason: z.string().trim().min(1).max(300) }).safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'a rejection reason is required' }, 400)

  const comp = await loadPendingCompletion(c.env, ctx.orgId, c.req.param('id'))
  if (!comp) return c.json({ error: 'not found' }, 404)
  if (comp.status !== 'pending_approval') return c.json({ error: 'not pending approval' }, 409)

  await db
    .update(schema.completion)
    .set({ status: 'rejected', rejectionReason: parsed.data.reason, approvedByMemberId: ctx.memberId, approvedAt: new Date() })
    .where(eq(schema.completion.id, comp.id))
  // Back to in_progress so the kid can redo it (the "Try Again" loop). No points awarded.
  await db.update(schema.assignment).set({ status: 'in_progress' }).where(eq(schema.assignment.id, comp.assignmentId))
  await audit(c, { entityType: 'completion', entityId: comp.id, action: 'completion.rejected' })
  return c.json({ ok: true })
})
