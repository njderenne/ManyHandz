import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireSession, type AuthEnv } from '../middleware/org'

/**
 * User settings — the USER-scoped (not org-scoped) settings route for the `user_settings` table:
 * what the SERVER must know about a user (notification opt-ins, marketing consent, locale,
 * timezone, onboarding state). Device-local taste (theme, haptics) stays in the client prefs
 * store. Every query scopes by `session.user.id` — golden rule 4 for user-level resources
 * (compare /api/me in worker/index.ts; the org-scoped sibling pattern is notifications.ts).
 *
 * THE canonical `notificationPrefs` shape (the client mirrors it in
 * src/lib/query/hooks/useUserSettings.ts — keep the two in sync):
 *
 *   { push: { enabled: boolean }, email: { enabled: boolean, digest: boolean } }
 *
 * Defaults: everything true except `digest` (the weekly summary is opt-in). The jsonb column
 * stays open-shaped so minted apps can add channels without a migration; PATCH shallow-merges
 * the TOP-LEVEL channel keys into the stored value, so updating one channel never clobbers
 * another — clients therefore send whole channel objects, not single flags.
 *
 *   GET   /api/user/settings → the caller's row (created with defaults on first read)
 *   PATCH /api/user/settings { notificationPrefs?, marketingOptIn?, locale?, timezone?,
 *                              onboardingCompletedAt? } → the updated row
 */
export const settingsRoutes = new Hono<AuthEnv>()

/** Server-side defaults, written on first read. Mirrored by the client hook — keep in sync. */
const DEFAULT_NOTIFICATION_PREFS: Record<string, Record<string, boolean>> = {
  push: { enabled: true },
  email: { enabled: true, digest: false },
}

/** Plain-object check — jsonb patches must be objects, never arrays or primitives. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Caps on the open-shaped prefs jsonb. PATCH shallow-merges TOP-LEVEL keys into the stored value,
 * so channel keys ACCUMULATE across requests — without a ceiling (enforced per patch here, and on
 * the merged result before writing), patches with novel keys grow the row forever.
 */
const MAX_PREF_CHANNELS = 20
const MAX_PREF_FLAGS_PER_CHANNEL = 20
const MAX_PREF_KEY_LENGTH = 64

/**
 * Validate an incoming notificationPrefs patch: top level is channel → flags, every flag a
 * boolean, key counts and lengths within the caps above. Open-shaped on purpose (per-app channels
 * slot in) but strictly typed at the leaves — anything else is a caller bug and gets a 400 before
 * any DB work.
 */
function isValidPrefsPatch(value: unknown): value is Record<string, Record<string, boolean>> {
  if (!isPlainObject(value)) return false
  const channels = Object.entries(value)
  if (channels.length > MAX_PREF_CHANNELS) return false
  return channels.every(([name, channel]) => {
    if (name.length > MAX_PREF_KEY_LENGTH || !isPlainObject(channel)) return false
    const flags = Object.entries(channel)
    if (flags.length > MAX_PREF_FLAGS_PER_CHANNEL) return false
    return flags.every(
      ([flag, enabled]) => flag.length <= MAX_PREF_KEY_LENGTH && typeof enabled === 'boolean',
    )
  })
}

/**
 * Get-or-create the caller's settings row. First read wins the insert; a same-instant race is
 * absorbed by `onConflictDoNothing` on the unique(user_id) constraint, after which the winner's
 * row is re-read as the truth.
 */
async function getOrCreateSettings(db: ReturnType<typeof getDb>, userId: string) {
  const [existing] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1)
  if (existing) return existing

  const [created] = await db
    .insert(schema.userSettings)
    .values({ userId, notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS } })
    .onConflictDoNothing({ target: schema.userSettings.userId })
    .returning()
  if (created) return created

  // Lost the race — another request inserted between our select and insert. Its row is canonical.
  const [row] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1)
  if (row) return row

  // Vanishingly rare: the racing row was deleted (e.g. account-deletion cascade) between our
  // insert attempt and the re-read. One more insert keeps the "a row exists" contract honest;
  // if even this returns nothing, callers' null-guards turn it into a clean 500.
  const [retried] = await db
    .insert(schema.userSettings)
    .values({ userId, notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS } })
    .onConflictDoNothing({ target: schema.userSettings.userId })
    .returning()
  return retried
}

settingsRoutes.get('/settings', requireSession, async (c) => {
  const session = c.get('session')
  const row = await getOrCreateSettings(getDb(c.env.DATABASE_URL), session.user.id)
  if (!row) return c.json({ error: 'failed to initialize user settings' }, 500)
  return c.json(row)
})

settingsRoutes.patch('/settings', requireSession, async (c) => {
  const session = c.get('session')

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!isPlainObject(body)) return c.json({ error: 'a JSON object body is required' }, 400)

  // Field-by-field defensive validation — wrong types are rejected loudly (400), never coerced.
  // Unknown fields are ignored, so old servers tolerate newer clients.
  const updates: Partial<typeof schema.userSettings.$inferInsert> = {}

  if ('marketingOptIn' in body) {
    if (typeof body.marketingOptIn !== 'boolean') {
      return c.json({ error: 'marketingOptIn must be a boolean' }, 400)
    }
    updates.marketingOptIn = body.marketingOptIn
  }

  if ('locale' in body) {
    if (typeof body.locale !== 'string' || !body.locale.trim()) {
      return c.json({ error: 'locale must be a non-empty string' }, 400)
    }
    updates.locale = body.locale.trim().slice(0, 35) // BCP-47 tags are short; cap defensively
  }

  if ('timezone' in body) {
    if (typeof body.timezone !== 'string' || !body.timezone.trim()) {
      return c.json({ error: 'timezone must be a non-empty string' }, 400)
    }
    updates.timezone = body.timezone.trim().slice(0, 64) // IANA zone ids are short; cap defensively
  }

  if ('onboardingCompletedAt' in body) {
    // ISO timestamp to stamp completion, or null to reset (e.g. "replay onboarding").
    if (body.onboardingCompletedAt === null) {
      updates.onboardingCompletedAt = null
    } else if (typeof body.onboardingCompletedAt === 'string') {
      const date = new Date(body.onboardingCompletedAt)
      if (Number.isNaN(date.getTime())) {
        return c.json({ error: 'onboardingCompletedAt must be an ISO timestamp or null' }, 400)
      }
      updates.onboardingCompletedAt = date
    } else {
      return c.json({ error: 'onboardingCompletedAt must be an ISO timestamp or null' }, 400)
    }
  }

  // Validated-value pattern: the type guard narrows a local, so no `as` cast is needed below —
  // the merge can only ever see a value isValidPrefsPatch() accepted.
  let prefsPatch: Record<string, Record<string, boolean>> | undefined
  if ('notificationPrefs' in body) {
    const candidate: unknown = body.notificationPrefs
    if (!isValidPrefsPatch(candidate)) {
      return c.json(
        {
          error:
            `notificationPrefs must be { channel: { flag: boolean } } objects ` +
            `(max ${MAX_PREF_CHANNELS} channels, ${MAX_PREF_FLAGS_PER_CHANNEL} flags each, ` +
            `keys up to ${MAX_PREF_KEY_LENGTH} chars)`,
        },
        400,
      )
    }
    prefsPatch = candidate
  }

  if (!prefsPatch && Object.keys(updates).length === 0) {
    return c.json({ error: 'no recognized fields to update' }, 400)
  }

  const db = getDb(c.env.DATABASE_URL)
  // PATCH-before-first-GET is legal: ensure the row exists (also gives us the stored prefs to merge).
  const current = await getOrCreateSettings(db, session.user.id)
  if (!current) return c.json({ error: 'failed to initialize user settings' }, 500)

  if (prefsPatch) {
    // Shallow-merge channels into what's stored — a one-channel patch never clobbers the others.
    const merged = {
      ...(current.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS),
      ...prefsPatch,
    }
    // Channel keys accumulate across PATCHes (the merge keeps every key ever written), so the
    // ceiling must hold on the MERGED result — a per-patch cap alone still grows the row forever.
    // But only when the patch ADDS keys: a pre-cap row that already exceeds the ceiling must stay
    // patchable (flag flips on existing channels), or it would be bricked forever.
    const addsKeys = Object.keys(prefsPatch).some(
      (k) => !(k in (current.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS)),
    )
    if (addsKeys && Object.keys(merged).length > MAX_PREF_CHANNELS) {
      return c.json(
        { error: `too many notification channels (max ${MAX_PREF_CHANNELS})` },
        400,
      )
    }
    updates.notificationPrefs = merged
  }

  const [updated] = await db
    .update(schema.userSettings)
    .set(updates)
    // Scoping on the WRITE too — the row is addressed by the session user, never a client id.
    .where(eq(schema.userSettings.userId, session.user.id))
    .returning()
  // The row existed moments ago (getOrCreateSettings) — no match means a concurrent delete.
  if (!updated) return c.json({ error: 'update failed' }, 500)
  return c.json(updated)
})
