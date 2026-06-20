import { and, eq, sql } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'

/**
 * Credits engine — THE server-side way to move points. Product routes, webhooks, and cron jobs
 * call these helpers after a state change worth rewarding (or charging for); nothing else writes
 * `credit_ledger` rows. The table is APPEND-ONLY: a balance is always `SUM(delta)` per
 * (org, user, kind) — never a stored, mutable number (that's how apps double-credit). See
 * schema.ts (credit_ledger) for the column-level contract.
 *
 *   awardCredits(db, input)  → insert a positive delta; idempotencyKey dedupes retried events
 *   spendCredits(db, input)  → balance check, then insert a negative delta; idempotencyKey
 *                              dedupes retried spends — `deduped: true` marks the replay
 *                              (see RACE CAVEAT)
 *   getBalance(db, org, user, kind?) → COALESCE(SUM(delta), 0)
 *
 * Unlike notify() these THROW on programmer error (non-positive delta, blank scope ids,
 * over-long keys): a credit movement is a state change, not a side effect, and a silent skip
 * would corrupt the economy. Callers own deciding whether a failure should fail their action.
 *
 * @example
 * // In a route, after the rewarded action commits (ids from verified context, never the client):
 * const db = getDb(c.env.DATABASE_URL)
 * await awardCredits(db, {
 *   organizationId: orgId,
 *   userId: session.user.id,
 *   kind: 'reward_points',
 *   delta: 50,
 *   reason: 'Completed onboarding',
 *   idempotencyKey: `onboarding:${session.user.id}`, // retries become no-ops
 * })
 */

/** TEXT-column caps — server callers only, but unbounded strings are a database-bloat vector. */
const MAX_KIND = 100
const MAX_REASON = 500
const MAX_ENTITY = 255
const MAX_IDEMPOTENCY_KEY = 255

export type AwardCreditsInput = {
  /** Org the credit belongs to — pass the verified active org, never a client-sent id. */
  organizationId: string
  /** User being credited. */
  userId: string
  /** Ledger namespace: 'reward_points' | 'referral_credit' | 'promo' | per-app vocab. */
  kind: string
  /** Amount to award — a positive integer (points, or cents for money-like credits). */
  delta: number
  /** Human-readable line for the history screen, e.g. 'Referred a friend'. */
  reason?: string
  /** Optional link to the domain row that earned the credit. */
  entityType?: string
  entityId?: string
  /**
   * Set for credits triggered by external/retryable events (webhooks, queue consumers, cron):
   * the column's unique constraint turns a duplicate delivery into a silent no-op. Omit for
   * one-shot, request-scoped awards.
   */
  idempotencyKey?: string
}

export type SpendCreditsInput = {
  organizationId: string
  userId: string
  kind: string
  /** Amount to spend — a positive integer; the ledger row is inserted as `-delta`. */
  delta: number
  /** Human-readable line for the history screen, e.g. 'Redeemed avatar pack'. */
  reason?: string
  /**
   * Set for spends triggered by external/retryable events (webhooks, queue consumers, cron):
   * the column's unique constraint turns a duplicate delivery into a no-op flagged
   * `deduped: true`. Omit for one-shot, request-scoped spends.
   */
  idempotencyKey?: string
}

/** Shared guards — these are programmer errors (server callers only), so they throw loudly. */
function assertCreditInput(fn: string, input: { organizationId: string; userId: string; kind: string; delta: number }): void {
  if (!input.organizationId?.trim()) throw new Error(`${fn}: organizationId is required`)
  if (!input.userId?.trim()) throw new Error(`${fn}: userId is required`)
  if (!input.kind?.trim()) throw new Error(`${fn}: kind is required`)
  if (input.kind.length > MAX_KIND) throw new Error(`${fn}: kind exceeds ${MAX_KIND} characters`)
  // Integer-only: the column is integer; fractional deltas would corrupt sums or throw opaquely.
  // Delta must be POSITIVE for both helpers: awardCredits stores it as-is, spendCredits negates
  // it internally for the ledger row — callers never pass a negative number.
  if (!Number.isInteger(input.delta) || input.delta <= 0) {
    throw new Error(`${fn}: delta must be a positive integer (got ${input.delta})`)
  }
}

/**
 * Award credits: insert one positive ledger row.
 *
 * Idempotency: when `idempotencyKey` is set, a key that already exists makes the insert a SILENT
 * no-op (`onConflictDoNothing` on the column's unique constraint) — exactly what a retried
 * webhook or re-run cron wants. Rows without a key never conflict (Postgres uniques ignore NULLs).
 */
export async function awardCredits(db: DB, input: AwardCreditsInput): Promise<void> {
  assertCreditInput('awardCredits', input)
  // Truncating an idempotency key would silently merge distinct events — reject instead.
  if (input.idempotencyKey && input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
    throw new Error(`awardCredits: idempotencyKey exceeds ${MAX_IDEMPOTENCY_KEY} characters`)
  }
  if (input.entityType && input.entityType.length > MAX_ENTITY) {
    throw new Error(`awardCredits: entityType exceeds ${MAX_ENTITY} characters`)
  }
  if (input.entityId && input.entityId.length > MAX_ENTITY) {
    throw new Error(`awardCredits: entityId exceeds ${MAX_ENTITY} characters`)
  }

  await db
    .insert(schema.creditLedger)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      kind: input.kind,
      delta: input.delta,
      reason: input.reason?.trim().slice(0, MAX_REASON) || null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })
}

/**
 * Spend credits: check the balance, then insert one negative ledger row. Returns a discriminated
 * result instead of throwing — "not enough points" is a normal user state, not an error.
 *
 * Idempotency: same contract as awardCredits — a repeated `idempotencyKey` makes the insert a
 * no-op, reported as `{ ok: true, deduped: true }` so callers can tell a replay from a fresh
 * spend. A replay is answered with its ORIGINAL outcome even when the (already-debited) balance
 * would now fail the check — see the prior-key lookup in the insufficient branch.
 *
 * RACE CAVEAT — POINTS-ONLY. Never call this for money, paid/purchased credits, or anything a
 * user can charge back or cash out; do the documented transaction upgrade below FIRST. There is
 * deliberately no kind-string guard enforcing this (a naming convention is not a safety boundary)
 * — the boundary is this contract, and reviewers should reject any money-like caller on sight.
 * Why: the balance check and the insert are TWO statements over the stateless Neon HTTP driver
 * (one round-trip each, no transaction — see src/lib/db/index.ts), so two concurrent spends can
 * both pass the check and drive the balance negative by up to one overspend per concurrent
 * caller. For v1 engagement points that is acceptable: the worst case is a briefly negative
 * point balance, and the append-only ledger keeps the history auditable.
 * Upgrade path: switch to the `drizzle-orm/neon-serverless` Pool driver and wrap check+insert in
 * an interactive transaction that serializes per scope — `pg_advisory_xact_lock(hashtext(orgId ||
 * userId || kind))` (or a SELECT ... FOR UPDATE on a dedicated per-scope lock row, or SERIALIZABLE
 * isolation with retry). The ledger schema needs no change — only this function's body does.
 */
export async function spendCredits(
  db: DB,
  input: SpendCreditsInput,
): Promise<{ ok: true; deduped: boolean } | { ok: false; reason: string }> {
  assertCreditInput('spendCredits', input)
  // Truncating an idempotency key would silently merge distinct events — reject instead.
  if (input.idempotencyKey && input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
    throw new Error(`spendCredits: idempotencyKey exceeds ${MAX_IDEMPOTENCY_KEY} characters`)
  }

  const balance = await getBalance(db, input.organizationId, input.userId, input.kind)
  if (balance < input.delta) {
    // The first delivery of this key already debited the balance, so a replay can land here
    // where the original passed — answer it with the original outcome, not a bogus failure.
    if (input.idempotencyKey) {
      const [prior] = await db
        .select({ id: schema.creditLedger.id })
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (prior) return { ok: true, deduped: true }
    }
    return { ok: false, reason: 'insufficient_balance' }
  }

  // `.returning()` doubles as the dedupe probe: ON CONFLICT DO NOTHING yields zero rows on a
  // replayed key. Keyless rows never conflict (Postgres uniques ignore NULLs) — always fresh.
  const inserted = await db
    .insert(schema.creditLedger)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      kind: input.kind,
      delta: -input.delta,
      reason: input.reason?.trim().slice(0, MAX_REASON) || null,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing({ target: schema.creditLedger.idempotencyKey })
    .returning({ id: schema.creditLedger.id })
  return { ok: true, deduped: inserted.length === 0 }
}

/**
 * Current balance for (org, user) — `COALESCE(SUM(delta), 0)`, optionally narrowed to one `kind`.
 * Cheap by construction: the sum runs over `credit_ledger_scope_idx` (org, user, kind, createdAt).
 * Postgres returns SUM(integer) as bigint (a string over the wire) — `.mapWith(Number)` makes it
 * a number; ledgers that could overflow 2^53 points are not a v1 concern.
 */
export async function getBalance(
  db: DB,
  organizationId: string,
  userId: string,
  kind?: string,
): Promise<number> {
  const scope = and(
    eq(schema.creditLedger.organizationId, organizationId),
    eq(schema.creditLedger.userId, userId),
  )
  const [row] = await db
    .select({
      balance: sql`coalesce(sum(${schema.creditLedger.delta}), 0)`.mapWith(Number),
    })
    .from(schema.creditLedger)
    .where(kind ? and(scope, eq(schema.creditLedger.kind, kind)) : scope)
  return row?.balance ?? 0
}
