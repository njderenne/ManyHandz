import { Platform } from 'react-native'
import { fetch as expoFetch } from 'expo/fetch'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { apiFetch, ApiError, authHeaders, API_BASE_URL } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { AiChatThread, AiChatMessage } from '@/lib/db/schema'

/**
 * useChat — hooks for multi-turn AI chat (worker/routes/chat.ts). Three patterns meet here:
 *
 *   - useChatThreads / useChatMessages — cursor pagination à la useCreditHistory (threads walk
 *     BACKWARD through recency; messages walk FORWARD through a conversation).
 *   - useCreateThread / useDeleteThread — plain + optimistic mutations à la useNotifications.
 *   - useSendMessage — THE streaming mutation: the user bubble lands in the cache immediately,
 *     the assistant reply accumulates into a placeholder row chunk-by-chunk as the Worker
 *     streams it, and a settled invalidation swaps both for the persisted server rows.
 *
 * Hooks stay toast-free — screens own feedback via per-call options (`mutate(input, { onError })`).
 */

/** Page sizes — must match the Worker's `.limit(…)` (a short page means "no more rows"). */
const THREAD_PAGE_SIZE = 50
const MESSAGE_PAGE_SIZE = 100

const threadsKey = (orgId: string) => queryKeys.organizations.chatThreads(orgId)
const messagesKey = (orgId: string, threadId: string) =>
  queryKeys.organizations.chatMessages(orgId, threadId)

type ThreadsCache = InfiniteData<AiChatThread[], string>
type MessagesCache = InfiniteData<AiChatMessage[], string>

/**
 * The caller's threads, newest activity first, cursor-paginated (the cursor is the lastMessageAt
 * of the last row of the previous page → strictly older). Render with `data?.pages.flat()`.
 */
export function useChatThreads(orgId: string) {
  return useInfiniteQuery({
    queryKey: threadsKey(orgId),
    queryFn: ({ pageParam }) =>
      apiFetch<AiChatThread[]>(
        `/api/organizations/${orgId}/chat/threads${
          pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.length < THREAD_PAGE_SIZE) return undefined // short page = no more rows
      const last = lastPage[lastPage.length - 1]
      if (!last) return undefined
      // Rows arrive JSON-serialized, so lastMessageAt is an ISO string at runtime even though
      // the schema type says Date — `new Date()` normalizes both.
      const at = new Date(last.lastMessageAt)
      if (Number.isNaN(at.getTime())) return undefined
      const next = at.toISOString()
      // Stall guard: each cursor must move STRICTLY older (ISO strings compare chronologically) —
      // a non-decreasing cursor means the server ignored it; stop rather than loop.
      if (lastPageParam && next >= lastPageParam) return undefined
      return next
    },
    enabled: Boolean(orgId),
  })
}

/**
 * One thread's messages, CHRONOLOGICAL, cursor-paginated FORWARD (the cursor is the createdAt of
 * the last row of the previous page → strictly newer). A conversation needs its full history on
 * screen, so the chat screen drains pages on mount (see app/chat/[id].tsx).
 */
export function useChatMessages(orgId: string, threadId: string) {
  return useInfiniteQuery({
    queryKey: messagesKey(orgId, threadId),
    queryFn: ({ pageParam }) =>
      apiFetch<AiChatMessage[]>(
        `/api/organizations/${orgId}/chat/threads/${threadId}/messages${
          pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.length < MESSAGE_PAGE_SIZE) return undefined // short page = no more rows
      const last = lastPage[lastPage.length - 1]
      if (!last) return undefined
      const at = new Date(last.createdAt)
      if (Number.isNaN(at.getTime())) return undefined
      const next = at.toISOString()
      // Stall guard, mirrored for a FORWARD walk: each cursor must move strictly newer.
      if (lastPageParam && next <= lastPageParam) return undefined
      return next
    },
    enabled: Boolean(orgId && threadId),
  })
}

/** Create a thread (optionally pre-titled); navigate on success via per-call `onSuccess`. */
export function useCreateThread(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input?: { title?: string }) =>
      apiFetch<AiChatThread>(`/api/organizations/${orgId}/chat/threads`, {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: threadsKey(orgId) }),
  })
}

/**
 * Delete a thread (messages cascade server-side). Optimistic: the row leaves the cached list
 * immediately, comes back on error, and the messages cache for that thread is dropped on success.
 */
export function useDeleteThread(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (threadId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/chat/threads/${threadId}`, {
        method: 'DELETE',
      }),
    onMutate: async (threadId) => {
      await queryClient.cancelQueries({ queryKey: threadsKey(orgId) })
      const previous = queryClient.getQueryData<ThreadsCache>(threadsKey(orgId))
      queryClient.setQueryData<ThreadsCache>(threadsKey(orgId), (data) =>
        data
          ? { ...data, pages: data.pages.map((page) => page.filter((t) => t.id !== threadId)) }
          : data,
      )
      return { previous }
    },
    onError: (_err, _threadId, context) => {
      if (context?.previous) queryClient.setQueryData(threadsKey(orgId), context.previous)
    },
    onSuccess: (_data, threadId) => {
      // The conversation is gone — drop its cache entirely (removal, not invalidation: there is
      // nothing left to refetch, and a stale entry would flash if the id were ever reused).
      queryClient.removeQueries({ queryKey: messagesKey(orgId, threadId) })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: threadsKey(orgId) }),
  })
}

/* ------------------------------------------------------------------------------------------------
 * Send + stream
 * ---------------------------------------------------------------------------------------------- */

/** Local-only ids for the optimistic rows — replaced by server rows on the settled refetch. */
function localId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** A full AiChatMessage shape for the cache — typed rows keep every consumer honest. */
function localMessage(threadId: string, role: 'user' | 'assistant', content: string): AiChatMessage {
  return {
    id: localId(role),
    threadId,
    role,
    content,
    inputTokens: null,
    outputTokens: null,
    provider: null,
    model: null,
    createdAt: new Date(),
  }
}

/** Append rows to the LAST cached page (or seed a first page for a brand-new thread). */
function appendToCache(
  queryClient: QueryClient,
  key: readonly unknown[],
  rows: AiChatMessage[],
): void {
  queryClient.setQueryData<MessagesCache>(key, (data) => {
    if (!data || data.pages.length === 0) return { pages: [rows], pageParams: [''] }
    const pages = data.pages.slice()
    const lastIndex = pages.length - 1
    pages[lastIndex] = [...(pages[lastIndex] ?? []), ...rows]
    return { ...data, pages }
  })
}

/**
 * Replace one cached message's content by id — the per-chunk streaming update. The streaming
 * placeholder always lives in the LAST page (appendToCache appends there), so only that page is
 * rewritten; earlier pages keep their object identity and don't churn on every chunk (a full
 * nested map here costs O(pages × messages) per chunk — a re-render storm on long conversations).
 */
function patchCachedMessage(
  queryClient: QueryClient,
  key: readonly unknown[],
  id: string,
  content: string,
): void {
  queryClient.setQueryData<MessagesCache>(key, (data) => {
    if (!data || data.pages.length === 0) return data
    const lastIndex = data.pages.length - 1
    const lastPage = data.pages[lastIndex] ?? []
    if (!lastPage.some((m) => m.id === id)) return data // row gone (a refetch landed) — skip
    const pages = data.pages.slice()
    pages[lastIndex] = lastPage.map((m) => (m.id === id ? { ...m, content } : m))
    return { ...data, pages }
  })
}

/**
 * Drop cached messages by id — the SURGICAL error rollback. No snapshot restore here on purpose
 * (same reasoning as useMessages header note 3): a snapshot would also erase rows that a
 * concurrent refetch or poll wrote into the cache while the stream was running.
 */
function removeCachedMessages(
  queryClient: QueryClient,
  key: readonly unknown[],
  ids: readonly string[],
): void {
  const drop = new Set(ids)
  queryClient.setQueryData<MessagesCache>(key, (data) =>
    data
      ? { ...data, pages: data.pages.map((page) => page.filter((m) => !drop.has(m.id))) }
      : data,
  )
}

/**
 * What useSendMessage throws on failure — carries the one bit screens need for retry UX.
 * `userMessagePersisted: true` means the Worker accepted the send and stored the user message
 * BEFORE the reply stream broke: the user bubble stays in the cache, and the screen must NOT
 * restore the draft — resending it would duplicate the message server-side. `false` means the
 * send never landed: both optimistic bubbles were rolled back and a draft restore is safe.
 */
export class ChatSendError extends Error {
  readonly userMessagePersisted: boolean
  constructor(cause: unknown, userMessagePersisted: boolean) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'ChatSendError'
    this.userMessagePersisted = userMessagePersisted
  }
}

/**
 * POST the message and consume the streamed reply — the same transport AND callback contract as
 * src/lib/api/stream.ts's streamCompletion (that helper is hard-wired to /api/ai/stream, so the
 * mechanics are mirrored here): `expo/fetch` on native (RN's built-in fetch can't stream response
 * bodies), the global fetch on web, Better-Auth cookie auth, raw text chunks with a TextDecoder
 * flush for split multi-byte sequences.
 *
 * `onChunk` receives each raw DELTA chunk (not the accumulated text) — callers accumulate; the
 * full reply is also the resolved value. `onAccepted` fires once the Worker answered 2xx: the
 * route persists the user message BEFORE it opens the stream (worker/routes/chat.ts), so a 2xx
 * means the user message is durable server-side — useSendMessage keys its error rollback on it.
 */
async function streamChatReply(
  orgId: string,
  threadId: string,
  content: string,
  onChunk: (chunk: string) => void,
  onAccepted?: () => void,
): Promise<string> {
  const url = `${API_BASE_URL}/api/organizations/${orgId}/chat/threads/${threadId}/messages`
  const init = {
    method: 'POST',
    credentials: 'include' as const,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ content }),
  }
  const res = Platform.OS === 'web' ? await fetch(url, init) : await expoFetch(url, init)

  if (!res.ok) {
    let message = res.statusText || 'chat send failed'
    try {
      const data = (await res.json()) as { error?: unknown }
      if (data && typeof data === 'object' && data.error != null) message = String(data.error)
    } catch {
      // non-JSON error body — keep the status text
    }
    throw new ApiError(res.status, message)
  }
  onAccepted?.() // 2xx — the Worker persisted the user message before opening the stream

  const reader = res.body?.getReader()
  if (!reader) throw new ApiError(res.status, 'response body is not streamable')

  let full = ''
  const decoder = new TextDecoder('utf-8')
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    if (text) {
      full += text
      onChunk(text)
    }
  }
  const tail = decoder.decode() // flush any buffered multi-byte sequence
  if (tail) {
    full += tail
    onChunk(tail)
  }
  return full
}

/**
 * Send a message in a thread. Cache choreography:
 *
 *   onMutate    — cancel in-flight reads (a refetch resolving mid-stream would overwrite the
 *                 optimistic rows).
 *   mutationFn  — append the optimistic user bubble + an EMPTY assistant placeholder (empty
 *                 content is the screen's "thinking" signal), then stream: delta chunks
 *                 accumulate locally and each one re-patches the placeholder, so the reply
 *                 grows live in the conversation. On failure the rollback is SURGICAL and
 *                 happens right here (the catch owns the optimistic row ids — that's also why
 *                 there's no onError): if the Worker had already accepted the send, the user
 *                 message is durable server-side, so only the assistant placeholder is removed
 *                 and the error is rethrown as ChatSendError{userMessagePersisted:true} —
 *                 screens keep the user bubble and must not restore the draft. If the send
 *                 never landed, both rows are removed and a draft restore is safe.
 *   onSettled   — invalidate messages (optimistic rows → persisted server rows; the Worker
 *                 persists the assistant message before the stream closes, so the refetch always
 *                 finds it — including partials from a mid-stream provider failure) and threads
 *                 (lastMessageAt moved; the first send also auto-titled the thread).
 *
 * The optimistic append lives in mutationFn — not onMutate — because the stream consumer must
 * patch the placeholder it created; onMutate can't hand ids to mutationFn. The screen serializes
 * sends (input disabled while pending), so the two phases never interleave across calls.
 */
export function useSendMessage(orgId: string, threadId: string) {
  const queryClient = useQueryClient()
  const key = messagesKey(orgId, threadId)
  return useMutation({
    mutationFn: async ({ content }: { content: string }) => {
      const userRow = localMessage(threadId, 'user', content)
      const assistantRow = localMessage(threadId, 'assistant', '')
      appendToCache(queryClient, key, [userRow, assistantRow])
      // streamChatReply reports DELTA chunks (streamCompletion's contract) — accumulate here
      // and patch the placeholder with the full text so far.
      let accumulated = ''
      let userMessagePersisted = false
      try {
        return await streamChatReply(
          orgId,
          threadId,
          content,
          (chunk) => {
            accumulated += chunk
            patchCachedMessage(queryClient, key, assistantRow.id, accumulated)
          },
          () => {
            userMessagePersisted = true
          },
        )
      } catch (err) {
        removeCachedMessages(
          queryClient,
          key,
          userMessagePersisted ? [assistantRow.id] : [userRow.id, assistantRow.id],
        )
        throw new ChatSendError(err, userMessagePersisted)
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key })
      queryClient.invalidateQueries({ queryKey: threadsKey(orgId) })
    },
  })
}
