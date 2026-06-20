import { Hono } from 'hono'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { awardCredits } from '../credits'
import { unlockAchievement } from '../achievements'
import { notify } from '../notify'
import { requireSession, type AuthEnv } from '../middleware/org'

/**
 * Referrals — the server side of src/lib/referrals.ts (share sheet) + app/invite/[code].tsx
 * (the landing/redemption screen). USER-scoped like settings.ts: the `referral` table has no
 * organizationId column (an invite follows the person), so every endpoint gates with
 * `requireSession` and scopes by `session.user.id`.
 *
 *   POST /api/referrals          → get-or-create the caller's OPEN invite code (at most one
 *                                  unredeemed code per user — once redeemed, the next call mints
 *                                  a fresh one; codes are single-use)
 *   GET  /api/referrals/mine     → the caller's created referrals, newest first (redeemedAt /
 *                                  redeemedByUserId carry the redemption status)
 *   POST /api/referrals/redeem   → { code } — claim a code and pay BOTH sides in credits
 *
 * Redemption rules (each rejected with a machine-readable `code` the client maps to i18n copy):
 *   404 not_found                 — unknown code
 *   400 already_redeemed          — the code was used (also returned to the loser of a race)
 *   400 own_code                  — redeemer is the code's creator (the spec's redeemer===creator
 *                                   and redeemer===referrerUserId checks are the same column
 *                                   here: referral.owner_user_id)
 *   400 already_redeemed_by_you   — anti-farming: one redemption per account, ever (without
 *                                   this, redeeming N codes banks N × the redeemer bonus)
 *   400 no_organization           — credit_ledger.organization_id is NOT NULL, so the redeemer
 *                                   needs an org before credits can land; checked BEFORE the
 *                                   claim so the code stays open for a later retry
 *
 * Concurrency: the Neon HTTP driver has no interactive transactions, so the conditional UPDATE
 * (`WHERE redeemed_at IS NULL`) is the lock — exactly one concurrent redeemer can claim a code.
 * Two partial unique indexes (schema.ts) backstop the check-then-act reads: a user can REDEEM at
 * most once ever (referral_redeemer_once_idx) and HOLD at most one open code
 * (referral_one_open_per_owner_idx) — the routes map their 23505s onto the same friendly
 * responses the fast-path SELECTs produce.
 * Credits are awarded AFTER the claim with per-side idempotency keys (the unique column in
 * credit_ledger dedupes), so a replay can never double-credit. Claim-then-award is deliberate:
 * award-then-claim would let a losing racer keep credits the winner's award then dedupes away.
 *
 * Award asymmetry (deliberate): the REDEEMER's bonus must land or the request 500s; the
 * REFERRER's side (credits + notify + achievement) is best-effort — skipped (and warn-logged)
 * when the referrer no longer belongs to any org, error-logged (never retried inline) when it
 * fails. The redeemer still gets a 200 either way: the claim already landed, and the per-side
 * idempotency keys keep a later ops repair safe.
 *
 * Enumeration: codes are looked up globally (user-scoped resource), so guessing is possible in
 * principle — mitigated by the rate limit on /api/referrals/* (worker/index.ts), the 32^8 code
 * space, and one-redemption-per-account-ever (1000 fake accounts ≤ 1000 redemptions, not a farm).
 */
export const referralRoutes = new Hono<AuthEnv>()

// Credit amounts per side of a redemption — config-driven (APP_CONFIG.engagement.referrals, the
// block the factory tunes per app). The `??` fallbacks are documented defaults only: they keep a
// minted app that strips the engagement block on sane amounts instead of breaking redemption.
const REFERRER_CREDITS = APP_CONFIG.engagement?.referrals?.referrerCredits ?? 500
const REDEEMER_CREDITS = APP_CONFIG.engagement?.referrals?.redeemerCredits ?? 250
/** Ledger vocabulary — matches the documented `credit_ledger.kind` set in schema.ts. */
const CREDIT_KIND = 'referral_credit'

/**
 * Code alphabet: 32 chars (no 0/O/1/I — read-aloud and retype safe; 32 divides 256 evenly, so
 * the modulo below introduces no bias). 32^8 ≈ 1.1e12 codes — collisions are retried anyway.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/**
 * Postgres unique violation (23505), wherever the Neon HTTP driver surfaces it: directly on the
 * error for raw driver errors, or on `cause` when Drizzle wraps it (DrizzleQueryError).
 */
function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  if ((e as { code?: unknown }).code === '23505') return true
  const cause = (e as { cause?: unknown }).cause
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === '23505'
}

/**
 * A user's "home" organization for credit awards — credit_ledger requires an org, but referral
 * rows are user-level. Preference order: the explicitly passed org (the redeemer's ACTIVE org
 * from the session — never a client-sent id), else the user's EARLIEST membership (their
 * first/personal org). Null when the user belongs to no org yet.
 */
async function homeOrgId(db: DB, userId: string, preferredOrgId?: string | null): Promise<string | null> {
  if (preferredOrgId) {
    // The session's activeOrganizationId can outlive the membership (left/kicked after sign-in)
    // — verify before crediting into it; on a miss, fall through to the earliest membership.
    const [stillMember] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(eq(schema.member.userId, userId), eq(schema.member.organizationId, preferredOrgId)),
      )
      .limit(1)
    if (stillMember) return preferredOrgId
  }
  const [membership] = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.member.createdAt))
    .limit(1)
  return membership?.organizationId ?? null
}

referralRoutes.post('/', requireSession, async (c) => {
  const session = c.get('session')
  const db = getDb(c.env.DATABASE_URL)

  // Get-or-create: at most ONE open code per user (abuse-resistant — no minting piles of codes).
  const [open] = await db
    .select()
    .from(schema.referral)
    .where(
      and(eq(schema.referral.ownerUserId, session.user.id), isNull(schema.referral.redeemedAt)),
    )
    .orderBy(desc(schema.referral.createdAt))
    .limit(1)
  if (open) return c.json(open)

  // unique(code) collision is ~impossible at 32^8, but onConflictDoNothing + retry keeps even
  // that case a clean re-roll instead of an opaque 500.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [created] = await db
        .insert(schema.referral)
        .values({ ownerUserId: session.user.id, code: generateCode() })
        .onConflictDoNothing({ target: schema.referral.code })
        .returning()
      if (created) return c.json(created, 201)
    } catch (e) {
      // The ON CONFLICT target above only covers `code`, so referral_one_open_per_owner_idx
      // surfaces as a thrown 23505 when a concurrent POST won the race to mint this user's open
      // code. Get-or-create semantics either way: return the winner's row.
      if (!isUniqueViolation(e)) throw e
      const [existing] = await db
        .select()
        .from(schema.referral)
        .where(
          and(eq(schema.referral.ownerUserId, session.user.id), isNull(schema.referral.redeemedAt)),
        )
        .orderBy(desc(schema.referral.createdAt))
        .limit(1)
      if (existing) return c.json(existing)
      // Winner's code was redeemed between its insert and our re-read — loop and mint fresh.
    }
  }
  return c.json({ error: 'failed to create referral code' }, 500)
})

referralRoutes.get('/mine', requireSession, async (c) => {
  const session = c.get('session')

  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.referral)
    .where(eq(schema.referral.ownerUserId, session.user.id))
    .orderBy(desc(schema.referral.createdAt))
    .limit(100)
  return c.json(rows)
})

referralRoutes.post('/redeem', requireSession, async (c) => {
  const session = c.get('session')

  const body = await c.req.json<{ code?: unknown }>().catch(() => null)
  const raw = body && typeof body.code === 'string' ? body.code.trim() : ''
  // Codes are stored uppercase (both generators emit uppercase); normalize so pasted links work.
  const code = raw.toUpperCase()
  // Length + charset cap before any DB work — same rigor as moderation.ts's input validation.
  if (!/^[A-Z0-9]{4,32}$/.test(code)) {
    return c.json({ error: 'a valid code is required', code: 'invalid_code' }, 400)
  }

  const db = getDb(c.env.DATABASE_URL)
  const [referral] = await db
    .select()
    .from(schema.referral)
    .where(eq(schema.referral.code, code))
    .limit(1)
  if (!referral) return c.json({ error: 'referral code not found', code: 'not_found' }, 404)

  if (referral.ownerUserId === session.user.id) {
    return c.json({ error: 'you cannot redeem your own invite code', code: 'own_code' }, 400)
  }
  if (referral.redeemedByUserId || referral.redeemedAt) {
    return c.json({ error: 'this invite code was already redeemed', code: 'already_redeemed' }, 400)
  }

  // Resolve the redeemer's org BEFORE claiming — if they have none, the code stays open and the
  // client can send them to create one and retry. Resolved before the one-redemption check too:
  // retryable preconditions first, so a "join an org and come back" rejection never interleaves
  // with the permanent-lockout check below.
  const redeemerOrgId = await homeOrgId(db, session.user.id, session.session.activeOrganizationId)
  if (!redeemerOrgId) {
    return c.json(
      { error: 'join or create an organization before redeeming', code: 'no_organization' },
      400,
    )
  }

  // One redemption per account, ever (see header) — checked across ALL codes, not just this one.
  // Friendly FAST PATH only: the race-proof rule is referral_redeemer_once_idx, mapped below.
  const [prior] = await db
    .select({ id: schema.referral.id })
    .from(schema.referral)
    .where(eq(schema.referral.redeemedByUserId, session.user.id))
    .limit(1)
  if (prior) {
    return c.json(
      { error: 'you have already redeemed an invite', code: 'already_redeemed_by_you' },
      400,
    )
  }

  // Race-safe claim: the conditional UPDATE is the lock (no transactions on the HTTP driver) —
  // of two concurrent redeemers, exactly one matches `redeemed_at IS NULL`.
  let claimed: { id: string; ownerUserId: string } | undefined
  try {
    ;[claimed] = await db
      .update(schema.referral)
      .set({ redeemedByUserId: session.user.id, redeemedAt: new Date() })
      .where(
        and(
          eq(schema.referral.id, referral.id),
          isNull(schema.referral.redeemedByUserId),
          isNull(schema.referral.redeemedAt),
        ),
      )
      .returning({ id: schema.referral.id, ownerUserId: schema.referral.ownerUserId })
  } catch (e) {
    // referral_redeemer_once_idx: this user claimed ANOTHER code between the prior-redemption
    // SELECT above and this UPDATE — same answer as the fast path, just decided by the index.
    if (!isUniqueViolation(e)) throw e
    return c.json(
      { error: 'you have already redeemed an invite', code: 'already_redeemed_by_you' },
      400,
    )
  }
  if (!claimed) {
    return c.json({ error: 'this invite code was already redeemed', code: 'already_redeemed' }, 400)
  }
  // Everything below keys off `claimed` — the row the LOCKING update actually matched — never the
  // pre-read `referral` object, so a stale read can never decide which row gets credited. The
  // WHERE pins the id, making a mismatch impossible by construction; the check guards future
  // drift (e.g. someone widening the WHERE to match by code).
  if (claimed.id !== referral.id) {
    throw new Error(`referral claim integrity: claimed ${claimed.id}, expected ${referral.id}`)
  }

  // Redeemer's bonus. The idempotency key makes any replay a no-op (unique-column dedupe), so a
  // failure here is loud (500) but never double-credits on repair.
  await awardCredits(db, {
    organizationId: redeemerOrgId,
    userId: session.user.id,
    kind: CREDIT_KIND,
    delta: REDEEMER_CREDITS,
    reason: 'referral.redeemed',
    entityType: 'referral',
    entityId: claimed.id,
    idempotencyKey: `referral:${claimed.id}:redeemed`,
  })

  // Referrer's bonus — best-effort: a failure on THIS side must not turn the redeemer's success
  // into a 500 (the claim already landed). The idempotency key keeps a later repair safe.
  // (See the header's "award asymmetry" note: skipped when the referrer has no org; the
  // redeemer's award above lands regardless.)
  try {
    const referrerOrgId = await homeOrgId(db, claimed.ownerUserId)
    if (referrerOrgId) {
      await awardCredits(db, {
        organizationId: referrerOrgId,
        userId: claimed.ownerUserId,
        kind: CREDIT_KIND,
        delta: REFERRER_CREDITS,
        reason: 'referral.converted',
        entityType: 'referral',
        entityId: claimed.id,
        idempotencyKey: `referral:${claimed.id}:referrer`,
      })
      // Tell the referrer their invite landed — notify() is best-effort and never throws.
      await notify(db, c.env, {
        organizationId: referrerOrgId,
        userId: claimed.ownerUserId,
        kind: 'referral.redeemed',
        title: `${session.user.name} accepted your invite`,
        body: `+${REFERRER_CREDITS} credits added`,
        entityType: 'referral',
        entityId: claimed.id,
      })
      // First converted invite → the 'referrer' achievement (src/lib/achievements.ts catalog).
      // Idempotent (unique org/user/key) and never throws, so calling on every redemption is safe.
      await unlockAchievement(db, c.env, {
        organizationId: referrerOrgId,
        userId: claimed.ownerUserId,
        achievementKey: 'referrer',
      })
    } else {
      // No membership anywhere (they created a code, then left/deleted every org) — skip, logged.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'referral.referrer_award_skipped',
          reason: 'no_organization',
          referralId: claimed.id,
        }),
      )
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'referral.referrer_award_failed',
        referralId: claimed.id,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
  }

  return c.json({ ok: true, creditsAwarded: REDEEMER_CREDITS })
})
