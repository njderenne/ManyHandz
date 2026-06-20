import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Message, MessageCursor } from '@/lib/db/schema'

/**
 * useMessages — org team chat against worker/routes/messages.ts. Three departures from the
 * canonical useNotifications shape, each forced by the chat domain:
 *
 *   1. POLLING: the infinite query refetches every 15s (REFETCH_INTERVAL_MS) — the Worker can't
 *      hold WebSockets, so "real-time" is a poll (the route header documents the Durable Objects
 *      upgrade path). A refetch re-runs every loaded page; fine for a chat session's page count.
 *   2. PAGE ENVELOPE: pages are `{ messages, readCursor }`, not a bare array — the caller's read
 *      cursor rides along so unread math never needs a second endpoint. Read it via
 *      `data.pages[0]?.readCursor` (every page carries a copy; the first is freshest).
 *   3. SURGICAL ROLLBACK: useSendMessage removes only ITS optimistic row on error instead of the
 *      snapshot/restore in useNotifications — chat sends overlap, and restoring a snapshot would
 *      erase newer in-flight optimistic rows.
 */

/** The app-level default channel — mirrors DEFAULT_CHANNEL in worker/routes/messages.ts. */
export const DEFAULT_CHANNEL = 'general'

/** The client convention for chat freshness — documented in worker/routes/messages.ts. */
export const REFETCH_INTERVAL_MS = 15_000

/** MUST match worker/routes/messages.ts PAGE_SIZE (50) — a short page means we've reached the
 *  end; a mismatch here silently breaks end-of-list detection. */
const PAGE_SIZE = 50

/** Sender summary the Worker joins onto each row (null = deleted account). */
export type MessageSender = { id: string; name: string; image: string | null }

export type ChatMessage = Message & {
  sender: MessageSender | null
  /** Client-only: true while an optimistic send awaits the server — render dimmed. */
  pending?: boolean
}

/** One GET page: a newest-first slice plus the caller's read cursor for unread math. */
export type MessagesPage = { messages: ChatMessage[]; readCursor: MessageCursor | null }

type MessagesData = InfiniteData<MessagesPage, string> | undefined

/**
 * The channel's messages, newest first (feed it straight to an inverted list), cursor-paginated
 * older-ward and polled for new arrivals. `pages.flatMap((p) => p.messages)` is the render list.
 */
export function useMessages(orgId: string, channel = DEFAULT_CHANNEL) {
  return useInfiniteQuery({
    queryKey: queryKeys.organizations.messages(orgId, channel),
    queryFn: ({ pageParam }) =>
      apiFetch<MessagesPage>(
        `/api/organizations/${orgId}/messages?channel=${encodeURIComponent(channel)}${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.messages.length < PAGE_SIZE) return undefined // short page = no more rows
      const last = lastPage.messages[lastPage.messages.length - 1]
      if (!last) return undefined
      const at = new Date(last.createdAt)
      if (Number.isNaN(at.getTime())) return undefined
      const next = at.toISOString()
      // Stall guard: stop ONLY when the cursor exactly repeats (next === lastPageParam) — that
      // means the server ignored the cursor and another fetch would loop on the same page. A
      // broader `>=` stop can end pagination early when same-timestamp rows straddle a page
      // boundary. BOUNDARY CAVEAT: the Worker filters lt(createdAt, cursor), so rows sharing the
      // cursor's exact millisecond are still skipped SERVER-side — the composite (createdAt, id)
      // cursor documented in useCredits.ts is the upgrade path that paginates through such ties.
      if (lastPageParam && next === lastPageParam) return undefined
      return next
    },
    refetchInterval: REFETCH_INTERVAL_MS,
    enabled: Boolean(orgId),
  })
}

/** Apply `fn` to every cached message across all pages; return null from `fn` to drop a row. */
function rewriteMessages(
  data: MessagesData,
  fn: (m: ChatMessage) => ChatMessage | null,
): MessagesData {
  if (!data) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.flatMap((m) => {
        const next = fn(m)
        return next ? [next] : []
      }),
    })),
  }
}

export type SendMessageInput = {
  content: string
  /** The caller's own profile (from the session) — renders the optimistic bubble instantly. */
  sender: MessageSender
}

/**
 * Send a message with an optimistic append: the bubble lands in the cache immediately
 * (`pending: true`), is swapped for the server row on success, and is surgically removed on
 * error (see header note 3). Screens own failure feedback via per-call options:
 * `send.mutate(input, { onError: () => toast(…) })`.
 */
export function useSendMessage(orgId: string, channel = DEFAULT_CHANNEL) {
  const queryClient = useQueryClient()
  const key = queryKeys.organizations.messages(orgId, channel)
  return useMutation({
    // Keyed so concurrent sends can see each other (the isMutating guard in onSettled).
    mutationKey: key,
    mutationFn: (input: SendMessageInput) =>
      apiFetch<ChatMessage>(`/api/organizations/${orgId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ channel, content: input.content }),
      }),
    onMutate: async (input) => {
      // Cancel in-flight polls — a poll resolving mid-mutation would overwrite the append.
      await queryClient.cancelQueries({ queryKey: key })
      // Throwaway id (crypto.randomUUID isn't a global on Hermes) — the server row replaces it.
      const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const optimistic: ChatMessage = {
        id: optimisticId,
        organizationId: orgId,
        threadId: channel,
        senderId: input.sender.id,
        content: input.content,
        mediaId: null,
        createdAt: new Date(),
        sender: input.sender,
        pending: true,
      }
      // Prepend to the FIRST page — data is newest-first, so index 0 is the live end.
      queryClient.setQueryData<InfiniteData<MessagesPage, string>>(key, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page, i) =>
                i === 0 ? { ...page, messages: [optimistic, ...page.messages] } : page,
              ),
            }
          : data,
      )
      return { optimisticId }
    },
    onSuccess: (created, _input, context) => {
      // Swap the optimistic row for the server row in place — real id/createdAt, no refetch.
      queryClient.setQueryData<InfiniteData<MessagesPage, string>>(key, (data) =>
        rewriteMessages(data, (m) => (m.id === context.optimisticId ? created : m)),
      )
    },
    onError: (_err, _input, context) => {
      if (!context) return
      queryClient.setQueryData<InfiniteData<MessagesPage, string>>(key, (data) =>
        rewriteMessages(data, (m) => (m.id === context.optimisticId ? null : m)),
      )
    },
    // Re-sync with the server's truth — but only when THIS is the last send in flight, so a
    // rapid burst settles into one refetch instead of racing earlier sends' invalidations.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: key }) === 1) {
        return queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })
}

/**
 * Advance the caller's read cursor to the channel's latest message (fire on screen focus).
 * No optimistic patch — the action is invisible; the server's cursor row is written into the
 * first page's envelope on success so unread math reflects it without a refetch. Two race
 * guards make that write safe against the 15s poll and against itself:
 *
 *   - onMutate cancels in-flight polls (same as useSendMessage): a poll ISSUED before this
 *     mark-read could resolve after it and overwrite the fresh cursor with its stale snapshot.
 *   - the cursor write is ADVANCE-ONLY: focus re-fires mark-read whenever a newer message lands
 *     (see app/messages.tsx), so calls can overlap and settle out of order — an older response
 *     must never regress a newer cached cursor (mirrors the Worker's GREATEST upsert).
 */
export function useMarkChannelRead(orgId: string, channel = DEFAULT_CHANNEL) {
  const queryClient = useQueryClient()
  const key = queryKeys.organizations.messages(orgId, channel)
  return useMutation({
    mutationFn: () =>
      apiFetch<MessageCursor>(`/api/organizations/${orgId}/messages/read`, {
        method: 'POST',
        body: JSON.stringify({ channel }),
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key })
    },
    onSuccess: (cursor) => {
      queryClient.setQueryData<InfiniteData<MessagesPage, string>>(key, (data) => {
        if (!data) return data
        const nextMs = new Date(cursor.lastReadAt).getTime()
        if (Number.isNaN(nextMs)) return data
        const current = data.pages[0]?.readCursor
        const currentMs = current ? new Date(current.lastReadAt).getTime() : null
        // Advance-only (see docblock): keep the cached cursor when it's already >= this response.
        if (currentMs !== null && !Number.isNaN(currentMs) && currentMs >= nextMs) return data
        return {
          ...data,
          pages: data.pages.map((page, i) => (i === 0 ? { ...page, readCursor: cursor } : page)),
        }
      })
    },
  })
}

/**
 * Unread count over the loaded slice — messages strictly newer than the reader's cursor,
 * excluding their own sends (the Worker advances a sender's cursor on every send). A null
 * cursor (never opened the channel) counts every foreign loaded message. Derived client-side,
 * no extra endpoint — feed it `useMessages` data; pairs with `<UnreadBadge />` placements.
 */
export function unreadMessageCount(data: MessagesData, selfUserId: string | undefined): number {
  if (!data || !selfUserId) return 0
  const cursor = data.pages[0]?.readCursor
  const readMs = cursor ? new Date(cursor.lastReadAt).getTime() : null
  return data.pages.reduce(
    (acc, page) =>
      acc +
      page.messages.reduce((n, m) => {
        if (m.pending || m.senderId === selfUserId) return n
        const at = new Date(m.createdAt).getTime()
        if (Number.isNaN(at)) return n
        return readMs === null || at > readMs ? n + 1 : n
      }, 0),
    0,
  )
}
