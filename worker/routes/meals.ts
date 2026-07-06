import { Hono } from 'hono'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'
import { householdContext } from '../lib/household-context'

/**
 * Meal planning (PROMOTED feature) — a breadth ManyHandz resource (mirrors shopping.ts). Every
 * household member reads AND writes the week's plan: there's no dedicated permission in the mode
 * matrix, so reads gate on `requireOrg` and writes gate on `resolveHousehold` (which returns null
 * for a non-member → 403) to confirm membership AND resolve the caller's `memberId` for the
 * added_by_member_id stamp. Every query scopes by organizationId. Meal planning awards no points →
 * no credit ledger here.
 *
 * `GET /meal-plan?weekStart=YYYY-MM-DD` returns the seven entries-by-day for the week (date is a
 * TEXT YYYY-MM-DD column, so a string range [weekStart, weekStart+6] selects the week). Grocery
 * generation reads every entry in the week and pushes its ingredients into a shopping_list as
 * shopping_item rows (de-duped by name+category within the run).
 *
 *   GET    /api/organizations/:orgId/meal-plan?weekStart=YYYY-MM-DD     → entries for the week
 *   POST   /api/organizations/:orgId/meal-plan                          → create a meal entry
 *   PATCH  /api/organizations/:orgId/meal-plan/:entryId                 → edit a meal entry
 *   DELETE /api/organizations/:orgId/meal-plan/:entryId                 → remove a meal entry
 *   POST   /api/organizations/:orgId/meal-plan/generate-grocery        → push week's ingredients
 */
export const mealRoutes = new Hono<AuthEnv>()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

/** The 7-day inclusive end date (YYYY-MM-DD) for a week starting at `weekStart`. */
function weekEnd(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`)
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000)
  return end.toISOString().slice(0, 10)
}

const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.string().trim().max(40).optional(),
  category: z.string().trim().max(40).optional(),
})
const ingredientsSchema = z.array(ingredientSchema).max(60)

const entryCreate = z.object({
  date: z.string().regex(DATE_RE),
  mealType: z.enum(MEAL_TYPES),
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(1000).nullish(),
  recipeUrl: z.string().trim().url().max(500).nullish(),
  ingredients: ingredientsSchema.optional(),
})
const entryUpdate = entryCreate.partial()

const generateGrocery = z.object({
  weekStart: z.string().regex(DATE_RE),
  listId: z.string().max(64),
})

mealRoutes.get('/:orgId/meal-plan', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const weekStart = c.req.query('weekStart')
  if (!weekStart || !DATE_RE.test(weekStart)) {
    return c.json({ error: 'weekStart (YYYY-MM-DD) is required' }, 400)
  }
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.mealPlanEntry)
    .where(
      and(
        eq(schema.mealPlanEntry.organizationId, orgId),
        gte(schema.mealPlanEntry.date, weekStart),
        lte(schema.mealPlanEntry.date, weekEnd(weekStart)),
      ),
    )
    .orderBy(asc(schema.mealPlanEntry.date), asc(schema.mealPlanEntry.createdAt))
  return c.json(rows)
})

mealRoutes.post('/:orgId/meal-plan', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const parsed = entryCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.mealPlanEntry)
    .values({
      organizationId: ctx.orgId,
      date: d.date,
      mealType: d.mealType,
      title: d.title,
      notes: d.notes ?? null,
      recipeUrl: d.recipeUrl ?? null,
      ingredients: d.ingredients ?? [],
      addedByMemberId: ctx.memberId,
    })
    .returning()
  await audit(c, {
    entityType: 'meal_plan_entry',
    entityId: row.id,
    action: 'meal_plan_entry.created',
    metadata: { date: row.date, mealType: row.mealType },
  })
  return c.json(row, 201)
})

mealRoutes.patch('/:orgId/meal-plan/:entryId', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const entryId = c.req.param('entryId')
  const parsed = entryUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  // Build the update from only the keys the client actually sent (PATCH semantics).
  const updates: Partial<typeof schema.mealPlanEntry.$inferInsert> = {}
  if (d.date !== undefined) updates.date = d.date
  if (d.mealType !== undefined) updates.mealType = d.mealType
  if (d.title !== undefined) updates.title = d.title
  if (d.notes !== undefined) updates.notes = d.notes ?? null
  if (d.recipeUrl !== undefined) updates.recipeUrl = d.recipeUrl ?? null
  if (d.ingredients !== undefined) updates.ingredients = d.ingredients
  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.mealPlanEntry)
    .set(updates)
    .where(and(eq(schema.mealPlanEntry.id, entryId), eq(schema.mealPlanEntry.organizationId, ctx.orgId)))
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'meal_plan_entry', entityId: row.id, action: 'meal_plan_entry.updated' })
  return c.json(row)
})

mealRoutes.delete('/:orgId/meal-plan/:entryId', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const entryId = c.req.param('entryId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .delete(schema.mealPlanEntry)
    .where(and(eq(schema.mealPlanEntry.id, entryId), eq(schema.mealPlanEntry.organizationId, ctx.orgId)))
    .returning({ id: schema.mealPlanEntry.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'meal_plan_entry', entityId: entryId, action: 'meal_plan_entry.deleted' })
  return c.json({ ok: true })
})

/**
 * Generate a grocery list — read every meal entry in the week, flatten their ingredients, de-dupe by
 * name+category (case-insensitive) within this run, and insert each as a shopping_item on the given
 * list. The list must belong to this household (org-scoped). Returns the count of items added.
 */
mealRoutes.post('/:orgId/meal-plan/generate-grocery', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const db = getDb(c.env.DATABASE_URL)
  const parsed = generateGrocery.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const { weekStart, listId } = parsed.data

  // The target list must exist in this household.
  const [list] = await db
    .select({ id: schema.shoppingList.id })
    .from(schema.shoppingList)
    .where(and(eq(schema.shoppingList.id, listId), eq(schema.shoppingList.organizationId, ctx.orgId)))
    .limit(1)
  if (!list) return c.json({ error: 'shopping list not found' }, 404)

  const entries = await db
    .select({ ingredients: schema.mealPlanEntry.ingredients })
    .from(schema.mealPlanEntry)
    .where(
      and(
        eq(schema.mealPlanEntry.organizationId, ctx.orgId),
        gte(schema.mealPlanEntry.date, weekStart),
        lte(schema.mealPlanEntry.date, weekEnd(weekStart)),
      ),
    )

  // Flatten + de-dupe by name+category (case-insensitive) so the run doesn't push 5× "eggs".
  const seen = new Set<string>()
  const toInsert: (typeof schema.shoppingItem.$inferInsert)[] = []
  for (const entry of entries) {
    for (const ing of entry.ingredients) {
      const name = ing.name?.trim()
      if (!name) continue
      const category = ing.category?.trim() || null
      const key = `${name.toLowerCase()}::${(category ?? '').toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      toInsert.push({
        organizationId: ctx.orgId,
        listId,
        name,
        quantity: ing.quantity?.trim() || null,
        category,
        addedByMemberId: ctx.memberId,
      })
    }
  }

  if (toInsert.length > 0) {
    await db.insert(schema.shoppingItem).values(toInsert)
  }
  await audit(c, {
    entityType: 'shopping_list',
    entityId: listId,
    action: 'meal_plan.grocery_generated',
    metadata: { weekStart, listId, itemsAdded: toInsert.length },
  })
  return c.json({ ok: true, itemsAdded: toInsert.length }, 201)
})
