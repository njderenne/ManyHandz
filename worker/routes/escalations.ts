import { Hono } from 'hono'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'
import { resolveEscalation, snoozeEscalation } from '../lib/escalation'

/**
 * Escalations — the org-scoped REFERENCE surface over the safety ladder (worker/lib/escalation.ts).
 * The ENGINE runs in cron; these routes let members SEE open ladders and act on them:
 *
 *   GET  /api/organizations/:orgId/escalations?includeResolved=   → ladders, newest slot first
 *   POST /api/organizations/:orgId/escalations/:id/resolve        → { resolution: 'confirmed'|'dismissed' }
 *   POST /api/organizations/:orgId/escalations/:id/snooze         → { minutes: 1..1440 }
 *
 * requireOrg on every endpoint (any live member may confirm/dismiss — RxMndr's model: whoever
 * notices handles it; escalations are a shared-safety surface, not a privileged one), and every
 * query scopes by organizationId. Mutations audit(). Resolution vocab here is deliberately only
 * the HUMAN verbs — 'missed'/'auto' are engine-reserved and rejected from the API.
 *
 * Mounted by worker/index.ts ONLY when APP_CONFIG.features.escalations (stage-0 wiring); the
 * internal guard below is defense-in-depth so a stray mount can never expose the surface.
 */
export const escalationRoutes = new Hono<AuthEnv>()

/** Feature-off ⇒ 404 (not 403): the surface should not exist, and its absence isn't an oracle. */
escalationRoutes.use('*', async (c, next) => {
  if (!APP_CONFIG.features.escalations) return c.json({ error: 'not found' }, 404)
  return next()
})

/** Human resolutions only — the engine owns 'missed' (terminal stage) and 'auto' (domain hooks). */
const API_RESOLUTIONS = ['confirmed', 'dismissed'] as const
type ApiResolution = (typeof API_RESOLUTIONS)[number]

/** Snooze ceiling — a safety ladder can be paused for at most a day per snooze (module doctrine:
 *  snooze pauses advancement, it never silences the ladder indefinitely). */
const MAX_SNOOZE_MINUTES = 1440

/** Bounded list read — escalations are an attention surface, not an archive browser. */
const LIST_LIMIT = 200

escalationRoutes.get('/:orgId/escalations', requireOrg, async (c) => {
  const orgId = c.get('orgId')

  // Default: only OPEN ladders (the actionable set). ?includeResolved=true widens to history.
  const includeResolved = ['true', '1'].includes((c.req.query('includeResolved') ?? '').toLowerCase())

  const scope = includeResolved
    ? eq(schema.escalation.organizationId, orgId)
    : and(eq(schema.escalation.organizationId, orgId), isNull(schema.escalation.resolvedAt))

  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.escalation)
    .where(scope)
    // Newest slot first — the most recently due thing is the most actionable. id desc as the
    // tiebreaker keeps the order stable when scheduledFor collides (same-times slots).
    .orderBy(desc(schema.escalation.scheduledFor), desc(schema.escalation.id))
    .limit(LIST_LIMIT)
  return c.json(rows)
})

escalationRoutes.post('/:orgId/escalations/:id/resolve', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')

  const body = await c.req.json<{ resolution?: unknown }>().catch(() => null)
  if (!body) return c.json({ error: 'a JSON object body is required' }, 400)
  if (typeof body.resolution !== 'string' || !API_RESOLUTIONS.includes(body.resolution as ApiResolution)) {
    return c.json({ error: `resolution must be one of: ${API_RESOLUTIONS.join(', ')}` }, 400)
  }
  const resolution = body.resolution as ApiResolution

  // Org-scoped on the WRITE (the lib verb re-checks orgId) — 404 covers unknown id, another
  // org's row, and already-resolved alike, so the response never leaks which it was.
  const resolved = await resolveEscalation(getDb(c.env.DATABASE_URL), orgId, id, resolution)
  if (!resolved) return c.json({ error: 'escalation not found or already resolved' }, 404)

  await audit(c, {
    entityType: 'escalation',
    entityId: id,
    action: 'escalation.resolve',
    metadata: { resolution },
  })
  return c.json(resolved)
})

escalationRoutes.post('/:orgId/escalations/:id/snooze', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')

  const body = await c.req.json<{ minutes?: unknown }>().catch(() => null)
  if (!body) return c.json({ error: 'a JSON object body is required' }, 400)
  const minutes = body.minutes
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SNOOZE_MINUTES) {
    return c.json({ error: `minutes must be an integer between 1 and ${MAX_SNOOZE_MINUTES}` }, 400)
  }

  const until = new Date(Date.now() + minutes * 60_000)
  const snoozed = await snoozeEscalation(getDb(c.env.DATABASE_URL), orgId, id, until)
  if (!snoozed) return c.json({ error: 'escalation not found or already resolved' }, 404)

  await audit(c, {
    entityType: 'escalation',
    entityId: id,
    action: 'escalation.snooze',
    metadata: { minutes, until: until.toISOString() },
  })
  return c.json(snoozed)
})
