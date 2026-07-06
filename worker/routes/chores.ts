import { Hono } from 'hono'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, requireCapability, type AuthEnv } from '../middleware/org'

import { requireTier } from '../entitlements'
import { createAI } from '../ai'
import { describeReference } from '../ai/verify-photos'
import { logApiUsage } from '../usage/log'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Fire-and-forget: derive the "what done looks like" rubric from a chore's reference photo and store it,
 * so verification judges against TEXT (1 image/check) instead of re-sending the reference image every
 * time. Runs on create/edit when the reference photo is set or changed; clears the rubric when removed.
 */
async function refreshRubric(
  env: AuthEnv['Bindings'],
  orgId: string,
  chore: { id: string; name: string; description: string | null; referencePhotoMediaId: string | null },
): Promise<void> {
  const db = getDb(env.DATABASE_URL)
  if (!chore.referencePhotoMediaId) {
    await db.update(schema.chore).set({ referenceRubric: null }).where(and(eq(schema.chore.id, chore.id), eq(schema.chore.organizationId, orgId)))
    return
  }
  const ai = createAI(env)
  const started = Date.now()
  const res = await describeReference(env, ai, {
    orgId,
    task: chore.name,
    instructions: chore.description,
    referenceMediaId: chore.referencePhotoMediaId,
  })
  if (!res) return
  await db.update(schema.chore).set({ referenceRubric: res.rubric }).where(and(eq(schema.chore.id, chore.id), eq(schema.chore.organizationId, orgId)))
  await logApiUsage(env, {
    organizationId: orgId,
    provider: ai.providerForModel(ai.models.verify),
    feature: 'chore.reference_rubric',
    operation: ai.models.verify,
    inputUnits: res.usage.inputTokens,
    outputUnits: res.usage.outputTokens,
    unitKind: 'tokens',
    ok: true,
    latencyMs: Date.now() - started,
  })
}

/**
 * Chores — the reusable chore definitions for a household. The canonical ManyHandz resource route:
 * org-scoped reads (every member sees the library), mode-permission-gated writes
 * (`requireCapability('chore:create')` — parents/roommates/managers, never kids). Soft delete via
 * isActive. Pairs with src/lib/query/hooks/useChores.ts.
 *
 *   GET    /api/organizations/:orgId/chores            → active chores, newest first
 *   GET    /api/organizations/:orgId/chores/:choreId   → one chore
 *   POST   /api/organizations/:orgId/chores            → create        (createChores)
 *   PATCH  /api/organizations/:orgId/chores/:choreId   → edit          (createChores)
 *   DELETE /api/organizations/:orgId/chores/:choreId   → soft delete   (createChores)
 */
export const choreRoutes = new Hono<AuthEnv>()

const checklistSchema = z
  .array(z.object({ label: z.string().trim().min(1).max(120), required: z.boolean() }))
  .max(30)

const choreCreate = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
  categoryId: z.string().max(64).nullish(),
  difficulty: z.number().int().min(1).max(5).optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional(),
  icon: z.string().max(40).optional(),
  requiresApproval: z.boolean().optional(),
  aiVerificationEnabled: z.boolean().optional(),
  /** The "here's what done looks like" reference photo — a media id the AI verifier compares against. */
  referencePhotoMediaId: z.string().max(64).nullish(),
  checklist: checklistSchema.optional(),
})
const choreUpdate = choreCreate.partial()

/** Confirm a category belongs to this household (or is cleared). Returns false on a foreign id. */
async function categoryOk(env: AuthEnv['Bindings'], orgId: string, categoryId: string | null | undefined) {
  if (!categoryId) return true
  const [cat] = await getDb(env.DATABASE_URL)
    .select({ id: schema.choreCategory.id })
    .from(schema.choreCategory)
    .where(and(eq(schema.choreCategory.id, categoryId), eq(schema.choreCategory.organizationId, orgId)))
    .limit(1)
  return Boolean(cat)
}

choreRoutes.get('/:orgId/chores', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.chore)
    .where(and(eq(schema.chore.organizationId, orgId), eq(schema.chore.isActive, true)))
    .orderBy(desc(schema.chore.createdAt))
  return c.json(rows)
})

choreRoutes.get('/:orgId/chores/:choreId', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.chore)
    .where(and(eq(schema.chore.id, c.req.param('choreId')), eq(schema.chore.organizationId, orgId)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})

choreRoutes.post('/:orgId/chores', requireOrg, requireCapability('chore:create'), async (c) => {
  const orgId = c.get('orgId')
  const memberId = c.get('orgMemberId')
  const db = getDb(c.env.DATABASE_URL)

  // Free-tier cap: a FREE household keeps up to APP_CONFIG.monetization.limits.lists active chores;
  // creating beyond that needs Premium. requireTier already lets trialing/grace orgs through, so we
  // only count + cap when the org isn't entitled. Editing/deleting existing chores stays free.
  const listCap = APP_CONFIG.monetization.limits.lists
  const gate = await requireTier(db, orgId, 'STANDARD')
  if (!gate.ok) {
    const [{ value: activeCount }] = await db
      .select({ value: count() })
      .from(schema.chore)
      .where(and(eq(schema.chore.organizationId, orgId), eq(schema.chore.isActive, true)))
    if (activeCount >= listCap) {
      return c.json(
        { error: `Free households are limited to ${listCap} chores. Upgrade to Premium to add more.`, reason: gate.reason },
        402,
      )
    }
  }

  const parsed = choreCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data
  if (!(await categoryOk(c.env, orgId, d.categoryId))) return c.json({ error: 'invalid category' }, 400)

  const [row] = await db
    .insert(schema.chore)
    .values({
      organizationId: orgId,
      categoryId: d.categoryId ?? null,
      name: d.name,
      description: d.description ?? null,
      difficulty: d.difficulty ?? 3,
      estimatedMinutes: d.estimatedMinutes ?? 15,
      icon: d.icon ?? 'sparkles',
      requiresApproval: d.requiresApproval ?? true,
      aiVerificationEnabled: d.aiVerificationEnabled ?? false,
      referencePhotoMediaId: d.referencePhotoMediaId ?? null,
      checklist: d.checklist ?? [],
      createdByMemberId: memberId,
    })
    .returning()
  // Pre-compute the reference rubric once (off the request path) so checks judge against text, not the image.
  if (row.referencePhotoMediaId) c.executionCtx.waitUntil(refreshRubric(c.env, orgId, row))
  await audit(c, { entityType: 'chore', entityId: row.id, action: 'chore.created', metadata: { name: row.name } })
  return c.json(row, 201)
})

choreRoutes.patch('/:orgId/chores/:choreId', requireOrg, requireCapability('chore:create'), async (c) => {
  const orgId = c.get('orgId')
  const choreId = c.req.param('choreId')
  const parsed = choreUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data
  if (!(await categoryOk(c.env, orgId, d.categoryId))) return c.json({ error: 'invalid category' }, 400)

  // Build the update from only the keys the client actually sent (PATCH semantics).
  const updates: Partial<typeof schema.chore.$inferInsert> = {}
  if (d.name !== undefined) updates.name = d.name
  if (d.description !== undefined) updates.description = d.description ?? null
  if (d.categoryId !== undefined) updates.categoryId = d.categoryId ?? null
  if (d.difficulty !== undefined) updates.difficulty = d.difficulty
  if (d.estimatedMinutes !== undefined) updates.estimatedMinutes = d.estimatedMinutes
  if (d.icon !== undefined) updates.icon = d.icon
  if (d.requiresApproval !== undefined) updates.requiresApproval = d.requiresApproval
  if (d.aiVerificationEnabled !== undefined) updates.aiVerificationEnabled = d.aiVerificationEnabled
  if (d.referencePhotoMediaId !== undefined) updates.referencePhotoMediaId = d.referencePhotoMediaId ?? null
  if (d.checklist !== undefined) updates.checklist = d.checklist
  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.chore)
    .set(updates)
    .where(
      and(
        eq(schema.chore.id, choreId),
        eq(schema.chore.organizationId, orgId),
        eq(schema.chore.isActive, true),
      ),
    )
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  // Reference photo set/changed/removed → refresh (or clear) the cached rubric.
  if (d.referencePhotoMediaId !== undefined) c.executionCtx.waitUntil(refreshRubric(c.env, orgId, row))
  await audit(c, { entityType: 'chore', entityId: row.id, action: 'chore.updated' })
  return c.json(row)
})

choreRoutes.delete('/:orgId/chores/:choreId', requireOrg, requireCapability('chore:create'), async (c) => {
  const orgId = c.get('orgId')
  const choreId = c.req.param('choreId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.chore)
    .set({ isActive: false })
    .where(and(eq(schema.chore.id, choreId), eq(schema.chore.organizationId, orgId), eq(schema.chore.isActive, true)))
    .returning({ id: schema.chore.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'chore', entityId: choreId, action: 'chore.deleted' })
  return c.json({ ok: true })
})

// --- Chore categories (8 seeded per household + custom) ---

choreRoutes.get('/:orgId/chore-categories', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.choreCategory)
    .where(eq(schema.choreCategory.organizationId, orgId))
    .orderBy(asc(schema.choreCategory.displayOrder), asc(schema.choreCategory.name))
  return c.json(rows)
})

const categoryInput = z.object({
  name: z.string().trim().min(1).max(40),
  icon: z.string().max(40).optional(),
  color: z.string().max(24).optional(),
})

choreRoutes.post('/:orgId/chore-categories', requireOrg, requireCapability('chore:create'), async (c) => {
  const orgId = c.get('orgId')
  const parsed = categoryInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.choreCategory)
    .values({ organizationId: orgId, name: parsed.data.name, icon: parsed.data.icon ?? 'home', color: parsed.data.color ?? 'slate', isDefault: false })
    .returning()
  await audit(c, { entityType: 'chore_category', entityId: row.id, action: 'category.created' })
  return c.json(row, 201)
})
