import { Hono, type Context } from 'hono'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb, schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { requireOrg, audit, type AuthEnv } from '../middleware/org'
import { PROMPT_CATALOG, catalogKeys, selectPrompts } from '../engines/nudge'

/**
 * Prompts — the org-scoped serving surface over the prompt/nudge engine
 * (worker/engines/nudge.ts; rotation state in `prompt_state`). requireOrg on every endpoint;
 * every query scopes by organizationId. A track is (org) or (org, subject) — subjectId
 * identifies which; the partial unique indexes on prompt_state enforce one row per track.
 *
 *   GET   /api/organizations/:orgId/prompts/next?subjectId=      → serve the next prompt
 *   GET   /api/organizations/:orgId/prompts/settings?subjectId=  → the track's cadence/packs
 *   POST  /api/organizations/:orgId/prompts/skip                 → { promptKey, subjectId? }
 *   PATCH /api/organizations/:orgId/prompts/settings             → { cadence?, packKeys?, subjectId? }
 *
 * SERVING MARKS SERVED — ADVANCE-BEFORE-RETURN: GET /next appends the prompt's key to
 * servedPromptKeys and stamps lastServedAt BEFORE the response leaves, so a prompt is offered
 * exactly once, ever (content rule 1 in the engine header: non-repeating is the category's
 * verified hate cluster). The client holds the served prompt (useNextPrompt caches it with
 * staleTime Infinity) — a refetch deliberately serves the NEXT one.
 *
 * POST /skip exists for the prompt a user saw WITHOUT /next marking it: the cron nudge previews
 * a prompt in the push (engine: the nudged prompt is NOT marked served) — skipping it from the
 * notification marks that key served. Skip = served, free and final; idempotent.
 *
 * Mounted by worker/index.ts ONLY when APP_CONFIG.features.prompts (stage-0 wiring); the
 * internal guard below is defense-in-depth so a stray mount can never expose the surface.
 */
export const promptRoutes = new Hono<AuthEnv>()

/** Feature-off ⇒ 404 (not 403): the surface should not exist, and its absence isn't an oracle. */
promptRoutes.use('*', async (c, next) => {
  if (!APP_CONFIG.features.prompts) return c.json({ error: 'not found' }, 404)
  return next()
})

const CADENCES = ['daily', 'weekly', 'off'] as const

/** id-shaped params land in eq() — cap + charset-guard them like any client input. */
const ID_MAX_LENGTH = 64
const ID_PATTERN = /^[a-zA-Z0-9._-]+$/

function parseId(raw: unknown): string | null | 'invalid' {
  if (raw === undefined || raw === null) return null // absent = the org-level track
  if (typeof raw !== 'string') return 'invalid'
  const id = raw.trim()
  if (!id) return null
  if (id.length > ID_MAX_LENGTH || !ID_PATTERN.test(id)) return 'invalid'
  return id
}

/** A subject track must point at a LIVE org-scoped subject (archived subjects' schedules stop). */
async function resolveSubjectId(
  db: DB,
  orgId: string,
  subjectId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.subject.id })
    .from(schema.subject)
    .where(
      and(
        eq(schema.subject.organizationId, orgId),
        eq(schema.subject.id, subjectId),
        isNull(schema.subject.archivedAt),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/** WHERE for one track — the org fence plus the null-vs-eq subject split. */
function trackWhere(orgId: string, subjectId: string | null) {
  return and(
    eq(schema.promptState.organizationId, orgId),
    subjectId === null
      ? isNull(schema.promptState.subjectId)
      : eq(schema.promptState.subjectId, subjectId),
  )
}

/** Defaults mirror the prompt_state column defaults — a track that has never been written. */
const DEFAULT_STATE = { cadence: 'weekly', packKeys: ['core'], servedPromptKeys: [] as string[] }

/**
 * Atomically append ONE served key to a track's servedPromptKeys (jsonb `||`), guarded by `@>` so
 * a replay is a no-op. NEVER a read-modify-write overwrite from a snapshot: two devices racing
 * /next against /skip on the same track would lose each other's keys — and a lost served key
 * RESURRECTS a prompt later, which is content rule 1's verified hate cluster (nudge.ts header),
 * not just a data race. `extra` rides along only when the append actually lands (lastServedAt
 * belongs to the write that served).
 */
async function appendServedKey(
  db: DB,
  orgId: string,
  stateId: string,
  promptKey: string,
  extra: { lastServedAt?: Date } = {},
): Promise<void> {
  const keyJson = JSON.stringify([promptKey])
  await db
    .update(schema.promptState)
    .set({
      servedPromptKeys: sql`${schema.promptState.servedPromptKeys} || ${keyJson}::jsonb`,
      ...extra,
    })
    .where(
      and(
        eq(schema.promptState.id, stateId),
        eq(schema.promptState.organizationId, orgId),
        sql`not (${schema.promptState.servedPromptKeys} @> ${keyJson}::jsonb)`,
      ),
    )
}

type PromptStateRow = typeof schema.promptState.$inferSelect

/**
 * The track's state row, creating it lazily on first touch. The insert races safely: the
 * partial unique indexes absorb a concurrent create (onConflictDoNothing) and the re-select
 * returns whichever row won.
 */
async function getOrCreateState(
  db: DB,
  orgId: string,
  subjectId: string | null,
): Promise<PromptStateRow> {
  const [existing] = await db
    .select()
    .from(schema.promptState)
    .where(trackWhere(orgId, subjectId))
    .limit(1)
  if (existing) return existing

  const [created] = await db
    .insert(schema.promptState)
    .values({ organizationId: orgId, subjectId })
    .onConflictDoNothing()
    .returning()
  if (created) return created

  const [raced] = await db
    .select()
    .from(schema.promptState)
    .where(trackWhere(orgId, subjectId))
    .limit(1)
  if (!raced) throw new Error('prompt_state upsert returned no row')
  return raced
}

/** Shared param handling: parse + validate the subjectId, 400/404ing through the response. */
async function trackFromRequest(
  c: Context<AuthEnv>,
  db: DB,
  raw: unknown,
): Promise<{ ok: true; subjectId: string | null } | { ok: false; res: Response }> {
  const orgId = c.get('orgId')
  const subjectId = parseId(raw)
  if (subjectId === 'invalid') {
    return { ok: false, res: c.json({ error: 'invalid subjectId' }, 400) }
  }
  if (subjectId !== null && !(await resolveSubjectId(db, orgId, subjectId))) {
    return { ok: false, res: c.json({ error: 'subject not found' }, 404) }
  }
  return { ok: true, subjectId }
}

/**
 * GET /:orgId/prompts/next?subjectId= — serve the track's next prompt and mark it served
 * (advance-before-return, header). `remaining` counts what's still unserved AFTER this one, so
 * the client can render "2 more waiting" or hide the affordance at zero. Exhausted catalog ⇒
 * `{ prompt: null, remaining: 0 }` — a 200, not a 404: "nothing to offer" is a normal state.
 */
promptRoutes.get('/:orgId/prompts/next', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)

  const track = await trackFromRequest(c, db, c.req.query('subjectId'))
  if (!track.ok) return track.res

  const state = await getOrCreateState(db, orgId, track.subjectId)
  const eligible = selectPrompts(state, PROMPT_CATALOG, Number.MAX_SAFE_INTEGER)
  const prompt = eligible[0]
  if (!prompt) return c.json({ prompt: null, remaining: 0 })

  // ADVANCE BEFORE RETURN — the served key lands before the client ever sees the prompt, so a
  // crash/retry between write and response under-serves (skips one), never repeats (rule 1's
  // failure mode ranking: a lost prompt is a shrug; a recycled one is the hate cluster). The
  // append is ATOMIC in SQL (see appendServedKey) so a concurrent /skip or /next on another
  // device can never overwrite this key away.
  await appendServedKey(db, orgId, state.id, prompt.key, { lastServedAt: new Date() })

  return c.json({ prompt, remaining: eligible.length - 1 })
})

/**
 * GET /:orgId/prompts/settings?subjectId= — the track's cadence/packs for the settings screen.
 * Reads never create state (write-on-read is a mutation in a trench coat): a virgin track
 * returns the column defaults with `exists: false`.
 */
promptRoutes.get('/:orgId/prompts/settings', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)

  const track = await trackFromRequest(c, db, c.req.query('subjectId'))
  if (!track.ok) return track.res

  const [state] = await db
    .select()
    .from(schema.promptState)
    .where(trackWhere(orgId, track.subjectId))
    .limit(1)

  if (!state) {
    return c.json({
      exists: false,
      subjectId: track.subjectId,
      cadence: DEFAULT_STATE.cadence,
      packKeys: DEFAULT_STATE.packKeys,
      servedCount: 0,
      lastServedAt: null,
    })
  }
  // Allowlisted DTO — servedPromptKeys stays server-side (it's plumbing, and it grows).
  return c.json({
    exists: true,
    subjectId: state.subjectId,
    cadence: state.cadence,
    packKeys: state.packKeys,
    servedCount: state.servedPromptKeys.length,
    lastServedAt: state.lastServedAt,
  })
})

/**
 * POST /:orgId/prompts/skip — { promptKey, subjectId? }. Skip = served, free and final
 * (content rule 1: a skipped prompt never comes back, and skipping carries zero guilt).
 * Idempotent: re-skipping an already-served key is a 200 no-op.
 */
promptRoutes.post('/:orgId/prompts/skip', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid body' }, 400)

  const promptKey = typeof body.promptKey === 'string' ? body.promptKey.trim() : ''
  // Only real catalog keys may land in servedPromptKeys — it's client input headed for jsonb.
  if (!promptKey || !catalogKeys().has(promptKey)) {
    return c.json({ error: 'unknown promptKey' }, 400)
  }

  const track = await trackFromRequest(c, db, body.subjectId)
  if (!track.ok) return track.res

  const state = await getOrCreateState(db, orgId, track.subjectId)
  // Cheap fast path on the snapshot; the atomic append's own @> guard is the real idempotence
  // (a stale snapshot here can neither double-append nor clobber a concurrent /next's key).
  if (!state.servedPromptKeys.includes(promptKey)) {
    await appendServedKey(db, orgId, state.id, promptKey)
  }
  return c.json({ ok: true })
})

/**
 * PATCH /:orgId/prompts/settings — { cadence?, packKeys?, subjectId? }. Partial update; any
 * live member may tune their org's prompt experience (prompts are an engagement surface, not a
 * privileged one — same stance as escalations' resolve). Audited.
 */
promptRoutes.patch('/:orgId/prompts/settings', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const db = getDb(c.env.DATABASE_URL)
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid body' }, 400)

  const patch: { cadence?: string; packKeys?: string[] } = {}

  if (body.cadence !== undefined) {
    if (typeof body.cadence !== 'string' || !CADENCES.includes(body.cadence as never)) {
      return c.json({ error: `cadence must be one of: ${CADENCES.join(', ')}` }, 400)
    }
    patch.cadence = body.cadence
  }

  if (body.packKeys !== undefined) {
    if (!Array.isArray(body.packKeys) || body.packKeys.length > 16) {
      return c.json({ error: 'packKeys must be an array of at most 16 pack names' }, 400)
    }
    const known = new Set(Object.keys(PROMPT_CATALOG))
    const packKeys = [...new Set(body.packKeys)] // dedupe — user data headed for jsonb
    for (const pack of packKeys) {
      if (typeof pack !== 'string' || !known.has(pack)) {
        return c.json({ error: `unknown pack: ${String(pack)}` }, 400)
      }
    }
    patch.packKeys = packKeys as string[]
  }

  if (patch.cadence === undefined && patch.packKeys === undefined) {
    return c.json({ error: 'nothing to update' }, 400)
  }

  const track = await trackFromRequest(c, db, body.subjectId)
  if (!track.ok) return track.res

  const state = await getOrCreateState(db, orgId, track.subjectId)
  const [updated] = await db
    .update(schema.promptState)
    .set(patch)
    .where(and(eq(schema.promptState.id, state.id), eq(schema.promptState.organizationId, orgId)))
    .returning()

  await audit(c, {
    entityType: 'promptState',
    entityId: state.id,
    action: 'prompts.settings_updated',
    metadata: { subjectId: track.subjectId, ...patch },
  })
  return c.json({
    exists: true,
    subjectId: updated.subjectId,
    cadence: updated.cadence,
    packKeys: updated.packKeys,
    servedCount: updated.servedPromptKeys.length,
    lastServedAt: updated.lastServedAt,
  })
})
