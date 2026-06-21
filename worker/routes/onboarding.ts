import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireSession, type AuthEnv } from '../middleware/org'
import { roleForJoin, type HouseholdMode } from '@/lib/config/modes'

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
    .select({ name: schema.organization.name, mode: schema.organization.mode })
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
    .select({ id: schema.organization.id, mode: schema.organization.mode })
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

  await db.insert(schema.member).values({
    id: crypto.randomUUID(),
    organizationId: org.id,
    userId: session.user.id,
    role: 'member',
    householdRole: roleForJoin(org.mode as HouseholdMode, false),
    displayName: session.user.name,
  })
  return c.json({ orgId: org.id })
})
