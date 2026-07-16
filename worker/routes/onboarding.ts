import { Hono } from 'hono'
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireSession, type AuthEnv } from '../middleware/org'
import { requireTier } from '../entitlements'
import { roleForJoin } from '@/lib/config/roles'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Onboarding — join an existing household by its invite code. Mounted at /api/households.
 * (Creating a household goes through Better-Auth `organization.create` then POST
 * /organizations/:orgId/household/setup; this is the JOIN side.) Case-insensitive code match — the
 * old app's join always failed because it uppercased the query but stored lowercase.
 *
 *   POST /api/households/join  { inviteCode }  → { orgId }  (client then setActive)
 *   GET  /api/households/lookup?code=XXXX      → { name, mode }  (preview before joining)
 */
export const onboardingRoutes = new Hono<AuthEnv>()

const normalizeCode = (raw: string) => raw.toUpperCase().replace(/\s/g, '')

onboardingRoutes.get('/lookup', requireSession, async (c) => {
  const code = normalizeCode(c.req.query('code') ?? '')
  if (code.length < 4) return c.json({ error: 'invalid code' }, 400)
  const [org] = await getDb(c.env.DATABASE_URL)
    // JSON key stays `mode` (OTA-client contract); organization.kind is the storage truth (§10.3).
    .select({ name: schema.organization.name, mode: schema.organization.kind })
    .from(schema.organization)
    .where(eq(schema.organization.inviteCode, code))
    .limit(1)
  if (!org) return c.json({ error: 'no household found for that code' }, 404)
  return c.json(org)
})

onboardingRoutes.post('/join', requireSession, async (c) => {
  const session = c.get('session')
  const parsed = z.object({ inviteCode: z.string().trim().min(4).max(16) }).safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid code' }, 400)
  const code = normalizeCode(parsed.data.inviteCode)
  const db = getDb(c.env.DATABASE_URL)

  const [org] = await db
    .select({ id: schema.organization.id, kind: schema.organization.kind })
    .from(schema.organization)
    .where(eq(schema.organization.inviteCode, code))
    .limit(1)
  if (!org) return c.json({ error: 'no household found for that code' }, 404)

  const [existing] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, org.id), eq(schema.member.userId, session.user.id)))
    .limit(1)
  if (existing) return c.json({ orgId: org.id, alreadyMember: true })

  // Free-tier member cap: a FREE household grows to APP_CONFIG.monetization.limits.members; past
  // that the organizer must be on Premium. requireTier lets trialing/grace orgs through, so we only
  // count + block when the household isn't entitled. (Re-joins above short-circuit before this.)
  const memberCap = APP_CONFIG.monetization.limits.members
  const gate = await requireTier(db, org.id, 'STANDARD')
  if (!gate.ok) {
    const [{ value: memberCount }] = await db
      .select({ value: count() })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, org.id), eq(schema.member.isActive, true)))
    if (memberCount >= memberCap) {
      return c.json(
        {
          error: `This household is full (${memberCap} members on the free plan). The organizer can upgrade to Premium to add more.`,
          reason: gate.reason,
        },
        402,
      )
    }
  }

  await db.insert(schema.member).values({
    id: crypto.randomUUID(),
    organizationId: org.id,
    userId: session.user.id,
    // §10.3 cutover complete: member.role carries the household vocabulary (SPINE §4.2 join rule).
    role: roleForJoin(org.kind, false),
    displayName: session.user.name,
  })
  return c.json({ orgId: org.id })
})
