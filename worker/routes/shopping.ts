import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'
import { householdContext } from '../lib/household-context'

/**
 * Shared shopping / supply lists — a breadth ManyHandz resource (brief §"Shared Shopping"). Every
 * household member reads AND writes their lists: there's no dedicated permission in the mode matrix,
 * so reads gate on `requireOrg` and writes gate on `resolveHousehold` (which returns null for a
 * non-member → 403) to confirm membership AND resolve the caller's `memberId` for the *_by_member_id
 * stamps. Every query scopes by organizationId. Shopping awards no points → no credit ledger here.
 *
 * Multiple lists per household; the default "Groceries" list is created on demand (POST /lists), not
 * auto-seeded. Quick-add (POST /lists/:listId/items) keyword-categorizes a free-typed name into one
 * of the 13 categories. Check-off sets isChecked + checkedByMemberId + checkedAt atomically.
 *
 *   GET    /api/organizations/:orgId/shopping-lists                          → active lists
 *   POST   /api/organizations/:orgId/shopping-lists                          → create a list
 *   PATCH  /api/organizations/:orgId/shopping-lists/:listId                  → rename / archive / reorder
 *   DELETE /api/organizations/:orgId/shopping-lists/:listId                  → archive (soft delete)
 *   GET    /api/organizations/:orgId/shopping-lists/:listId/items           → items for a list
 *   POST   /api/organizations/:orgId/shopping-lists/:listId/items           → quick-add (auto-category)
 *   PATCH  /api/organizations/:orgId/shopping-lists/:listId/items/:itemId   → edit / check-off
 *   DELETE /api/organizations/:orgId/shopping-lists/:listId/items/:itemId   → remove an item
 */
export const shoppingRoutes = new Hono<AuthEnv>()

/** The 13 categories an item can land in (TEXT column; quick-add keyword-maps into these). */
export const SHOPPING_CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'bakery',
  'frozen',
  'pantry',
  'beverages',
  'snacks',
  'cleaning',
  'household',
  'personal',
  'pets',
  'other',
] as const
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number]

/**
 * Keyword → category map for quick-add auto-categorization. First keyword found (whole-word match,
 * case-insensitive) wins; nothing matches → 'other'. Deliberately ordered most-specific first so
 * e.g. "dog food" lands in pets, not pantry.
 */
const CATEGORY_KEYWORDS: { category: ShoppingCategory; keywords: string[] }[] = [
  {
    category: 'pets',
    keywords: ['dog', 'cat', 'puppy', 'kitten', 'litter', 'kibble', 'pet', 'leash', 'catnip', 'aquarium', 'birdseed'],
  },
  {
    category: 'cleaning',
    keywords: [
      'detergent', 'bleach', 'soap', 'sponge', 'cleaner', 'disinfectant', 'wipes', 'mop', 'broom',
      'dish', 'dishwasher', 'laundry', 'fabric softener', 'windex', 'lysol', 'clorox', 'scrubber',
    ],
  },
  {
    category: 'personal',
    keywords: [
      'shampoo', 'conditioner', 'toothpaste', 'toothbrush', 'deodorant', 'razor', 'shaving',
      'lotion', 'sunscreen', 'makeup', 'tampon', 'pad', 'floss', 'mouthwash', 'bandage',
      'aspirin', 'ibuprofen', 'vitamin', 'medicine', 'cotton', 'qtip', 'q-tip', 'sanitizer',
    ],
  },
  {
    category: 'household',
    keywords: [
      'paper towel', 'toilet paper', 'tissue', 'napkin', 'trash bag', 'garbage bag', 'foil',
      'plastic wrap', 'ziploc', 'battery', 'batteries', 'bulb', 'light bulb', 'candle', 'matches',
      'tape', 'glue', 'plunger', 'air freshener',
    ],
  },
  {
    category: 'frozen',
    keywords: [
      'frozen', 'ice cream', 'popsicle', 'ice', 'frozen pizza', 'tv dinner', 'frozen vegetables',
      'frozen fruit', 'waffles',
    ],
  },
  {
    category: 'bakery',
    keywords: [
      'bread', 'bagel', 'baguette', 'croissant', 'muffin', 'cake', 'cookie', 'pie', 'donut',
      'roll', 'bun', 'tortilla', 'pita', 'pastry',
    ],
  },
  {
    category: 'meat',
    keywords: [
      'chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'ham', 'steak', 'ground beef',
      'fish', 'salmon', 'tuna', 'shrimp', 'lamb', 'ribs', 'meat', 'hot dog', 'deli', 'tofu',
    ],
  },
  {
    category: 'dairy',
    keywords: [
      'milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'eggs', 'sour cream', 'cottage cheese',
      'half and half', 'creamer', 'whipped cream', 'margarine',
    ],
  },
  {
    category: 'produce',
    keywords: [
      'apple', 'banana', 'orange', 'grape', 'berry', 'strawberry', 'blueberry', 'lemon', 'lime',
      'lettuce', 'spinach', 'tomato', 'potato', 'onion', 'garlic', 'carrot', 'broccoli', 'pepper',
      'cucumber', 'celery', 'avocado', 'mushroom', 'corn', 'fruit', 'vegetable', 'veggie', 'salad',
      'kale', 'cilantro', 'parsley', 'ginger', 'melon', 'peach', 'pear', 'cherry', 'mango',
    ],
  },
  {
    category: 'beverages',
    keywords: [
      'water', 'juice', 'soda', 'coffee', 'tea', 'beer', 'wine', 'cola', 'lemonade', 'sparkling',
      'gatorade', 'kombucha', 'energy drink', 'drink', 'cider', 'seltzer',
    ],
  },
  {
    category: 'snacks',
    keywords: [
      'chips', 'pretzel', 'popcorn', 'candy', 'chocolate', 'cracker', 'nuts', 'granola bar',
      'snack', 'trail mix', 'jerky', 'gum', 'fruit snacks', 'salsa', 'dip',
    ],
  },
  {
    category: 'pantry',
    keywords: [
      'rice', 'pasta', 'flour', 'sugar', 'salt', 'oil', 'vinegar', 'cereal', 'oats', 'beans',
      'soup', 'sauce', 'ketchup', 'mustard', 'mayo', 'mayonnaise', 'peanut butter', 'jelly', 'jam',
      'honey', 'spice', 'broth', 'stock', 'can', 'canned', 'noodle', 'syrup', 'baking soda',
      'baking powder', 'yeast', 'cornstarch', 'olive oil', 'soy sauce', 'coffee filter',
    ],
  },
]

/** Quick-add auto-categorize: first keyword whose token appears in the name (case-insensitive). */
export function categorizeItem(name: string): ShoppingCategory {
  const haystack = ` ${name.toLowerCase().trim()} `
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      // Boundary-anchored on BOTH sides (exact word + simple plural) so "ham" doesn't match "hammer".
      if (haystack.includes(` ${kw} `) || haystack.includes(` ${kw}s `)) {
        return category
      }
    }
  }
  return 'other'
}

const categoryEnum = z.enum(SHOPPING_CATEGORIES)

// --- Lists ---

const listCreate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  icon: z.string().trim().max(40).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
})
const listUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  icon: z.string().trim().max(40).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  isArchived: z.boolean().optional(),
})

shoppingRoutes.get('/:orgId/shopping-lists', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.shoppingList)
    .where(and(eq(schema.shoppingList.organizationId, orgId), eq(schema.shoppingList.isArchived, false)))
    .orderBy(asc(schema.shoppingList.sortOrder), asc(schema.shoppingList.createdAt))
  return c.json(rows)
})

shoppingRoutes.post('/:orgId/shopping-lists', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const parsed = listCreate.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.shoppingList)
    .values({
      organizationId: ctx.orgId,
      name: d.name ?? 'Groceries',
      icon: d.icon ?? 'shopping-cart',
      sortOrder: d.sortOrder ?? 0,
      createdByMemberId: ctx.memberId,
    })
    .returning()
  await audit(c, { entityType: 'shopping_list', entityId: row.id, action: 'shopping_list.created', metadata: { name: row.name } })
  return c.json(row, 201)
})

shoppingRoutes.patch('/:orgId/shopping-lists/:listId', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const listId = c.req.param('listId')
  const parsed = listUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  const updates: Partial<typeof schema.shoppingList.$inferInsert> = {}
  if (d.name !== undefined) updates.name = d.name
  if (d.icon !== undefined) updates.icon = d.icon
  if (d.sortOrder !== undefined) updates.sortOrder = d.sortOrder
  if (d.isArchived !== undefined) updates.isArchived = d.isArchived
  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.shoppingList)
    .set(updates)
    .where(and(eq(schema.shoppingList.id, listId), eq(schema.shoppingList.organizationId, ctx.orgId)))
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'shopping_list', entityId: row.id, action: 'shopping_list.updated' })
  return c.json(row)
})

shoppingRoutes.delete('/:orgId/shopping-lists/:listId', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const listId = c.req.param('listId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.shoppingList)
    .set({ isArchived: true })
    .where(
      and(
        eq(schema.shoppingList.id, listId),
        eq(schema.shoppingList.organizationId, ctx.orgId),
        eq(schema.shoppingList.isArchived, false),
      ),
    )
    .returning({ id: schema.shoppingList.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'shopping_list', entityId: listId, action: 'shopping_list.archived' })
  return c.json({ ok: true })
})

// --- Items ---

const itemCreate = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.string().trim().max(40).nullish(),
  /** Optional explicit category; omitted → keyword auto-categorization. */
  category: categoryEnum.nullish(),
  note: z.string().trim().max(300).nullish(),
  assignedToMemberId: z.string().max(64).nullish(),
})
const itemUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  quantity: z.string().trim().max(40).nullish(),
  category: categoryEnum.nullish(),
  note: z.string().trim().max(300).nullish(),
  assignedToMemberId: z.string().max(64).nullish(),
  isChecked: z.boolean().optional(),
})

/** Confirm a list exists in this household (or 404). Returns the list id or null. */
async function listInOrg(env: AuthEnv['Bindings'], orgId: string, listId: string): Promise<string | null> {
  const [row] = await getDb(env.DATABASE_URL)
    .select({ id: schema.shoppingList.id })
    .from(schema.shoppingList)
    .where(and(eq(schema.shoppingList.id, listId), eq(schema.shoppingList.organizationId, orgId)))
    .limit(1)
  return row?.id ?? null
}

/** Confirm a member belongs to this household (assignee guard). */
async function memberInOrg(env: AuthEnv['Bindings'], orgId: string, memberId: string): Promise<boolean> {
  const [row] = await getDb(env.DATABASE_URL)
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, orgId)))
    .limit(1)
  return Boolean(row)
}

shoppingRoutes.get('/:orgId/shopping-lists/:listId/items', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const listId = c.req.param('listId')
  if (!(await listInOrg(c.env, orgId, listId))) return c.json({ error: 'not found' }, 404)
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.shoppingItem)
    .where(and(eq(schema.shoppingItem.organizationId, orgId), eq(schema.shoppingItem.listId, listId)))
    .orderBy(asc(schema.shoppingItem.isChecked), asc(schema.shoppingItem.createdAt))
  return c.json(rows)
})

shoppingRoutes.post('/:orgId/shopping-lists/:listId/items', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const listId = c.req.param('listId')
  if (!(await listInOrg(c.env, ctx.orgId, listId))) return c.json({ error: 'not found' }, 404)

  const parsed = itemCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data
  if (d.assignedToMemberId && !(await memberInOrg(c.env, ctx.orgId, d.assignedToMemberId))) {
    return c.json({ error: 'invalid assignee' }, 400)
  }

  // Quick-add: honor an explicit category, otherwise keyword auto-categorize the free-typed name.
  const category = d.category ?? categorizeItem(d.name)

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.shoppingItem)
    .values({
      organizationId: ctx.orgId,
      listId,
      name: d.name,
      quantity: d.quantity ?? null,
      category,
      note: d.note ?? null,
      assignedToMemberId: d.assignedToMemberId ?? null,
      addedByMemberId: ctx.memberId,
    })
    .returning()
  await audit(c, { entityType: 'shopping_item', entityId: row.id, action: 'shopping_item.added', metadata: { listId, category } })
  return c.json(row, 201)
})

shoppingRoutes.patch('/:orgId/shopping-lists/:listId/items/:itemId', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const listId = c.req.param('listId')
  const itemId = c.req.param('itemId')
  const parsed = itemUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data
  if (d.assignedToMemberId && !(await memberInOrg(c.env, ctx.orgId, d.assignedToMemberId))) {
    return c.json({ error: 'invalid assignee' }, 400)
  }

  const updates: Partial<typeof schema.shoppingItem.$inferInsert> = {}
  if (d.name !== undefined) updates.name = d.name
  if (d.quantity !== undefined) updates.quantity = d.quantity ?? null
  if (d.category !== undefined) updates.category = d.category ?? null
  if (d.note !== undefined) updates.note = d.note ?? null
  if (d.assignedToMemberId !== undefined) updates.assignedToMemberId = d.assignedToMemberId ?? null
  // Check-off / un-check sets the trio atomically (brief: isChecked + checkedByMemberId + checkedAt).
  if (d.isChecked !== undefined) {
    updates.isChecked = d.isChecked
    updates.checkedByMemberId = d.isChecked ? ctx.memberId : null
    updates.checkedAt = d.isChecked ? new Date() : null
  }
  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.shoppingItem)
    .set(updates)
    .where(
      and(
        eq(schema.shoppingItem.id, itemId),
        eq(schema.shoppingItem.organizationId, ctx.orgId),
        eq(schema.shoppingItem.listId, listId),
      ),
    )
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, {
    entityType: 'shopping_item',
    entityId: row.id,
    action: d.isChecked === undefined ? 'shopping_item.updated' : d.isChecked ? 'shopping_item.checked' : 'shopping_item.unchecked',
  })
  return c.json(row)
})

shoppingRoutes.delete('/:orgId/shopping-lists/:listId/items/:itemId', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const listId = c.req.param('listId')
  const itemId = c.req.param('itemId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .delete(schema.shoppingItem)
    .where(
      and(
        eq(schema.shoppingItem.id, itemId),
        eq(schema.shoppingItem.organizationId, ctx.orgId),
        eq(schema.shoppingItem.listId, listId),
      ),
    )
    .returning({ id: schema.shoppingItem.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'shopping_item', entityId: itemId, action: 'shopping_item.removed' })
  return c.json({ ok: true })
})
