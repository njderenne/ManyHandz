import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit } from '../middleware/org'
import { requirePermission, type HouseholdEnv } from '../household'

/**
 * Badges — the household's recognition layer. Two kinds live side by side:
 *
 *   • SYSTEM badges  — definitions live in code (SYSTEM_BADGE_CATALOG below); only the *unlocks*
 *                      are data (achievement_unlock rows, keyed by userId). Auto-award wiring off
 *                      the completion engine is a follow-up — the catalog + read surface ship now.
 *   • CUSTOM badges  — parents / admins author these (createChores-gated, exactly like chores &
 *                      categories: parents, roommates, office managers — never kids). Manual award
 *                      / revoke writes custom_badge_award rows (unique per badge+member).
 *
 * Plus the household_milestone context (100/500/… completions, Perfect Month, …) surfaced read-only.
 *
 *   GET    /api/organizations/:orgId/badges                       → custom badge library + system catalog
 *   POST   /api/organizations/:orgId/badges                       → create custom badge   (createChores)
 *   PATCH  /api/organizations/:orgId/badges/:badgeId              → edit custom badge      (createChores)
 *   DELETE /api/organizations/:orgId/badges/:badgeId             → soft-delete custom badge (createChores)
 *   POST   /api/organizations/:orgId/badges/:badgeId/award        → manual award          (createChores)
 *   DELETE /api/organizations/:orgId/badges/:badgeId/award/:mid   → manual revoke         (createChores)
 *   GET    /api/organizations/:orgId/milestones                   → household milestones (context)
 *   GET    /api/organizations/:orgId/members/:memberId/badges     → custom awards + system unlocks + milestones
 */
export const badgeRoutes = new Hono<HouseholdEnv>()

/** The custom-badge criteria the household can author (mirrors custom_badge.criteria_type). */
export const BADGE_CRITERIA_TYPES = [
  'manual',
  'chore_count',
  'category_count',
  'streak',
  'speed_bonus_count',
  'points_total',
] as const
export type BadgeCriteriaType = (typeof BADGE_CRITERIA_TYPES)[number]

/** A code-defined system badge (the definition; the unlock is an achievement_unlock row). */
export type SystemBadge = {
  /** Stable key = achievement_unlock.achievementKey. */
  key: string
  name: string
  description: string
  /** Lucide icon key (never a component here — this module is shared with the Worker). */
  icon: string
  category:
    | 'beginner'
    | 'consistency'
    | 'points'
    | 'skill'
    | 'fairness'
    | 'level'
    | 'social'
  /** The numeric trigger value where one applies (days / count / points / level / weeks). */
  threshold: number | null
}

/**
 * SYSTEM BADGE CATALOG — the source of truth for every code-defined achievement (spec §10a).
 * Keys are stable and match achievement_unlock.achievementKey; thresholds drive the auto-award
 * checks (wired off the completion engine in a follow-up). Grouped by the brief's categories.
 */
export const SYSTEM_BADGE_CATALOG: Record<string, SystemBadge> = {
  // --- Beginner ---
  first_step: { key: 'first_step', name: 'First Step', description: 'Completed your first chore.', icon: 'footprints', category: 'beginner', threshold: 1 },
  getting_started: { key: 'getting_started', name: 'Getting Started', description: 'Completed 10 chores.', icon: 'rocket', category: 'beginner', threshold: 10 },
  snap_happy: { key: 'snap_happy', name: 'Snap Happy', description: 'Submitted your first photo proof.', icon: 'camera', category: 'beginner', threshold: 1 },

  // --- Consistency (streak days) ---
  on_a_roll: { key: 'on_a_roll', name: 'On a Roll', description: 'A 3-day streak.', icon: 'flame', category: 'consistency', threshold: 3 },
  week_warrior: { key: 'week_warrior', name: 'Week Warrior', description: 'A 7-day streak.', icon: 'flame', category: 'consistency', threshold: 7 },
  streak_master: { key: 'streak_master', name: 'Streak Master', description: 'A 30-day streak.', icon: 'flame', category: 'consistency', threshold: 30 },
  iron_will: { key: 'iron_will', name: 'Iron Will', description: 'A 60-day streak.', icon: 'shield', category: 'consistency', threshold: 60 },
  legendary: { key: 'legendary', name: 'Legendary', description: 'A 100-day streak.', icon: 'crown', category: 'consistency', threshold: 100 },

  // --- Points (lifetime points) ---
  century_club: { key: 'century_club', name: 'Century Club', description: 'Earned 100 points.', icon: 'coins', category: 'points', threshold: 100 },
  household_hero: { key: 'household_hero', name: 'Household Hero', description: 'Earned 500 points.', icon: 'medal', category: 'points', threshold: 500 },
  point_machine: { key: 'point_machine', name: 'Point Machine', description: 'Earned 1,000 points.', icon: 'zap', category: 'points', threshold: 1000 },
  the_one_percent: { key: 'the_one_percent', name: 'The 1%', description: 'Earned 5,000 points.', icon: 'gem', category: 'points', threshold: 5000 },

  // --- Skill ---
  early_bird: { key: 'early_bird', name: 'Early Bird', description: 'Completed a chore early in the morning.', icon: 'sunrise', category: 'skill', threshold: null },
  night_owl: { key: 'night_owl', name: 'Night Owl', description: 'Completed a chore late at night.', icon: 'moon', category: 'skill', threshold: null },
  speed_demon: { key: 'speed_demon', name: 'Speed Demon', description: 'Earned a speed bonus.', icon: 'gauge', category: 'skill', threshold: 1 },
  efficiency_expert: { key: 'efficiency_expert', name: 'Efficiency Expert', description: 'Earned 10 speed bonuses.', icon: 'timer', category: 'skill', threshold: 10 },
  lightning_round: { key: 'lightning_round', name: 'Lightning Round', description: 'Earned 25 speed bonuses.', icon: 'zap', category: 'skill', threshold: 25 },
  photographer: { key: 'photographer', name: 'Photographer', description: 'Submitted 25 photo proofs.', icon: 'camera', category: 'skill', threshold: 25 },
  before_after_pro: { key: 'before_after_pro', name: 'Before & After Pro', description: 'Submitted 25 before/after photo sets.', icon: 'images', category: 'skill', threshold: 25 },
  all_rounder: { key: 'all_rounder', name: 'All-Rounder', description: 'Completed a chore in every category.', icon: 'shapes', category: 'skill', threshold: null },
  team_player: { key: 'team_player', name: 'Team Player', description: 'Completed chores across many categories.', icon: 'users', category: 'skill', threshold: null },

  // --- Fairness (weeks at/above a fair share) ---
  fairness_champion: { key: 'fairness_champion', name: 'Fairness Champion', description: 'Pulled your weight for 4 weeks.', icon: 'scale', category: 'fairness', threshold: 4 },
  balance_keeper: { key: 'balance_keeper', name: 'Balance Keeper', description: 'Pulled your weight for 8 weeks.', icon: 'scale', category: 'fairness', threshold: 8 },

  // --- Level ---
  level_5: { key: 'level_5', name: 'Level 5', description: 'Reached level 5.', icon: 'star', category: 'level', threshold: 5 },
  level_10: { key: 'level_10', name: 'Level 10', description: 'Reached level 10.', icon: 'star', category: 'level', threshold: 10 },
  level_25: { key: 'level_25', name: 'Level 25', description: 'Reached level 25.', icon: 'star', category: 'level', threshold: 25 },
  level_50: { key: 'level_50', name: 'Level 50', description: 'Reached level 50.', icon: 'star', category: 'level', threshold: 50 },

  // --- Social ---
  birthday_star: { key: 'birthday_star', name: 'Birthday Star', description: 'Celebrated a birthday in the household.', icon: 'cake', category: 'social', threshold: null },
  generous: { key: 'generous', name: 'Generous', description: 'Gifted points to a housemate.', icon: 'gift', category: 'social', threshold: 1 },
  philanthropist: { key: 'philanthropist', name: 'Philanthropist', description: 'Gifted points 10 times.', icon: 'heart-handshake', category: 'social', threshold: 10 },
  most_loved: { key: 'most_loved', name: 'Most Loved', description: 'Received the most gifts in the household.', icon: 'heart', category: 'social', threshold: null },
  challenge_champion: { key: 'challenge_champion', name: 'Challenge Champion', description: 'Won a household challenge.', icon: 'trophy', category: 'social', threshold: 1 },
}

/** Catalog as an ordered array (the read surface returns this; the map stays the lookup index). */
export const SYSTEM_BADGE_LIST: SystemBadge[] = Object.values(SYSTEM_BADGE_CATALOG)

const badgeCreate = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  icon: z.string().trim().max(40).optional(),
  color: z.string().trim().max(24).optional(),
  criteriaType: z.enum(BADGE_CRITERIA_TYPES),
  criteriaTarget: z.number().int().min(1).max(1_000_000).nullish(),
  criteriaCategoryId: z.string().max(64).nullish(),
})
const badgeUpdate = badgeCreate.partial()

/** Confirm a category belongs to this household (or is cleared). Returns false on a foreign id. */
async function categoryOk(env: HouseholdEnv['Bindings'], orgId: string, categoryId: string | null | undefined) {
  if (!categoryId) return true
  const [cat] = await getDb(env.DATABASE_URL)
    .select({ id: schema.choreCategory.id })
    .from(schema.choreCategory)
    .where(and(eq(schema.choreCategory.id, categoryId), eq(schema.choreCategory.organizationId, orgId)))
    .limit(1)
  return Boolean(cat)
}

/** category_count badges need a category; others must NOT carry one. Mirrors the criteria semantics. */
function criteriaShapeOk(criteriaType: BadgeCriteriaType, target: number | null | undefined, categoryId: string | null | undefined): string | null {
  if (criteriaType === 'manual') return null // a manual badge ignores target + category
  if (criteriaType === 'category_count' && !categoryId) return 'category_count badges require a criteriaCategoryId'
  if (criteriaType !== 'category_count' && categoryId) return 'only category_count badges accept a criteriaCategoryId'
  if (!target || target < 1) return `${criteriaType} badges require a positive criteriaTarget`
  return null
}

// --- Custom badge library ---

badgeRoutes.get('/:orgId/badges', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const custom = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.customBadge)
    .where(and(eq(schema.customBadge.organizationId, orgId), eq(schema.customBadge.isActive, true)))
    .orderBy(desc(schema.customBadge.createdAt))
  return c.json({ custom, system: SYSTEM_BADGE_LIST })
})

badgeRoutes.post('/:orgId/badges', requireOrg, requirePermission('createChores'), async (c) => {
  const { orgId, memberId } = c.get('household')
  const parsed = badgeCreate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data

  const shapeErr = criteriaShapeOk(d.criteriaType, d.criteriaTarget, d.criteriaCategoryId)
  if (shapeErr) return c.json({ error: shapeErr }, 400)
  if (!(await categoryOk(c.env, orgId, d.criteriaCategoryId))) return c.json({ error: 'invalid category' }, 400)

  const isManual = d.criteriaType === 'manual'
  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.customBadge)
    .values({
      organizationId: orgId,
      name: d.name,
      description: d.description,
      icon: d.icon ?? 'award',
      color: d.color ?? 'amber',
      criteriaType: d.criteriaType,
      criteriaTarget: isManual ? null : d.criteriaTarget ?? null,
      criteriaCategoryId: d.criteriaType === 'category_count' ? d.criteriaCategoryId ?? null : null,
      createdByMemberId: memberId,
    })
    .returning()
  await audit(c, { entityType: 'custom_badge', entityId: row.id, action: 'badge.created', metadata: { name: row.name, criteriaType: row.criteriaType } })
  return c.json(row, 201)
})

badgeRoutes.patch('/:orgId/badges/:badgeId', requireOrg, requirePermission('createChores'), async (c) => {
  const { orgId } = c.get('household')
  const badgeId = c.req.param('badgeId')
  const parsed = badgeUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data
  if (!(await categoryOk(c.env, orgId, d.criteriaCategoryId))) return c.json({ error: 'invalid category' }, 400)

  // Build the update from only the keys the client actually sent (PATCH semantics).
  const updates: Partial<typeof schema.customBadge.$inferInsert> = {}
  if (d.name !== undefined) updates.name = d.name
  if (d.description !== undefined) updates.description = d.description
  if (d.icon !== undefined) updates.icon = d.icon
  if (d.color !== undefined) updates.color = d.color
  if (d.criteriaType !== undefined) updates.criteriaType = d.criteriaType
  if (d.criteriaTarget !== undefined) updates.criteriaTarget = d.criteriaTarget ?? null
  if (d.criteriaCategoryId !== undefined) updates.criteriaCategoryId = d.criteriaCategoryId ?? null
  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.customBadge)
    .set(updates)
    .where(and(eq(schema.customBadge.id, badgeId), eq(schema.customBadge.organizationId, orgId), eq(schema.customBadge.isActive, true)))
    .returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'custom_badge', entityId: row.id, action: 'badge.updated' })
  return c.json(row)
})

badgeRoutes.delete('/:orgId/badges/:badgeId', requireOrg, requirePermission('createChores'), async (c) => {
  const { orgId } = c.get('household')
  const badgeId = c.req.param('badgeId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.customBadge)
    .set({ isActive: false })
    .where(and(eq(schema.customBadge.id, badgeId), eq(schema.customBadge.organizationId, orgId), eq(schema.customBadge.isActive, true)))
    .returning({ id: schema.customBadge.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'custom_badge', entityId: badgeId, action: 'badge.deleted' })
  return c.json({ ok: true })
})

// --- Manual award / revoke (custom_badge_award; unique per badge+member) ---

const awardInput = z.object({ memberId: z.string().min(1).max(64) })

badgeRoutes.post('/:orgId/badges/:badgeId/award', requireOrg, requirePermission('createChores'), async (c) => {
  const { orgId, memberId: awarderMemberId } = c.get('household')
  const badgeId = c.req.param('badgeId')
  const db = getDb(c.env.DATABASE_URL)

  const parsed = awardInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const targetMemberId = parsed.data.memberId

  // The badge must be a live one in THIS household.
  const [badge] = await db
    .select({ id: schema.customBadge.id })
    .from(schema.customBadge)
    .where(and(eq(schema.customBadge.id, badgeId), eq(schema.customBadge.organizationId, orgId), eq(schema.customBadge.isActive, true)))
    .limit(1)
  if (!badge) return c.json({ error: 'badge not found' }, 404)

  // The recipient must be a member of THIS household.
  const [target] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.id, targetMemberId), eq(schema.member.organizationId, orgId)))
    .limit(1)
  if (!target) return c.json({ error: 'member not found' }, 404)

  // Idempotent on the unique (badge, member): re-awarding is a no-op, not a 500.
  const [row] = await db
    .insert(schema.customBadgeAward)
    .values({
      organizationId: orgId,
      badgeId,
      memberId: targetMemberId,
      awardedByMemberId: awarderMemberId,
    })
    .onConflictDoNothing({ target: [schema.customBadgeAward.badgeId, schema.customBadgeAward.memberId] })
    .returning()
  if (!row) return c.json({ ok: true, alreadyAwarded: true })
  await audit(c, { entityType: 'custom_badge_award', entityId: row.id, action: 'badge.awarded', metadata: { badgeId, memberId: targetMemberId } })
  return c.json(row, 201)
})

badgeRoutes.delete('/:orgId/badges/:badgeId/award/:memberId', requireOrg, requirePermission('createChores'), async (c) => {
  const { orgId } = c.get('household')
  const badgeId = c.req.param('badgeId')
  const targetMemberId = c.req.param('memberId')
  const [row] = await getDb(c.env.DATABASE_URL)
    .delete(schema.customBadgeAward)
    .where(
      and(
        eq(schema.customBadgeAward.organizationId, orgId),
        eq(schema.customBadgeAward.badgeId, badgeId),
        eq(schema.customBadgeAward.memberId, targetMemberId),
      ),
    )
    .returning({ id: schema.customBadgeAward.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'custom_badge_award', entityId: row.id, action: 'badge.revoked', metadata: { badgeId, memberId: targetMemberId } })
  return c.json({ ok: true })
})

// --- Household milestones (read-only context) ---

badgeRoutes.get('/:orgId/milestones', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.householdMilestone)
    .where(eq(schema.householdMilestone.organizationId, orgId))
    .orderBy(desc(schema.householdMilestone.earnedAt))
  return c.json(rows)
})

// --- One member's trophy case: custom awards + system unlocks + household milestone context ---

badgeRoutes.get('/:orgId/members/:memberId/badges', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const memberId = c.req.param('memberId')
  const db = getDb(c.env.DATABASE_URL)

  // The member must belong to this household — and we need its userId to read achievement_unlock
  // (system unlocks are keyed by user, custom awards by member).
  const [member] = await db
    .select({
      id: schema.member.id,
      userId: schema.member.userId,
      displayName: schema.member.displayName,
      avatarUrl: schema.member.avatarUrl,
      favoriteColor: schema.member.favoriteColor,
    })
    .from(schema.member)
    .where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, orgId)))
    .limit(1)
  if (!member) return c.json({ error: 'member not found' }, 404)

  // Custom awards (joined to the live badge definition for name/icon/color).
  const customAwards = await db
    .select({
      awardId: schema.customBadgeAward.id,
      badgeId: schema.customBadge.id,
      name: schema.customBadge.name,
      description: schema.customBadge.description,
      icon: schema.customBadge.icon,
      color: schema.customBadge.color,
      criteriaType: schema.customBadge.criteriaType,
      awardedAt: schema.customBadgeAward.awardedAt,
      awardedByMemberId: schema.customBadgeAward.awardedByMemberId,
    })
    .from(schema.customBadgeAward)
    .innerJoin(schema.customBadge, eq(schema.customBadge.id, schema.customBadgeAward.badgeId))
    .where(
      and(
        eq(schema.customBadgeAward.organizationId, orgId),
        eq(schema.customBadgeAward.memberId, memberId),
        eq(schema.customBadge.isActive, true),
      ),
    )
    .orderBy(desc(schema.customBadgeAward.awardedAt))

  // System unlocks (achievement_unlock rows, keyed by userId) hydrated against the catalog.
  const unlockRows = await db
    .select({
      achievementKey: schema.achievementUnlock.achievementKey,
      unlockedAt: schema.achievementUnlock.createdAt,
      metadata: schema.achievementUnlock.metadata,
    })
    .from(schema.achievementUnlock)
    .where(and(eq(schema.achievementUnlock.organizationId, orgId), eq(schema.achievementUnlock.userId, member.userId)))
    .orderBy(desc(schema.achievementUnlock.createdAt))

  const unlockedKeys = new Set(unlockRows.map((u) => u.achievementKey))
  const unlockedAtByKey = new Map(unlockRows.map((u) => [u.achievementKey, u.unlockedAt]))

  // Every catalog badge with earned/unearned state (the trophy-case grid renders earned-glow /
  // unearned-gray straight off this).
  const systemBadges = SYSTEM_BADGE_LIST.map((b) => ({
    ...b,
    earned: unlockedKeys.has(b.key),
    unlockedAt: unlockedAtByKey.get(b.key) ?? null,
  }))

  // Household milestone context (shared by the whole household; surfaced on the profile too).
  const milestones = await db
    .select()
    .from(schema.householdMilestone)
    .where(eq(schema.householdMilestone.organizationId, orgId))
    .orderBy(desc(schema.householdMilestone.earnedAt))

  return c.json({
    member: {
      memberId: member.id,
      userId: member.userId,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl,
      favoriteColor: member.favoriteColor,
    },
    customAwards,
    systemBadges,
    milestones,
  })
})
