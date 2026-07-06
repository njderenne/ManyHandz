import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb, schema, type DB } from '@/lib/db'
import type { Env } from '../env'

/**
 * Wearables / provider pull-sync — the CRON HALF of the integrations module (projectgains donor,
 * generalized). The OAuth connect half already ships (worker/routes/integrations.ts + the
 * providers.ts engine); this file adds the recurring pull: iterate every non-revoked
 * `provider_token`, hand each row to its provider's registered PULLER, and keep the
 * provider_token/sync_state `lastSyncedAt` bookkeeping honest.
 *
 * WHAT THE TEMPLATE SHIPS vs WHAT APPS ADD — the seam is `providerPullers`:
 *
 *   • TEMPLATE (here): the registry, the token scan, per-provider soft-fail isolation, the
 *     personal-org destination resolution (M-11 below), and the lastSyncedAt stamps. No domain
 *     writes — the chassis has no idea what a "run" or a "weight" is.
 *   • APP: registers a puller per provider it supports, at module load in its own worker code:
 *
 *         import { providerPullers, type SyncTokenRow } from './integrations/sync'
 *         providerPullers.strava = async (env, row) => { …fetch + write domain rows… }
 *
 *     The puller owns the provider API calls (via ensureFreshToken/decryptTokenBlob from
 *     providers.ts), its own dedupe (unique (userId, source, externalId) indexes on its domain
 *     tables — the projectgains doctrine), and returns a SyncResult the sweep rolls up. The
 *     projectgains strava/fitbit/whoop/oura bodies stay app-layer: their write targets are
 *     domain tables.
 *
 * DESTINATION RULE (M-11): pullers write ONLY to the caller's PERSONAL org.
 * `resolvePersonalOrgId` returns the `kind='personal'` org or NULL — and when NULL the row is
 * SKIPPED with a structured `integrations.sync.no_destination` log. There is deliberately NO
 * first-membership fallback: `provider_token` is user-keyed with no orgId, and row-sort order is
 * not an authorization decision — a fallback could write personal health data into an org the
 * user merely joined. Team-visible wearables is an explicit app-layer decision (app puller, app
 * table, org id recorded at connect time).
 *
 * Cadence: `syncAllProviders(env)` is a cron step (worker/cron.ts, gated by
 * `APP_CONFIG.features.wearables`) and the manual "sync now" route reuses the same pullers for a
 * single caller (POST /api/integrations/:provider/sync). With no pullers registered the sweep is
 * a zero-query no-op — the template pays nothing for this file until an app opts in.
 *
 * Tokens are NEVER logged — structured events carry the provider key + a sanitized message only.
 */

/**
 * Hard cap on tokens processed per sweep. A Cloudflare cron invocation is bound by CPU/wall-time
 * and the subrequest soft limit; each token here costs a destination lookup + puller subrequests +
 * two lastSyncedAt updates, so an unbounded scan over a few hundred connected tokens exhausts the
 * budget and times out — dropping the TAIL of the (stably ordered) query, i.e. always the SAME
 * users, forever. Bound the run and drain across ticks instead (the nudge engine's MAX_*_PER_RUN
 * doctrine). The query orders by lastSyncedAt ASC NULLS FIRST so the least-recently-synced tokens
 * are always picked up first: no user is permanently starved, at the cost of quantizing a large
 * fleet's sync latency to (token_count / MAX_TOKENS_PER_RUN) cron cadences. Latent in the stock
 * template (zero pullers ⇒ zero tokens scanned); it bites the first app that registers one at scale.
 */
const MAX_TOKENS_PER_RUN = 500

/** The per-row outcome a puller returns. Soft failures (`warning`) still count as "ran". */
export interface SyncResult {
  provider: string
  userId: string
  /** New rows persisted by the puller. */
  inserted: number
  /** Pre-existing rows skipped (dedupe hit). */
  skipped: number
  /** Soft-fail note; logged but the sync is still considered "ran" (lastSyncedAt stamps). */
  warning?: string
  /** Hard failure — the sync did not complete (no lastSyncedAt stamp; surfaces in the rollup). */
  error?: string
}

/** A provider_token row as the sync layer hands it to a puller (non-revoked, destination resolved). */
export interface SyncTokenRow {
  userId: string
  provider: string
  /** token-cipher envelope — decrypt via decryptTokenBlob/ensureFreshToken (providers.ts). */
  ciphertext: string
  expiresAt: Date | null
  lastSyncedAt: Date | null
  /** The caller's PERSONAL org — the ONLY legal write destination (M-11). Pre-resolved so a
   *  puller can't get it wrong; a row with no personal org never reaches a puller. */
  destinationOrgId: string
}

/**
 * A provider's pull implementation. MUST be defensive per the soft-fail doctrine: one flaky
 * sub-fetch (a profile mirror, an optional endpoint) should degrade to `warning`, not `error` —
 * and must never throw for expected provider hiccups (the sweep catches throws as `error`).
 */
export type ProviderPuller = (env: Env, row: SyncTokenRow) => Promise<SyncResult>

/**
 * THE REGISTRY — empty in the template; apps assign pullers at module load (same mutable-object
 * contract as `reportLoaders`/`smsRecipientResolver`: importers mutate the object's properties,
 * never rebind the export).
 */
export const providerPullers: Record<string, ProviderPuller> = {}

/**
 * Resolve the org imported data lands in: the user's PERSONAL org (kind='personal'), or NULL.
 * NO fallback (M-11 — see the module header). Exported for the manual-sync route and for app
 * pullers that need the same answer elsewhere.
 */
export async function resolvePersonalOrgId(db: DB, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: schema.organization.id })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.organization.kind, 'personal'),
        isNull(schema.member.archivedAt),
      ),
    )
    .limit(1)
  return row?.orgId ?? null
}

/** Stamp provider_token + sync_state lastSyncedAt to now after a successful pull. */
export async function markProviderSynced(db: DB, userId: string, provider: string): Promise<void> {
  const now = new Date()
  await db
    .update(schema.providerToken)
    .set({ lastSyncedAt: now })
    .where(and(eq(schema.providerToken.userId, userId), eq(schema.providerToken.provider, provider)))
  await db
    .update(schema.syncState)
    .set({ lastSyncedAt: now })
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.provider, provider)))
}

/**
 * The cron sweep (STAGE0 §9 contract): pull every non-revoked token whose provider has a
 * registered puller, soft-failing PER PROVIDER-ROW so one user's expired refresh token never
 * starves the rest. Returns a per-provider rollup for the cron's structured `done` log:
 * `ok` = every row of that provider completed without a hard error, `synced` = total rows the
 * pullers inserted, `error` = the first hard error seen (a debugging breadcrumb, not the full list).
 */
export async function syncAllProviders(
  env: Env,
): Promise<Record<string, { ok: boolean; synced: number; error?: string }>> {
  const providers = Object.keys(providerPullers)
  // No pullers registered (the stock template) — zero queries, empty rollup.
  if (providers.length === 0) return {}

  const db = getDb(env.DATABASE_URL)
  const tokens = await db
    .select({
      userId: schema.providerToken.userId,
      provider: schema.providerToken.provider,
      ciphertext: schema.providerToken.ciphertext,
      expiresAt: schema.providerToken.expiresAt,
      lastSyncedAt: schema.providerToken.lastSyncedAt,
    })
    .from(schema.providerToken)
    .where(
      and(isNull(schema.providerToken.revokedAt), inArray(schema.providerToken.provider, providers)),
    )
    // Least-recently-synced first (NULLS FIRST = never-synced tokens lead), then bounded — so the
    // MAX_TOKENS_PER_RUN cap starves nobody permanently: whoever is oldest is always next in line.
    .orderBy(asc(sql`${schema.providerToken.lastSyncedAt} nulls first`))
    .limit(MAX_TOKENS_PER_RUN)

  const rollup: Record<string, { ok: boolean; synced: number; error?: string }> = {}
  const bump = (provider: string) => (rollup[provider] ??= { ok: true, synced: 0 })

  // One destination resolution per user per sweep, however many providers they've connected.
  const destinationCache = new Map<string, string | null>()

  for (const row of tokens) {
    const summary = bump(row.provider)
    const puller = providerPullers[row.provider]
    if (!puller) continue // registry mutated mid-sweep — treat as unregistered

    let destinationOrgId = destinationCache.get(row.userId)
    if (destinationOrgId === undefined) {
      try {
        destinationOrgId = await resolvePersonalOrgId(db, row.userId)
      } catch (e) {
        // A failed lookup is a hard error for this row, not a license to guess a destination.
        summary.ok = false
        summary.error ??= e instanceof Error ? e.message : 'destination_lookup_failed'
        continue
      }
      destinationCache.set(row.userId, destinationOrgId)
    }

    // M-11: no personal org ⇒ SKIP, never fall back to another org.
    if (!destinationOrgId) {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'integrations.sync.no_destination',
          provider: row.provider,
          userId: row.userId,
        }),
      )
      continue
    }

    let result: SyncResult
    try {
      result = await puller(env, { ...row, destinationOrgId })
    } catch (e) {
      result = {
        provider: row.provider,
        userId: row.userId,
        inserted: 0,
        skipped: 0,
        error: e instanceof Error ? e.message : 'puller_threw',
      }
    }

    if (result.error) {
      summary.ok = false
      summary.error ??= result.error
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'integrations.sync.failed',
          provider: row.provider,
          userId: row.userId,
          message: result.error,
        }),
      )
      continue
    }

    summary.synced += result.inserted
    if (result.warning) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'integrations.sync.warning',
          provider: row.provider,
          userId: row.userId,
          message: result.warning,
        }),
      )
    }
    // Bookkeeping only after a completed pull — a failed row retries from its old checkpoint.
    try {
      await markProviderSynced(db, row.userId, row.provider)
    } catch (e) {
      summary.ok = false
      summary.error ??= e instanceof Error ? e.message : 'mark_synced_failed'
    }
  }

  return rollup
}
