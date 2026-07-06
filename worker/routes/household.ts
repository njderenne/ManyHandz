import { Hono } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'
import { householdContext } from '../lib/household-context'
import { can, getModeConfig, roleForJoin, HOUSEHOLD_ROLES, type HouseholdMode } from '@/lib/config/modes'
import { levelForXp, titleForLevel } from '@/lib/manyhandz/levels'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Household + members — the foundational ManyHandz resource. `GET /household` returns the household
 * config + the caller's role (what `useHouseholdMode()` keys off); `GET /members` returns every
 * member with their DERIVED points/XP/level/streak (summed from the credit ledger + streak table —
 * never stored columns). Settings + member writes are mode-permission-gated.
 *
 *   GET   /api/organizations/:orgId/household              → config + me
 *   PATCH /api/organizations/:orgId/household              → settings (editHouseholdSettings)
 *   GET   /api/organizations/:orgId/members               → members + derived stats
 *   PATCH /api/organizations/:orgId/members/:memberId     → self profile, or admin role/allowance
 */
export const householdRoutes = new Hono<AuthEnv>()

/** creditLedger.kind for chore points (balance) / XP (sum of positive deltas). */
export const POINTS_KIND = 'points'
/** streak.kind for the chore-completion daily streak. */
export const CHORE_STREAK_KIND = 'chore'

/** The 8 starter categories seeded into every new household (icons are lucide keys; colors are
 *  accent-palette keys the client maps — never hexes). */
const DEFAULT_CATEGORIES: { name: string; icon: string; color: string }[] = [
  { name: 'Kitchen', icon: 'utensils', color: 'amber' },
  { name: 'Bathroom', icon: 'bath', color: 'blue' },
  { name: 'Living Areas', icon: 'sofa', color: 'violet' },
  { name: 'Bedroom', icon: 'bed-double', color: 'pink' },
  { name: 'Outdoor', icon: 'trees', color: 'emerald' },
  { name: 'Laundry', icon: 'shirt', color: 'cyan' },
  { name: 'Pets', icon: 'dog', color: 'orange' },
  { name: 'General', icon: 'home', color: 'slate' },
]

/** 8-char uppercase join code (stored + matched uppercase — the old app's case-mismatch bug). */
function newInviteCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
}

householdRoutes.get('/:orgId/household', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const [org] = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, ctx.orgId))
    .limit(1)
  if (!org) return c.json({ error: 'not found' }, 404)
  return c.json({
    household: {
      id: org.id,
      name: org.name,
      mode: org.mode,
      timezone: org.timezone,
      inviteCode: org.inviteCode,
      requirePhotoProof: org.requirePhotoProof,
      requireApproval: org.requireApproval,
      leaderboardVisible: org.leaderboardVisible,
      allowKidGifting: org.allowKidGifting,
      allowKidChallenges: org.allowKidChallenges,
      allowKidCompetitions: org.allowKidCompetitions,
      maxKidCompetitionStakes: org.maxKidCompetitionStakes,
      aiVerificationEnabled: org.aiVerificationEnabled,
      aiVerificationProvider: org.aiVerificationProvider,
      aiAutoApproveThreshold: org.aiAutoApproveThreshold,
      aiAutoRejectThreshold: org.aiAutoRejectThreshold,
      aiMonthlyCostCapCents: org.aiMonthlyCostCapCents,
      healthScore: org.healthScore,
      subscriptionTier: org.subscriptionTier,
      subscriptionStatus: org.subscriptionStatus,
      trialEndsAt: org.trialEndsAt,
    },
    me: { memberId: ctx.memberId, householdRole: ctx.householdRole, userId: c.get('session').user.id },
  })
})

const householdSettings = z
  .object({
    name: z.string().trim().min(1).max(80),
    timezone: z.string().max(64),
    requirePhotoProof: z.boolean(),
    requireApproval: z.boolean(),
    leaderboardVisible: z.boolean(),
    allowKidGifting: z.boolean(),
    allowKidChallenges: z.boolean(),
    allowKidCompetitions: z.boolean(),
    maxKidCompetitionStakes: z.number().int().min(0).max(100000),
    aiVerificationEnabled: z.boolean(),
    aiVerificationProvider: z.enum(['openai', 'anthropic']),
    aiAutoApproveThreshold: z.number().int().min(0).max(100),
    aiAutoRejectThreshold: z.number().int().min(0).max(100),
    aiMonthlyCostCapCents: z.number().int().min(0).max(1000000),
  })
  .partial()

householdRoutes.patch('/:orgId/household', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx || !can(ctx.mode, ctx.householdRole, 'org:settings')) {
    return c.json({ error: 'forbidden' }, 403)
  }
  const parsed = householdSettings.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  if (Object.keys(parsed.data).length === 0) return c.json({ error: 'no fields to update' }, 400)
  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.organization)
    .set(parsed.data)
    .where(eq(schema.organization.id, ctx.orgId))
    .returning({ id: schema.organization.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'household', entityId: ctx.orgId, action: 'household.settings_updated' })
  return c.json({ ok: true })
})

householdRoutes.get('/:orgId/members', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)

  const rows = await db
    .select({
      memberId: schema.member.id,
      userId: schema.member.userId,
      orgRole: schema.member.role,
      householdRole: schema.member.householdRole,
      displayName: schema.member.displayName,
      avatarUrl: schema.member.avatarUrl,
      favoriteColor: schema.member.favoriteColor,
      bio: schema.member.bio,
      birthday: schema.member.birthday,
      isActive: schema.member.isActive,
      awayUntil: schema.member.awayUntil,
      awayReason: schema.member.awayReason,
      allowanceEnabled: schema.member.allowanceEnabled,
      userName: schema.user.name,
      userImage: schema.user.image,
    })
    .from(schema.member)
    .leftJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, orgId))

  // Derived points (balance + lifetime XP) and streak, summed per user. Postgres SUM returns a
  // string over the HTTP driver — Number() normalizes.
  const ledger = await db
    .select({
      userId: schema.creditLedger.userId,
      balance: sql<string>`coalesce(sum(${schema.creditLedger.delta}), 0)`,
      xp: sql<string>`coalesce(sum(case when ${schema.creditLedger.delta} > 0 then ${schema.creditLedger.delta} else 0 end), 0)`,
    })
    .from(schema.creditLedger)
    .where(and(eq(schema.creditLedger.organizationId, orgId), eq(schema.creditLedger.kind, POINTS_KIND)))
    .groupBy(schema.creditLedger.userId)

  const streaks = await db
    .select({
      userId: schema.streak.userId,
      current: schema.streak.currentCount,
      longest: schema.streak.longestCount,
    })
    .from(schema.streak)
    .where(and(eq(schema.streak.organizationId, orgId), eq(schema.streak.kind, CHORE_STREAK_KIND)))

  const byUserLedger = new Map(ledger.map((l) => [l.userId, l]))
  const byUserStreak = new Map(streaks.map((s) => [s.userId, s]))

  const members = rows.map((r) => {
    const l = r.userId ? byUserLedger.get(r.userId) : undefined
    const s = r.userId ? byUserStreak.get(r.userId) : undefined
    const totalXp = Number(l?.xp ?? 0)
    const level = levelForXp(totalXp)
    return {
      memberId: r.memberId,
      userId: r.userId,
      orgRole: r.orgRole,
      householdRole: r.householdRole,
      displayName: r.displayName ?? r.userName ?? 'Member',
      avatarUrl: r.avatarUrl ?? r.userImage ?? null,
      favoriteColor: r.favoriteColor,
      bio: r.bio,
      birthday: r.birthday,
      isActive: r.isActive,
      awayUntil: r.awayUntil,
      awayReason: r.awayReason,
      allowanceEnabled: r.allowanceEnabled,
      pointsBalance: Number(l?.balance ?? 0),
      totalXp,
      level,
      title: titleForLevel(level),
      currentStreak: s?.current ?? 0,
      longestStreak: s?.longest ?? 0,
    }
  })
  return c.json(members)
})

const memberUpdate = z
  .object({
    // self-editable profile fields
    displayName: z.string().trim().min(1).max(60),
    avatarUrl: z.string().max(500).nullable(),
    bio: z.string().trim().max(200).nullable(),
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    favoriteColor: z.string().max(24),
    awayUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    awayReason: z.string().trim().max(200).nullable(),
    muteCelebrations: z.boolean(),
    // admin-only fields (changeRoles)
    householdRole: z.enum(HOUSEHOLD_ROLES),
    isActive: z.boolean(),
    allowanceEnabled: z.boolean(),
    allowancePayoutType: z.enum(['money', 'treat', 'gift', 'privilege', 'experience', 'custom']),
    allowanceAmountCents: z.number().int().min(0).max(1000000),
    allowanceRewardDescription: z.string().trim().max(200).nullable(),
    allowanceThresholdPct: z.number().int().min(0).max(100),
  })
  .partial()

const SELF_FIELDS = ['displayName', 'avatarUrl', 'bio', 'birthday', 'favoriteColor', 'awayUntil', 'awayReason', 'muteCelebrations'] as const
const ADMIN_FIELDS = ['householdRole', 'isActive', 'allowanceEnabled', 'allowancePayoutType', 'allowanceAmountCents', 'allowanceRewardDescription', 'allowanceThresholdPct'] as const

householdRoutes.patch('/:orgId/members/:memberId', requireOrg, async (c) => {
  const ctx = await householdContext(c)
  if (!ctx) return c.json({ error: 'forbidden' }, 403)
  const targetId = c.req.param('memberId')
  const isSelf = targetId === ctx.memberId
  const canManage = can(ctx.mode, ctx.householdRole, 'member:set_role')
  if (!isSelf && !canManage) return c.json({ error: 'forbidden' }, 403)

  const parsed = memberUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const d = parsed.data as Record<string, unknown>

  // A new household role must be valid for this mode (no 'kid' in a roommate household).
  if (d.householdRole !== undefined && !getModeConfig(ctx.mode as HouseholdMode).roles.includes(d.householdRole as never)) {
    return c.json({ error: `invalid role for ${ctx.mode} mode` }, 400)
  }

  const updates: Record<string, unknown> = {}
  if (isSelf) for (const k of SELF_FIELDS) if (d[k] !== undefined) updates[k] = d[k]
  if (canManage) for (const k of ADMIN_FIELDS) if (d[k] !== undefined) updates[k] = d[k]
  if (Object.keys(updates).length === 0) return c.json({ error: 'no permitted fields to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.member)
    .set(updates)
    .where(and(eq(schema.member.id, targetId), eq(schema.member.organizationId, ctx.orgId)))
    .returning({ id: schema.member.id })
  if (!row) return c.json({ error: 'not found' }, 404)
  await audit(c, { entityType: 'member', entityId: targetId, action: isSelf ? 'member.profile_updated' : 'member.managed' })
  return c.json({ ok: true })
})

/**
 * Household SETUP — runs once right after authClient.organization.create + setActive, by the owner.
 * Sets the mode (which drives everything), mints the join code, starts the 14-day trial, sets the
 * creator's household role, and seeds the 8 starter categories. Idempotent on inviteCode.
 */
const setupInput = z.object({ mode: z.enum(['family', 'roommate']), timezone: z.string().max(64).optional() })

householdRoutes.post('/:orgId/household/setup', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)

  const [m] = await db
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, session.user.id)))
    .limit(1)
  if (!m || m.role !== 'owner') return c.json({ error: 'forbidden — only the creator sets up the household' }, 403)

  const [org] = await db
    .select({ inviteCode: schema.organization.inviteCode })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)
  if (org?.inviteCode) return c.json({ error: 'already set up', inviteCode: org.inviteCode }, 409)

  const parsed = setupInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const mode = parsed.data.mode as HouseholdMode
  const code = newInviteCode()
  // Trial length comes from config (BILLING §6.1) — 0 disables the setup-time stamp entirely.
  const trialDays = APP_CONFIG.subscription.trialDays
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)

  await db
    .update(schema.organization)
    .set({
      mode,
      // SPINE §10.3: organization.kind IS the mode — dual-written until release N+1 drops mode.
      kind: mode,
      inviteCode: code,
      timezone: parsed.data.timezone ?? 'America/New_York',
      ...(trialDays > 0 ? { subscriptionStatus: 'trialing' as const, trialEndsAt } : {}),
    })
    .where(eq(schema.organization.id, orgId))
  await db.update(schema.member).set({ householdRole: roleForJoin(mode, true) }).where(eq(schema.member.id, m.id))
  await db.insert(schema.choreCategory).values(
    DEFAULT_CATEGORIES.map((cat, i) => ({
      organizationId: orgId,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      isDefault: true,
      displayOrder: i,
    })),
  )
  await audit(c, { entityType: 'household', entityId: orgId, action: 'household.created', metadata: { mode } })
  return c.json({ ok: true, inviteCode: code, mode })
})
