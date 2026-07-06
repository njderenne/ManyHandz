import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import type { Env } from '../env'
import { notify } from '../notify'

/**
 * Prompt/nudge engine — keepsey's prompt module generalized to the chassis `prompt_state` table
 * (subjectId nullable: null = an org-level prompt track for apps without subjects). Prompt
 * DEFINITIONS live IN CODE below (the achievements doctrine — copy changes ship with a Worker
 * deploy, never a migration); only rotation state (served keys, cadence, packs) is data.
 *
 * Three content rules are LOAD-BEARING (copied from the donor, keepsey/worker/prompts/catalog.ts —
 * they were verified product findings, not style):
 *
 *   1. NON-REPEATING. The donor category's verified hate cluster is recycled prompts (Qeepsake's
 *      "bathtime question at least once a month"). selectPrompts() excludes every key in
 *      servedPromptKeys, and a key lands there whether the prompt was ANSWERED or SKIPPED —
 *      skipping is free and final, never re-nagged.
 *   2. NO GUILT. No "you missed X", no streak language, no catch-up shaming, anywhere in prompt
 *      or nudge copy. A user's PPD got worse from daily prompt nagging (verified, r/workingmoms)
 *      — tone is a release gate here, not a style preference.
 *   3. PACK-SAFE SELECTION. Only packs the state has enabled are ever served. Sensitive packs
 *      (journeys, conditions, life situations) are opt-in by the user and their existence must
 *      never leak into core-pack copy — a prompt must make sense to someone who never enabled
 *      the pack it lives in.
 *
 * Keys are dot-namespaced (`pack.slug`), stable forever once shipped — they are stored in
 * prompt_state.servedPromptKeys, so renaming a key would resurrect a served prompt. Add new keys
 * freely; never reuse or rename old ones.
 *
 * The cron half (`sendPromptNudges`, STAGE0 §9) is one of the two sanctioned I/O shells in this
 * directory (README.md): the pure core — catalog, selectPrompts, isDueState, runPromptNudges —
 * decides everything; the shell only queries, advances, and fans out through notify().
 */

// ---------------------------------------------------------------------------
// Catalog — in-code, versioned by deploy. Apps REPLACE the demo 'core' pack.
// ---------------------------------------------------------------------------

export type PromptDef = {
  /** Stable, dot-namespaced, write-once key — stored in DB rows, never renamed (header rule). */
  key: string
  /** The pack this prompt belongs to — must equal its PROMPT_CATALOG map key. */
  pack: string
  text: string
}

/**
 * pack → prompts, in serving order. The template ships one neutral 'core' pack that demos the
 * engine end to end — a minted app replaces the content (and adds packs) without touching the
 * machinery. Every prompt below honors content rule 2: offers, never owes.
 */
export const PROMPT_CATALOG: Record<string, PromptDef[]> = {
  core: [
    {
      key: 'core.getting-started',
      pack: 'core',
      text: 'What made you pick this app up? A sentence now is a nice thing to find later.',
    },
    {
      key: 'core.this-week',
      pack: 'core',
      text: 'What’s one small thing from this week worth putting on the record?',
    },
    {
      key: 'core.ordinary-moment',
      pack: 'core',
      text: 'Describe one ordinary moment from today — the unglamorous details age the best.',
    },
    {
      key: 'core.looking-forward',
      pack: 'core',
      text: 'What are you looking forward to right now, big or small?',
    },
    {
      key: 'core.changed-lately',
      pack: 'core',
      text: 'What’s something that has changed lately that you’d like to remember noticing?',
    },
    {
      key: 'core.good-and-hard',
      pack: 'core',
      text: 'What’s good right now, and what’s hard right now? Both belong on the page.',
    },
    {
      key: 'core.small-win',
      pack: 'core',
      text: 'Any small win lately that nobody else would think to celebrate?',
    },
    {
      key: 'core.snapshot-in-words',
      pack: 'core',
      text: 'Take a snapshot in words: where are you, and what does right now look like?',
    },
  ],
}

/** Every key in the catalog — routes validate client-sent promptKeys against this set. */
export function catalogKeys(catalog: Record<string, PromptDef[]> = PROMPT_CATALOG): Set<string> {
  const keys = new Set<string>()
  for (const prompts of Object.values(catalog)) for (const p of prompts) keys.add(p.key)
  return keys
}

/** The slice of prompt_state the selector reads — routes and cron both pass rows straight in. */
export type PromptSelectionState = {
  packKeys: string[]
  servedPromptKeys: string[]
}

/**
 * Pick the next `n` prompts for a state. PURE + DETERMINISTIC — the /next route and the cron
 * nudge preview the exact same prompt because they share this one selector (keepsey's law: the
 * route and the cron can never disagree about "the next prompt").
 *
 * Order: packs in the state's packKeys order (dupes ignored, unknown packs skipped — packKeys
 * is user data and the catalog evolves), catalog order within a pack, served keys excluded
 * outright (content rule 1), unknown served keys ignored (a removed pack must not wedge state).
 */
export function selectPrompts(
  state: PromptSelectionState,
  catalog: Record<string, PromptDef[]> = PROMPT_CATALOG,
  n = 1,
): PromptDef[] {
  if (n <= 0) return []
  const served = new Set(state.servedPromptKeys)
  const seenPacks = new Set<string>()
  const picked: PromptDef[] = []
  for (const pack of state.packKeys) {
    if (seenPacks.has(pack)) continue
    seenPacks.add(pack)
    for (const prompt of catalog[pack] ?? []) {
      if (served.has(prompt.key)) continue
      picked.push(prompt)
      if (picked.length >= n) return picked
    }
  }
  return picked
}

// ---------------------------------------------------------------------------
// Cadence windows — the pure twin of the cron's SQL due-filter
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

/** Cadence → how long after the last touch a nudge becomes due. 'off' never appears here. */
export const CADENCE_WINDOW_MS: Record<'daily' | 'weekly', number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
}

/** The slice of prompt_state the due-check reads. */
export type CadenceState = {
  /** 'daily' | 'weekly' | 'off' (TEXT column — unknown values read as not due, fail-quiet). */
  cadence: string
  lastServedAt: Date | null
  createdAt: Date
}

/**
 * Is this state due for a nudge at `now`? The PURE TWIN of the SQL filter in sendPromptNudges —
 * keep the two in sync (the loop re-checks with this defensively, so a drifted SQL filter can
 * over-fetch but never over-send).
 *
 * The anchor is lastServedAt, falling back to createdAt for a state that has never served — a
 * FRESH state gets its first nudge one FULL window after creation, never on the next tick
 * (gentle by construction, content rule 2). 'off' (and any unknown cadence) is silence.
 */
export function isDueState(state: CadenceState, now: Date): boolean {
  if (state.cadence !== 'daily' && state.cadence !== 'weekly') return false
  const anchor = state.lastServedAt ?? state.createdAt
  return now.getTime() - anchor.getTime() >= CADENCE_WINDOW_MS[state.cadence]
}

// ---------------------------------------------------------------------------
// Cron — sendPromptNudges (STAGE0 §9) over an injectable I/O seam
// ---------------------------------------------------------------------------

/** Hard cap on notify() calls per run (one call = one member's devices). The rest wait a tick. */
const MAX_NUDGES_PER_RUN = 200

/** Bound the candidate scan itself — the cap above bounds sends; this bounds the query. */
const MAX_DUE_STATES = 500

/** One due prompt_state row, flattened with its (optional) subject's display name. */
export type DuePromptState = {
  id: string
  organizationId: string
  subjectId: string | null
  cadence: string
  packKeys: string[]
  servedPromptKeys: string[]
  lastServedAt: Date | null
  createdAt: Date
  /** Resolved subject display name — null for the org-level track (or a vanished subject). */
  subjectName: string | null
}

/**
 * The I/O seam — everything sendPromptNudges touches outside its own logic. Tests inject a fake
 * (nudge.test.ts proves advance-before-send, caps, and cadence silence against it); production
 * uses realNudgeIo(). Same testability move as the escalation engine's injectable `now`.
 */
export type NudgeIo = {
  /** Due states at `now` (the SQL twin of isDueState), bounded by MAX_DUE_STATES. */
  listDue: (now: Date) => Promise<DuePromptState[]>
  /** Stamp lastServedAt = now (org-scoped write — cron is not exempt from rule 4). */
  advance: (state: DuePromptState, now: Date) => Promise<void>
  /** userIds to nudge for an org: its LIVE owner/admin members (archived members excluded). */
  recipients: (organizationId: string) => Promise<string[]>
  /** Deliver one nudge (notify(): in-app row + push fan-out, per-user opt-out, never throws). */
  deliver: (state: DuePromptState, userId: string, prompt: PromptDef) => Promise<void>
}

/**
 * The orchestration core — pure over its I/O seam, so every guarantee is unit-tested:
 *
 *   - ONE nudge per cadence window per state; the window ADVANCES BEFORE any send, so a crash
 *     (or a 6h cron tick racing itself) can never double-send inside a window. A nudge lost to
 *     a crash-after-advance is the accepted cost — under-nudging is always the right failure
 *     mode for a gentle feature (content rule 2).
 *   - The nudged prompt is NOT marked served — only the user answering or skipping does that
 *     (routes/prompts.ts), so the push previews exactly what /next will offer.
 *   - Exhausted catalogs are skipped quietly (nothing to offer → say nothing; lastServedAt
 *     stays put so new catalog content makes the state due again).
 *   - The run is capped at MAX_NUDGES_PER_RUN sends — an unbounded fan-out is an abuse of the
 *     push channel even with good intentions. The cap check runs BEFORE advancing a state, so
 *     un-nudged states keep their stale anchor and the next tick picks them up first.
 *   - Per-state try/catch — one bad row never starves the rest (the cron step contract).
 *
 * Returns the STAGE0 §9 shape: nudged = states advanced + delivered; skipped = due states that
 * got nothing this run (exhausted + capped + failed).
 */
export async function runPromptNudges(
  now: Date,
  io: NudgeIo,
): Promise<{ nudged: number; skipped: number }> {
  const due = await io.listDue(now)

  let nudged = 0
  let skipped = 0
  let notified = 0
  let capped = false

  // Recipient lists are per-ORG, states are per-subject — cache so an org with 30 subject
  // tracks resolves its member list once, not 30 times.
  const recipientCache = new Map<string, string[]>()

  for (let i = 0; i < due.length; i++) {
    const state = due[i]
    try {
      // Defensive re-check via the pure twin — a drifted SQL filter must not over-send.
      if (!isDueState(state, now)) {
        skipped++
        continue
      }

      // The SAME deterministic selector the /next route uses (keepsey's law, header).
      const [prompt] = selectPrompts(state, PROMPT_CATALOG, 1)
      if (!prompt) {
        skipped++ // exhausted — nothing to offer, so say nothing; anchor stays put
        continue
      }

      let recipients = recipientCache.get(state.organizationId)
      if (!recipients) {
        recipients = await io.recipients(state.organizationId)
        recipientCache.set(state.organizationId, recipients)
      }

      // Cap check BEFORE advancing — never half-nudge an org, and never burn a state's window
      // on a send that won't happen. Stop ENTIRELY (keepsey's rule): the un-nudged states keep
      // their stale anchors, so the next tick starts with them instead of racing this one.
      if (notified + recipients.length > MAX_NUDGES_PER_RUN) {
        capped = true
        skipped += due.length - i // this state + everything after it waits a tick
        break
      }

      // ADVANCE BEFORE SEND — the double-send latch (docblock). Even an org with zero
      // reachable recipients burns its window: silence this window is still this window.
      await io.advance(state, now)
      nudged++

      for (const userId of recipients) {
        await io.deliver(state, userId, prompt)
        notified++
      }
    } catch (e) {
      skipped++
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'prompts.nudge_failed',
          promptStateId: state.id,
          organizationId: state.organizationId,
          message: e instanceof Error ? e.message : String(e),
        }),
      )
    }
  }

  // One structured line per run — counts only, no subject names or prompt text in logs.
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'prompts.nudges_sent',
      due: due.length,
      nudged,
      skipped,
      notified,
      capped,
    }),
  )
  return { nudged, skipped }
}

/** Production I/O — the only code in this module that touches the DB or Expo. */
export function realNudgeIo(env: Env): NudgeIo {
  const db = getDb(env.DATABASE_URL)
  return {
    listDue: async (now) => {
      const dailyCutoff = new Date(now.getTime() - CADENCE_WINDOW_MS.daily)
      const weeklyCutoff = new Date(now.getTime() - CADENCE_WINDOW_MS.weekly)
      // Anchor = lastServedAt, falling back to createdAt (fresh states wait a full window) —
      // the SQL twin of isDueState(); keep the two in sync.
      const anchor = sql`coalesce(${schema.promptState.lastServedAt}, ${schema.promptState.createdAt})`

      const rows = await db
        .select({ state: schema.promptState, subjectName: schema.subject.displayName })
        .from(schema.promptState)
        // LEFT JOIN: org-level tracks (subjectId null) have no subject row. The org-id pairing
        // in the join is belt-and-braces — routes write matching org ids; the join refuses to
        // pair a state with a subject from another tenant even if that invariant ever slipped.
        .leftJoin(
          schema.subject,
          and(
            eq(schema.promptState.subjectId, schema.subject.id),
            eq(schema.promptState.organizationId, schema.subject.organizationId),
          ),
        )
        .where(
          and(
            ne(schema.promptState.cadence, 'off'),
            // Archived subjects are skipped (their schedules stop — subject table doc); the
            // org-level track has no subject and always passes.
            or(isNull(schema.promptState.subjectId), isNull(schema.subject.archivedAt)),
            or(
              and(eq(schema.promptState.cadence, 'daily'), sql`${anchor} < ${dailyCutoff}`),
              and(eq(schema.promptState.cadence, 'weekly'), sql`${anchor} < ${weeklyCutoff}`),
            ),
          ),
        )
        // Oldest anchor FIRST — the fairness the cap comment above promises. An unordered LIMIT
        // lets Postgres return the same arbitrary subset every tick, starving the tail forever
        // under sustained backlog; ordering makes capped-last-tick states genuinely lead the next
        // run (the same fix as integrations/sync.ts listDue).
        .orderBy(asc(anchor))
        .limit(MAX_DUE_STATES)

      return rows.map(({ state, subjectName }) => ({
        id: state.id,
        organizationId: state.organizationId,
        subjectId: state.subjectId,
        cadence: state.cadence,
        packKeys: state.packKeys,
        servedPromptKeys: state.servedPromptKeys,
        lastServedAt: state.lastServedAt,
        createdAt: state.createdAt,
        subjectName,
      }))
    },

    advance: async (state, now) => {
      await db
        .update(schema.promptState)
        .set({ lastServedAt: now })
        .where(
          and(
            eq(schema.promptState.id, state.id),
            // Org-scoped on the write, same as every route — cron is not exempt from rule 4.
            eq(schema.promptState.organizationId, state.organizationId),
          ),
        )
    },

    recipients: async (organizationId) => {
      // The org's LIVE owner/admin members (keepsey's "Parents", generalized) — the people who
      // carry the org's reminder settings. Archived members keep history but get no nudges.
      const rows = await db
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, organizationId),
            inArray(schema.member.role, ['owner', 'admin']),
            isNull(schema.member.archivedAt),
          ),
        )
      return rows.map((r) => r.userId)
    },

    deliver: async (state, userId, prompt) => {
      // Copy offers, never owes (content rule 2): no "you missed", no streaks, no debt.
      await notify(db, env, {
        organizationId: state.organizationId,
        userId,
        kind: 'prompt.nudge',
        title: state.subjectName ? `A prompt for ${state.subjectName}` : 'A little prompt for you',
        body: `When you have a moment: ${prompt.text}`,
        entityType: 'prompt',
        entityId: state.id,
      })
    },
  }
}

/**
 * THE cron entry point (STAGE0 §9 contract: `(env: Env) => Promise<{ nudged; skipped }>`) —
 * wired into worker/cron.ts as one independently try/caught step, guarded by
 * APP_CONFIG.features.prompts (feature off ⇒ the step never runs ⇒ zero cron cost).
 */
export async function sendPromptNudges(env: Env): Promise<{ nudged: number; skipped: number }> {
  return runPromptNudges(new Date(), realNudgeIo(env))
}
