import { and, asc, eq, isNull } from 'drizzle-orm'
import { schema, type DB } from '@/lib/db'
import type { Escalation } from '@/lib/db/schema'
import { APP_CONFIG } from '@/lib/config/app'
import type { Env } from '../env'
import { notify } from '../notify'
import { smsConfigured, sendSms, smsAllowed, recordSmsSent } from './sms'

/**
 * Escalation engine — the SAFETY state machine that turns "a scheduled thing went unconfirmed"
 * into a paced ladder of reminders → alerts → a hard "missed" record. Generalized from RxMndr's
 * production dose ladder: one escalation row per unconfirmed slot, keyed
 * (organizationId, entityType, entityId, scheduledFor) — the `escalation_slot_idx` unique index —
 * so an app can point the ladder at ANY domain row (medication schedule, chore, dose, check-in).
 *
 * Stage vocabulary + dwell timers are CONFIG, not code: APP_CONFIG.safety.escalation
 * (TEXT column, no enums). Default ladder: reminder → follow_up → alert → missed.
 *
 * PACING (M-4, the donor's model — RxMndr escalation.ts:24-29): CUMULATIVE from `scheduledFor`,
 * NOT inter-stage dwell. The ladder's target stage at `now` is the deepest stage i with
 *   scheduledFor + Σ dwellMinutes(stages[0..i-1]) ≤ now
 * Snooze holds advancement while `now < snoozedUntil`; once it lapses the ladder catches up
 * cumulatively. One tick may advance multiple stages, stamping EVERY `stageTimestamps` entry
 * (audit only — the stamps are never the pacing input), so a crashed or sparse cron never
 * double-acts and never skips a stage.
 *
 * ── HONESTY (M-4) ────────────────────────────────────────────────────────────────────────────
 * Stage TIMING is quantized to the cron interval: a stage due at scheduledFor+15m fires on the
 * first cron tick AFTER that instant. Enabling `features.escalations` therefore REQUIRES a
 * per-app cron interval ≤ min(dwellMinutes) (e.g. `*\/5 * * * *` — the "\/" is comment-escaping,
 * read it as a plain slash) — builder/verify/readiness.js enforces this (A2). The template ships
 * the flag off on a 6-hour cron. A 15-minute stage on a 6-hour cron is a lie sold as "safety" —
 * never imply otherwise in app copy.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * SMS fallback: ENTERING the config's `smsStage` sends SMS once — the committed stage crossing is
 * the primary at-most-once guard (state COMMITS before any side effect fires; see
 * advanceEscalations) and `smsSentAt` is the belt-and-braces latch — gated by `smsConfigured`
 * (dormant without TWILIO_*) and the per-org daily spend cap (`smsAllowed`, M-5, consulted before
 * EVERY send). Recipients come from the app-owned `smsRecipientResolver` registry below; the
 * chassis default resolves nobody (there is no phone-number column in the chassis schema —
 * deliberately; see M-6).
 *
 * All clock reads go through the explicit `now` argument so behavior is testable (RxMndr's
 * pure-ish doctrine). Everything side-effectful is best-effort: a notify/SMS/KV failure must
 * never break the sweep.
 */

const MIN_MS = 60 * 1000

// ---------------------------------------------------------------------------
// App-extension registries
// ---------------------------------------------------------------------------

/** A due-but-unconfirmed slot an app wants the ladder to watch. `notify` is the OPENING push's
 *  copy (title/body) — provide it; the chassis can only produce generic copy for later stages. */
export type EscalationSlot = {
  organizationId: string
  /** Optional subject pin — escalations about a person/pet. Null/absent = org-level. */
  subjectId?: string | null
  /** App-domain anchor of the escalated slot (part of the idempotence key). */
  entityType: string
  entityId: string
  /** The UTC instant the slot was due. Pacing is cumulative from this — never from stage entry. */
  scheduledFor: Date
  /** Copy for the opening-stage push. Omitted = the ladder opens silently (in-app row only later). */
  notify?: { title: string; body: string }
}

/** A producer of currently-due, unconfirmed slots. Called by the cron sweep with an injected
 *  db/env/clock. Sources should be cheap and bounded — they run every tick. */
export type EscalationSource = (db: DB, env: Env, now: Date) => Promise<EscalationSlot[]>

/**
 * Apps register due-slot computers here AT MODULE LOAD (side-effect-free import — registering is
 * intent; sources only run inside the cron sweep). DEFAULT EMPTY: the sweep opens nothing until
 * an app pushes a source, so the chassis carries zero cron cost. RxMndr ancestor: cron.ts step 3
 * computes today's + yesterday's due dose slots per person (computed-not-materialized — pair a
 * source with worker/lib/scheduling.ts, never pre-write future slots to the DB).
 *
 * @example — in an app's worker module, imported once by its routes:
 *   escalationSources.push(async (db, env, now) => computeOverdueChoreSlots(db, now))
 */
export const escalationSources: EscalationSource[] = []

/**
 * SMS recipient resolution (M-6). The chassis has no phone-number column, so the DEFAULT resolver
 * returns [] — no SMS ever leaves a stock mint. An app with verified phone numbers overrides the
 * MUTABLE PROPERTY at module load (same pattern as B3's `reportLoaders` / B5's `providerPullers`):
 *
 *   smsRecipientResolver.resolve = async (db, orgId, esc) => loadVerifiedPhones(db, orgId)
 *
 * A mutable-property object (not a reassignable `export let`) because importers cannot write
 * another ESM module's live binding — assignment through the object is the only contract that
 * actually works. Return E.164 phone strings; the engine handles cap + dormancy + latching.
 */
export const smsRecipientResolver = {
  resolve: (async (_db: DB, _orgId: string, _esc: Escalation) => []) as (
    db: DB,
    orgId: string,
    esc: Escalation,
  ) => Promise<string[]>,
}

// ---------------------------------------------------------------------------
// Stage math (pure)
// ---------------------------------------------------------------------------

/**
 * Cumulative entry offsets (ms past scheduledFor) per stage index: stage 0 at 0, stage i at
 * Σ dwellMinutes(stages[0..i-1]). A stage whose PRECEDING stage has no dwell key gets Infinity —
 * the ladder can never advance past an unconfigured dwell (fail-safe: stall, don't guess).
 * The terminal stage needs no dwell key of its own (nothing comes after it).
 */
function stageOffsetsMs(stages: readonly string[], dwellMinutes: Record<string, number>): number[] {
  const offsets: number[] = [0]
  for (let i = 1; i < stages.length; i++) {
    const dwell = dwellMinutes[stages[i - 1]]
    offsets.push(
      Number.isFinite(dwell) && (dwell as number) >= 0
        ? offsets[i - 1] + (dwell as number) * MIN_MS
        : Number.POSITIVE_INFINITY,
    )
  }
  return offsets
}

// ---------------------------------------------------------------------------
// sweepEscalations — open ladders for newly due slots (cron step, STAGE0 §9)
// ---------------------------------------------------------------------------

/**
 * For each app-registered source, collect due slots and INSERT a fresh escalation for every
 * past-due one (currentStage = stages[0], stamped now). Idempotent via `escalation_slot_idx` +
 * onConflictDoNothing — the sweep can re-run forever without duplicating a ladder, and a slot
 * the user already resolved stays closed because sources only emit UNCONFIRMED slots.
 *
 * A newly opened ladder with `notify` copy fans the opening push out to every live org member
 * (the chassis' only generic audience — apps with finer audiences shape it in their source's
 * copy, or resolve recipients app-side before registering).
 */
export async function sweepEscalations(db: DB, env: Env, now: Date): Promise<{ opened: number }> {
  const { stages } = APP_CONFIG.safety.escalation
  if (stages.length === 0) return { opened: 0 }
  const openingStage = stages[0]

  let opened = 0
  const memberCache = new Map<string, string[]>()

  for (const source of escalationSources) {
    let slots: EscalationSlot[] = []
    try {
      slots = await source(db, env, now)
    } catch (e) {
      // One bad source never starves the others.
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'escalation.source_failed',
          message: e instanceof Error ? e.message : String(e),
        }),
      )
      continue
    }

    for (const slot of slots) {
      // Only past-due slots can escalate; a future slot isn't late yet.
      if (slot.scheduledFor.getTime() > now.getTime()) continue
      try {
        const [row] = await db
          .insert(schema.escalation)
          .values({
            organizationId: slot.organizationId,
            subjectId: slot.subjectId ?? null,
            entityType: slot.entityType,
            entityId: slot.entityId,
            scheduledFor: slot.scheduledFor,
            currentStage: openingStage,
            stageTimestamps: { [openingStage]: now.toISOString() },
          })
          .onConflictDoNothing({
            target: [
              schema.escalation.organizationId,
              schema.escalation.entityType,
              schema.escalation.entityId,
              schema.escalation.scheduledFor,
            ],
          })
          .returning({ id: schema.escalation.id })
        if (!row) continue // conflict — this slot's ladder already exists
        opened++

        // Opening push, only when the source supplied copy (the app knows what "X is due" means).
        if (slot.notify) {
          await fanOutToMembers(db, env, memberCache, slot.organizationId, {
            kind: `escalation.${openingStage}`,
            title: slot.notify.title,
            body: slot.notify.body,
            escalationId: row.id,
          })
        }
      } catch (e) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'escalation.open_failed',
            orgId: slot.organizationId,
            entityType: slot.entityType,
            message: e instanceof Error ? e.message : String(e),
          }),
        )
      }
    }
  }

  return { opened }
}

// ---------------------------------------------------------------------------
// advanceEscalations — pace every open ladder to its cumulative target (cron step)
// ---------------------------------------------------------------------------

/**
 * Load every UNRESOLVED escalation and advance each to its cumulative-from-scheduledFor target
 * stage (see the module doc). Per row:
 *
 *   snoozed (now < snoozedUntil)     → skip entirely; the ladder catches up after the snooze.
 *   unknown currentStage vocab       → structured warn, no advance, NO crash (a config edit
 *                                      mid-flight must never wedge the cron).
 *   stage(s) crossed                 → stamp every entered stage; push ONE notification for the
 *                                      deepest stage reached (not one per stage — a 6-hour catch-up
 *                                      must not fire three pushes at once; divergence from RxMndr,
 *                                      whose per-stage audiences differed).
 *   crossing `smsStage`              → SMS once (smsSentAt latch), dormant-safe + daily-capped.
 *   reaching the terminal stage      → resolvedAt = now, resolution = 'missed' — the row leaves
 *                                      the unresolved set; the app reads resolution='missed' for
 *                                      its own domain bookkeeping (RxMndr wrote a doseEvent here;
 *                                      the chassis has no domain table to write).
 */
export async function advanceEscalations(
  db: DB,
  env: Env,
  now: Date,
): Promise<{ advanced: number; missed: number }> {
  const { stages, dwellMinutes, smsStage } = APP_CONFIG.safety.escalation
  if (stages.length === 0) return { advanced: 0, missed: 0 }
  const offsets = stageOffsetsMs(stages, dwellMinutes)
  const terminalIdx = stages.length - 1

  // Bounded per run — a pathological backlog drains across ticks instead of blowing the cron.
  // Oldest scheduledFor FIRST: an unordered LIMIT lets Postgres return an arbitrary 500, so under
  // a >500-row backlog the most-overdue safety ladders could be starved indefinitely by snoozed /
  // not-yet-due / unknown-stage rows squatting the window. Ordering makes the drain deterministic.
  const rows = await db
    .select()
    .from(schema.escalation)
    .where(isNull(schema.escalation.resolvedAt))
    .orderBy(asc(schema.escalation.scheduledFor))
    .limit(500)

  let advanced = 0
  let missed = 0
  const memberCache = new Map<string, string[]>()

  for (const esc of rows) {
    // Snoozed into the future — defer the whole ladder until snoozedUntil passes.
    if (esc.snoozedUntil && esc.snoozedUntil.getTime() > now.getTime()) continue

    const currentIdx = stages.indexOf(esc.currentStage)
    if (currentIdx === -1) {
      // Stage vocabulary drifted under an open row (config edit mid-flight). Never crash, never
      // guess — leave the row for a human/migration and say so once per tick.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'escalation.unknown_stage',
          escalationId: esc.id,
          orgId: esc.organizationId,
          currentStage: esc.currentStage,
        }),
      )
      continue
    }

    // Per-row isolation (mirrors sweepEscalations' per-slot guard): the state-committing db.update
    // calls below fail transiently under load (Neon blip, serialization error, statement timeout).
    // For a SAFETY ladder one flaky row must NEVER abort advancement — including a terminal 'missed'
    // resolution — for every remaining unresolved escalation this tick. Swallow + log + continue so
    // the rest of the sweep drains and the failed row simply retries next tick (the module doctrine
    // at the top: everything here is best-effort; a failure must never break the sweep).
    try {
      // Deepest stage whose cumulative offset has elapsed (the M-4 pacing model).
      const elapsed = now.getTime() - esc.scheduledFor.getTime()
      let targetIdx = 0
      for (let i = 0; i < stages.length; i++) {
        if (elapsed >= offsets[i]) targetIdx = i
      }
      if (targetIdx <= currentIdx) continue // nothing new has elapsed

      // Stamp every stage entered this tick (audit trail — never the pacing input), and note
      // whether this tick CROSSES smsStage — the send itself happens only after the commit.
      const stamps: Record<string, string> = { ...(esc.stageTimestamps ?? {}) }
      let crossesSmsStage = false
      for (let i = currentIdx + 1; i <= targetIdx; i++) {
        const stage = stages[i]
        if (!stamps[stage]) stamps[stage] = now.toISOString()
        if (smsStage && stage === smsStage && !esc.smsSentAt) crossesSmsStage = true
      }

      const target = stages[targetIdx]
      const isTerminal = targetIdx === terminalIdx

      // ── COMMIT BEFORE SIDE EFFECTS ────────────────────────────────────────────────────────────
      // The state write is the FIRST thing that happens for a crossing row. If it lands and a
      // later side effect is lost (isolate eviction, notify hiccup) the ladder is merely quieter
      // than ideal — at-most-once, the declared semantics. The reverse order (send, THEN commit)
      // is the dangerous one: a transient update failure after a real Twilio fan-out would leave
      // currentStage/smsSentAt unstamped, and the next tick would re-cross smsStage and re-send to
      // EVERY recipient — a paid, repeated fan-out bounded only by the daily cap (which itself
      // fails open on a KV outage). The currentStage guard in the WHERE also de-dupes overlapping
      // runners: whichever run commits the crossing owns its side effects; the loser matches zero
      // rows and skips them.
      const [committed] = await db
        .update(schema.escalation)
        .set(
          isTerminal
            ? // Hard miss: resolve the row — it leaves the unresolved set on the next sweep.
              { currentStage: target, stageTimestamps: stamps, resolvedAt: now, resolution: 'missed' }
            : { currentStage: target, stageTimestamps: stamps },
        )
        .where(
          and(
            eq(schema.escalation.organizationId, esc.organizationId),
            eq(schema.escalation.id, esc.id),
            eq(schema.escalation.currentStage, esc.currentStage),
            isNull(schema.escalation.resolvedAt),
          ),
        )
        .returning({ id: schema.escalation.id })
      if (!committed) continue // a concurrent runner advanced/resolved this row — its crossing, its sends
      advanced++
      if (isTerminal) missed++

      // SMS fires on ENTRY of smsStage, at most once per ladder. The crossing was consumed by the
      // commit above (currentStage is now at/past smsStage), so even if the latch write below is
      // lost the send can never repeat — a failed/skipped attempt does NOT retry on later ticks;
      // the paid channel stays deterministic: at most one fan-out per escalation, ever.
      if (crossesSmsStage) {
        const smsSentAt = await trySmsFallback(db, env, esc, now)
        if (smsSentAt) {
          try {
            // Best-effort bookkeeping (the honest "when SMS actually left" stamp + belt-and-braces
            // latch). Its own try: a transient failure here must not eat the push below.
            await db
              .update(schema.escalation)
              .set({ smsSentAt })
              .where(and(eq(schema.escalation.id, esc.id), isNull(schema.escalation.smsSentAt)))
          } catch (e) {
            console.warn(
              JSON.stringify({
                level: 'warn',
                event: 'escalation.sms_latch_failed',
                escalationId: esc.id,
                orgId: esc.organizationId,
                message: e instanceof Error ? e.message : String(e),
              }),
            )
          }
        }
      }

      // One push per row-tick, for the deepest stage reached. Generic chassis copy — entityType is
      // an app slug ('chore', 'dose'), which reads acceptably; apps wanting richer copy put it in
      // the OPENING notify (sweep) where they control the text. Best-effort (never throws).
      await fanOutToMembers(db, env, memberCache, esc.organizationId, {
        kind: `escalation.${target}`,
        title: isTerminal ? `Missed — ${esc.entityType}` : `Still unconfirmed — ${esc.entityType}`,
        body: isTerminal
          ? `A scheduled ${esc.entityType} was never confirmed and has been marked missed.`
          : `A scheduled ${esc.entityType} still needs attention.`,
        escalationId: esc.id,
      })
    } catch (e) {
      // A transient DB error on THIS row aborts only this row — the ladder advance retries next
      // tick. Because the commit is the FIRST effectful step, a failure here means no push and no
      // SMS ever left for this crossing: the retry is a clean first attempt, never a duplicate.
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'escalation.advance_failed',
          escalationId: esc.id,
          orgId: esc.organizationId,
          message: e instanceof Error ? e.message : String(e),
        }),
      )
      continue
    }
  }

  return { advanced, missed }
}

// ---------------------------------------------------------------------------
// resolveEscalation / snoozeEscalation — the route-facing lifecycle verbs
// ---------------------------------------------------------------------------

/**
 * Close an open escalation ('confirmed' = the underlying thing got done; 'dismissed' = a human
 * waved it off; 'missed'/'auto' for engine/domain use). Org-scoped on the WRITE — a caller can
 * only resolve their own org's rows. Returns the resolved row, or undefined when no OPEN
 * escalation matched (already resolved, wrong org, or unknown id) — idempotent by construction.
 */
export async function resolveEscalation(
  db: DB,
  orgId: string,
  id: string,
  resolution: 'confirmed' | 'dismissed' | 'missed' | 'auto',
  now: Date = new Date(),
): Promise<Escalation | undefined> {
  const [updated] = await db
    .update(schema.escalation)
    .set({ resolvedAt: now, resolution })
    .where(
      and(
        eq(schema.escalation.id, id),
        eq(schema.escalation.organizationId, orgId),
        isNull(schema.escalation.resolvedAt),
      ),
    )
    .returning()
  return updated
}

/**
 * Snooze: pause ADVANCEMENT (not the record) until `until` — advanceEscalations skips the row
 * while `now < snoozedUntil`, then the ladder catches up cumulatively from scheduledFor. The
 * escalation stays unresolved and keeps its stage; the route caps `until` (≤ 24h out) so a
 * snooze can never silence a safety ladder indefinitely.
 */
export async function snoozeEscalation(
  db: DB,
  orgId: string,
  id: string,
  until: Date,
): Promise<Escalation | undefined> {
  const [updated] = await db
    .update(schema.escalation)
    .set({ snoozedUntil: until })
    .where(
      and(
        eq(schema.escalation.id, id),
        eq(schema.escalation.organizationId, orgId),
        isNull(schema.escalation.resolvedAt),
      ),
    )
    .returning()
  return updated
}

// ---------------------------------------------------------------------------
// Internals — push fan-out + the SMS attempt
// ---------------------------------------------------------------------------

/**
 * Fan a push/in-app notification out to every LIVE (non-archived) member of the org — the only
 * generic audience the chassis knows. Cached per run so N escalations in one org cost one member
 * read. Best-effort end to end: a notify failure never breaks the sweep.
 */
async function fanOutToMembers(
  db: DB,
  env: Env,
  cache: Map<string, string[]>,
  orgId: string,
  message: { kind: string; title: string; body: string; escalationId: string },
): Promise<void> {
  try {
    let userIds = cache.get(orgId)
    if (!userIds) {
      const members = await db
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(and(eq(schema.member.organizationId, orgId), isNull(schema.member.archivedAt)))
      userIds = members.map((m) => m.userId)
      cache.set(orgId, userIds)
    }
    for (const userId of userIds) {
      // notify() itself never throws (structured-logs instead) — the try here covers the read.
      await notify(db, env, {
        organizationId: orgId,
        userId,
        kind: message.kind,
        title: message.title,
        body: message.body,
        entityType: 'escalation',
        entityId: message.escalationId,
      })
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'escalation.notify_failed',
        orgId,
        escalationId: message.escalationId,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
  }
}

/**
 * One SMS fan-out attempt for a ladder entering `smsStage`. Returns the latch value: `now` when
 * at least one message actually went out, else null (dormant / no recipients / capped / all
 * failed). EVERY step is best-effort — an SMS, KV, or resolver failure must never break the
 * sweep; the ladder itself still advances (push/in-app only).
 *
 * The body is deliberately generic and PII-free (SMS is unencrypted transport): app identity +
 * a pointer back into the app, nothing about WHAT was missed. Config-driven identity — the copy
 * follows APP_CONFIG, never a hardcoded brand.
 */
async function trySmsFallback(db: DB, env: Env, esc: Escalation, now: Date): Promise<Date | null> {
  if (!smsConfigured(env)) return null // dormant — the stock-mint common case

  try {
    const recipients = await smsRecipientResolver.resolve(db, esc.organizationId, esc)
    if (recipients.length === 0) return null // chassis default — no phone numbers exist

    const body = `${APP_CONFIG.name}: a scheduled item still needs attention. Open ${APP_CONFIG.url}`

    let anySent = false
    for (const to of recipients) {
      // The daily cap is consulted before EVERY send (M-5) — it also brakes mid-fan-out.
      if (!(await smsAllowed(env, esc.organizationId, now))) break
      const result = await sendSms(env, to, body, { organizationId: esc.organizationId })
      if (result.ok) {
        anySent = true
        await recordSmsSent(env, esc.organizationId, now)
      }
    }

    if (anySent) {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'escalation.sms_sent',
          orgId: esc.organizationId,
          escalationId: esc.id,
          recipients: recipients.length,
        }),
      )
      return now
    }
    return null
  } catch (e) {
    // Any failure in the SMS path is swallowed — the escalation ladder itself must advance.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'escalation.sms_error',
        orgId: esc.organizationId,
        escalationId: esc.id,
        message: e instanceof Error ? e.message : String(e),
      }),
    )
    return null
  }
}
