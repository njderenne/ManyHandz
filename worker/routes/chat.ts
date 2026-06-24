import { Hono } from 'hono'
import { streamText } from 'hono/streaming'
import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'
import { createAI } from '../ai'
import { logApiUsage } from '../usage/log'

/**
 * AI chat — multi-turn assistant conversations (ai_chat_thread / ai_chat_message). The reference
 * implementation of a PERSISTED streaming AI feature: notifications.ts's org-scoped resource
 * shape + ai.ts's streaming mechanics, joined by a conversation store.
 *
 * Threads are PER-USER (private): every query scopes by organizationId AND userId — the org is
 * context (quotas, metering, tenancy), not an access grant, so teammates never see each other's
 * chats.
 *
 *   GET    /api/organizations/:orgId/chat/threads                       → caller's threads, newest first, cursor
 *   POST   /api/organizations/:orgId/chat/threads                       { title? } → 201 thread
 *   DELETE /api/organizations/:orgId/chat/threads/:threadId             → delete (messages cascade via FK)
 *   GET    /api/organizations/:orgId/chat/threads/:threadId/messages    → chronological, cursor
 *   POST   /api/organizations/:orgId/chat/threads/:threadId/messages    { content } → streamed assistant reply
 *
 * The send endpoint persists the user message, replays the running conversation to the reason
 * tier, streams the reply as raw text (same no-SSE-framing contract as POST /api/ai/stream —
 * src/lib/api/stream.ts documents the client transport), and persists the assistant message
 * BEFORE the stream closes so the client's settled refetch always finds it.
 *
 * RATE LIMIT: this router mounts under /api/organizations, so the /api/ai/* cap in worker/index.ts
 * does NOT cover it — the mount must add its own cap on the send endpoint (see worker/index.ts).
 */
export const chatRoutes = new Hono<AuthEnv>()

/** Page sizes — mirrored in src/lib/query/hooks/useChat.ts (a short page means "no more rows"). */
const THREAD_PAGE_SIZE = 50
const MESSAGE_PAGE_SIZE = 100

/** Length caps — TEXT columns + per-token provider cost make unbounded input a money bug. */
const CONTENT_MAX = 16_000
const TITLE_MAX = 200

/** Conversation replay window: the last N persisted messages (including the one just sent). */
const CONTEXT_MESSAGES = 30
/** Transcript budget in chars — stays under the 50k prompt cap the /api/ai routes enforce. */
const CONTEXT_CHAR_BUDGET = 48_000
/** Auto-title length: first user message clipped for the thread list. */
const AUTO_TITLE_MAX = 60

/**
 * The chat system prompt. The AI abstraction (worker/ai/index.ts) takes a single prompt string —
 * no messages[] API yet — so the conversation is replayed as a labelled transcript and the system
 * prompt teaches the model to continue it. UPGRADE PATH: when worker/ai grows a messages[] entry
 * point, swap buildPrompt for a real role array; nothing else here changes.
 */
const CHAT_SYSTEM =
  'You are a helpful assistant in a multi-turn chat. The transcript of the conversation so far ' +
  'follows, with each turn labelled "User:" or "Assistant:". Write the next assistant reply to ' +
  "the user's last message. Respond with the reply text only — no speaker label, no preamble."

/**
 * Caller's thread, or null — the ownership gate EVERY per-thread endpoint runs first.
 * INVARIANT: every aiChatMessage query MUST scope via thread ownership (this gate, then the
 * threadId filter). Message rows carry no org/user columns of their own, so a threadId from the
 * URL is NEVER a sufficient filter on its own — and if a future schema change denormalizes
 * org/user onto messages, those columns are still no substitute for this gate.
 */
async function findOwnedThread(
  db: ReturnType<typeof getDb>,
  orgId: string,
  userId: string,
  threadId: string,
) {
  const [thread] = await db
    .select()
    .from(schema.aiChatThread)
    .where(
      and(
        eq(schema.aiChatThread.id, threadId),
        eq(schema.aiChatThread.userId, userId),
        eq(schema.aiChatThread.organizationId, orgId),
      ),
    )
    .limit(1)
  return thread ?? null
}

/**
 * Flatten the replay window into a transcript, newest-first against the char budget so when a
 * conversation outgrows it, the OLDEST turns fall off (persisted system rows — none are written
 * today — fold in as labelled context too, so a thread replays exactly).
 */
function buildPrompt(history: Array<{ role: string; content: string }>): string {
  const lines: string[] = []
  let used = 0
  // The provider's 50k prompt cap covers system + transcript, so reserve CHAT_SYSTEM's share up
  // front — budgeting the transcript alone would let system + transcript overshoot the cap.
  const budget = CONTEXT_CHAR_BUDGET - CHAT_SYSTEM.length
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (!m) continue
    const label = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'
    const line = `${label}: ${m.content}`
    if (used + line.length > budget && lines.length > 0) break
    lines.unshift(line)
    used += line.length
  }
  return lines.join('\n\n')
}

chatRoutes.get('/:orgId/chat/threads', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  // Cursor pagination over lastMessageAt (?cursor=<ISO of the last row seen> → strictly older).
  // Caveat beyond notifications.ts's boundary note: lastMessageAt is MUTABLE (bumped per message),
  // so a thread that gets a new message mid-pagination jumps to page one — fine for a recency
  // list, where "appears at the top again" is exactly the desired behavior.
  const cursor = c.req.query('cursor')
  const cursorDate = cursor ? new Date(cursor) : null
  const scope = and(
    eq(schema.aiChatThread.organizationId, orgId),
    eq(schema.aiChatThread.userId, session.user.id),
    // archivedAt is schema-supported but has no endpoint yet; excluding archived rows now means
    // a future archive action needs no read-side change.
    isNull(schema.aiChatThread.archivedAt),
  )
  const rows = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.aiChatThread)
    .where(
      cursorDate && !Number.isNaN(cursorDate.getTime())
        ? and(scope, lt(schema.aiChatThread.lastMessageAt, cursorDate))
        : scope,
    )
    // id desc as the tiebreaker — keeps the order stable when lastMessageAt collides.
    .orderBy(desc(schema.aiChatThread.lastMessageAt), desc(schema.aiChatThread.id))
    .limit(THREAD_PAGE_SIZE)
  return c.json(rows)
})

chatRoutes.post('/:orgId/chat/threads', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  // typeof guard first — the JSON body is untrusted at runtime, and .trim()/.length on a
  // non-string title would surface as a 500. Absent/null both mean "untitled".
  const { title } = await c.req.json<{ title?: unknown }>().catch(() => ({ title: undefined }))
  if (title !== undefined && title !== null && typeof title !== 'string') {
    return c.json({ error: 'title must be a string' }, 400)
  }
  if (typeof title === 'string' && title.length > TITLE_MAX) {
    return c.json({ error: `title too long (max ${TITLE_MAX} chars)` }, 400)
  }

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.aiChatThread)
    .values({
      // Owner comes from the SESSION, never the body — golden rule 4.
      userId: session.user.id,
      organizationId: orgId,
      // Null title = "untitled"; the first send auto-titles it (see POST /messages below).
      title: typeof title === 'string' ? title.trim() || null : null,
    })
    .returning()
  if (!row) return c.json({ error: 'failed to create thread' }, 500)
  return c.json(row, 201)
})

chatRoutes.delete('/:orgId/chat/threads/:threadId', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')
  const threadId = c.req.param('threadId')

  // Scoping on the WRITE too — the id alone is never trusted. Messages need no explicit delete:
  // ai_chat_message.thread_id is ON DELETE CASCADE (see schema.ts), so the DB removes them.
  const deleted = await getDb(c.env.DATABASE_URL)
    .delete(schema.aiChatThread)
    .where(
      and(
        eq(schema.aiChatThread.id, threadId),
        eq(schema.aiChatThread.userId, session.user.id),
        eq(schema.aiChatThread.organizationId, orgId),
      ),
    )
    .returning({ id: schema.aiChatThread.id })
  if (deleted.length === 0) return c.json({ error: 'thread not found' }, 404)
  return c.json({ ok: true })
})

chatRoutes.get('/:orgId/chat/threads/:threadId/messages', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')
  const threadId = c.req.param('threadId')

  const db = getDb(c.env.DATABASE_URL)
  // Ownership FIRST — every aiChatMessage query MUST scope via thread ownership (findOwnedThread,
  // then the threadId filter); messages have no org/user columns, the thread IS the boundary.
  const thread = await findOwnedThread(db, orgId, session.user.id, threadId)
  if (!thread) return c.json({ error: 'thread not found' }, 404)

  // CHRONOLOGICAL (a conversation reads top-down), so the cursor walks FORWARD:
  // ?cursor=<ISO createdAt of the last row seen> → rows strictly newer.
  const cursor = c.req.query('cursor')
  const cursorDate = cursor ? new Date(cursor) : null
  const scope = eq(schema.aiChatMessage.threadId, threadId)
  const rows = await db
    .select()
    .from(schema.aiChatMessage)
    .where(
      cursorDate && !Number.isNaN(cursorDate.getTime())
        ? and(scope, gt(schema.aiChatMessage.createdAt, cursorDate))
        : scope,
    )
    .orderBy(asc(schema.aiChatMessage.createdAt), asc(schema.aiChatMessage.id))
    .limit(MESSAGE_PAGE_SIZE)
  return c.json(rows)
})

/**
 * Send — persist the user turn, stream the assistant reply, persist it before the stream closes.
 *
 * IDEMPOTENCY: none, by design. The client mutation (useChat.ts useSendMessage) does NOT
 * auto-retry — TanStack Query mutations default to retry: false — so the same content arriving
 * twice means the user MANUALLY re-sent after a failure, and a second persisted user message is
 * the correct record of that. No content-hash/dedupe machinery; an accepted duplicate beats
 * silently swallowing an intentional "send it again".
 */
chatRoutes.post('/:orgId/chat/threads/:threadId/messages', requireOrg, async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')
  const threadId = c.req.param('threadId')

  const body = await c.req.json<{ content?: unknown }>().catch(() => ({ content: undefined }))
  // typeof guard — a non-string content is a caller bug that must 400, not throw on .trim().
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return c.json({ error: 'content is required' }, 400)
  if (content.length > CONTENT_MAX) {
    return c.json({ error: `content too long (max ${CONTENT_MAX} chars)` }, 400)
  }

  const db = getDb(c.env.DATABASE_URL)
  const thread = await findOwnedThread(db, orgId, session.user.id, threadId)
  if (!thread) return c.json({ error: 'thread not found' }, 404)

  // 1. Persist the user message FIRST — it survives even if the provider fails below (the client
  //    re-syncs on settle and offers retry; losing typed input is the one unforgivable chat bug).
  //    A manual retry re-sends the same content and creates a second row — accepted, see the
  //    IDEMPOTENCY note in the handler docblock.
  await db.insert(schema.aiChatMessage).values({ threadId, role: 'user', content })

  // 2. Bump recency, and auto-title an untitled thread from its first user message.
  await db
    .update(schema.aiChatThread)
    .set({ lastMessageAt: new Date() })
    .where(eq(schema.aiChatThread.id, threadId))
  if (!thread.title) {
    // isNull guard against the concurrent-first-send race: two sends can both read title=null
    // above, but only one UPDATE matches this WHERE — the loser is a no-op instead of a
    // last-write-wins overwrite of the title the user already saw.
    await db
      .update(schema.aiChatThread)
      .set({ title: content.replace(/\s+/g, ' ').slice(0, AUTO_TITLE_MAX) })
      .where(and(eq(schema.aiChatThread.id, threadId), isNull(schema.aiChatThread.title)))
  }

  // 3. Replay window: the last CONTEXT_MESSAGES rows (includes the message just persisted),
  //    re-ordered chronologically for the transcript.
  const recent = await db
    .select({ role: schema.aiChatMessage.role, content: schema.aiChatMessage.content })
    .from(schema.aiChatMessage)
    .where(eq(schema.aiChatMessage.threadId, threadId))
    .orderBy(desc(schema.aiChatMessage.createdAt), desc(schema.aiChatMessage.id))
    .limit(CONTEXT_MESSAGES)
  const prompt = buildPrompt(recent.reverse())

  // 4. Stream the reply — same mechanics as POST /api/ai/stream: open the provider stream before
  //    answering so pre-first-byte failures return a real status; metering is fire-and-forget.
  const ai = createAI(c.env)
  const meter = {
    organizationId: orgId,
    userId: session.user.id,
    feature: 'ai.chat',
    provider: ai.providerFor('reason'),
    operation: ai.models.reason,
    unitKind: 'tokens',
  }
  const startedAt = Date.now()

  let streamRes: { chunks: AsyncIterable<string>; usage: () => { inputTokens: number; outputTokens: number } }
  try {
    streamRes = await ai.stream('reason', prompt, { system: CHAT_SYSTEM })
  } catch (e) {
    c.executionCtx.waitUntil(
      logApiUsage(c.env, { ...meter, ok: false, errorCode: 'provider_error', latencyMs: Date.now() - startedAt }),
    )
    // The user message above is already persisted — the client re-syncs and offers retry.
    return c.json({ error: e instanceof Error ? e.message : 'AI request failed' }, 502)
  }

  return streamText(c, async (stream) => {
    let ok = true
    let full = ''
    try {
      for await (const chunk of streamRes.chunks) {
        full += chunk
        await stream.write(chunk)
      }
    } catch {
      // Upstream died mid-stream — keep what arrived; the partial is persisted below so the
      // client never shows text that then vanishes on refetch.
      ok = false
    }
    // 5. Persist the assistant message (with provenance) BEFORE the callback returns — the
    //    stream closes when this callback ends, so by the time the client sees "done" and
    //    invalidates, the row is queryable. waitUntil here would race that refetch.
    if (full) {
      try {
        await db.insert(schema.aiChatMessage).values({
          threadId,
          role: 'assistant',
          content: full,
          provider: meter.provider,
          model: meter.operation,
        })
        await db
          .update(schema.aiChatThread)
          .set({ lastMessageAt: new Date() })
          .where(eq(schema.aiChatThread.id, threadId))
      } catch (e) {
        // ACCEPTED RACE (no locks by design): if the thread is deleted mid-stream, this INSERT
        // fails on the cascading FK and the reply is lost — the thread is gone anyway, so the
        // client's refetch correctly finds nothing. The reply already streamed — log loudly,
        // never crash the close.
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'chat.assistant_persist_failed',
            threadId,
            message: e instanceof Error ? e.message : String(e),
          }),
        )
      }
    }
    const usage = streamRes.usage()
    c.executionCtx.waitUntil(
      logApiUsage(c.env, {
        ...meter,
        ok,
        inputUnits: usage.inputTokens,
        outputUnits: usage.outputTokens,
        errorCode: ok ? null : 'provider_error',
        latencyMs: Date.now() - startedAt,
      }),
    )
  })
})
