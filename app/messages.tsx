import { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, View, type ListRenderItemInfo } from 'react-native'
import { router, Stack, useFocusEffect } from 'expo-router'
import { MessageSquare, Send } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { fonts } from '@/lib/config/fonts'
import { cn } from '@/lib/utils'
import { authClient, useSession } from '@/lib/auth/client'
import {
  DEFAULT_CHANNEL,
  useMarkChannelRead,
  useMessages,
  useSendMessage,
  type ChatMessage,
} from '@/lib/query/hooks/useMessages'
import { t } from '@/lib/i18n'

/**
 * Org messages — THE reference for chat-shaped product surfaces. The moving parts every chat
 * screen needs, each in its canonical form:
 *
 *   - INVERTED LIST: data arrives newest-first (worker/routes/messages.ts), which is exactly
 *     what FlatList `inverted` wants — index 0 renders at the bottom (the live end), reaching
 *     the list's "end" means scrolling up into history, so onEndReached pages OLDER.
 *   - POLLING: useMessages refetches every 15s; maintainVisibleContentPosition keeps the
 *     viewport anchored when a poll prepends rows mid-read.
 *   - OPTIMISTIC SEND: the bubble lands instantly (dimmed while pending) via useSendMessage;
 *     failures remove just that bubble, restore the draft, and toast.
 *   - UNREAD: divider anchored where the read cursor stood when the screen LOADED (mark-read
 *     advances the server cursor immediately, so the live cursor can't drive the divider), and
 *     mark-read fires on focus + whenever a newer message lands while focused.
 *   - GROUPING: consecutive rows from one sender share an avatar/name header.
 *
 * This screen is the org's main channel (DEFAULT_CHANNEL). A multi-channel app lifts the
 * channel into a route param (`app/messages/[channel].tsx`) — hooks and Worker already take it.
 */

/** Compact feed timestamp: "now" → "{m}m" → "{h}h" → "{d}d" → locale date for older rows. */
function timeAgo(value: ChatMessage['createdAt']): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) return t('messages.timeNow')
  if (minutes < 60) return t('messages.timeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('messages.timeHours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('messages.timeDays', { count: days })
  return date.toLocaleDateString()
}

/** "New messages" rule — sits above the oldest message the reader hadn't seen on arrival. */
function UnreadDivider() {
  return (
    <View className="flex-row items-center gap-3 px-1 py-2">
      <View className="h-px flex-1 bg-primary" />
      <Text variant="caption" className="text-primary">
        {t('messages.unreadDivider')}
      </Text>
      <View className="h-px flex-1 bg-primary" />
    </View>
  )
}

/**
 * One message row. Rows render upright — FlatList `inverted` flips row ORDER, not row content —
 * so "above the bubble" here is visually above on screen. `older` is the next-older message
 * (index + 1 in newest-first data): a sender change against it starts a new visual group.
 */
function MessageRow({
  item,
  older,
  mine,
  showUnreadDivider,
}: {
  item: ChatMessage
  older: ChatMessage | undefined
  mine: boolean
  showUnreadDivider: boolean
}) {
  const firstOfGroup = !older || older.senderId !== item.senderId
  return (
    <View className={item.pending ? 'opacity-60' : undefined}>
      {showUnreadDivider ? <UnreadDivider /> : null}
      <View
        className={cn(
          'flex-row gap-2 px-1 pb-1',
          firstOfGroup && 'pt-2',
          mine ? 'justify-end' : 'justify-start',
        )}
      >
        {/* Fixed-width avatar lane keeps grouped bubbles left-aligned under their header. */}
        {!mine ? (
          <View className="w-7">
            {firstOfGroup ? (
              <Avatar
                size={28}
                uri={item.sender?.image ?? undefined}
                name={item.sender?.name ?? undefined}
              />
            ) : null}
          </View>
        ) : null}
        <View className={cn('max-w-[80%]', mine ? 'items-end' : 'items-start')}>
          {firstOfGroup ? (
            <View className="mb-0.5 flex-row items-baseline gap-2 px-1">
              {!mine ? (
                <Text
                  variant="caption"
                  className="text-foreground"
                  style={{ fontFamily: fonts.medium }}
                >
                  {/* null sender = deleted account (rows outlive senders — set-null FK). */}
                  {item.sender?.name ?? t('messages.formerMember')}
                </Text>
              ) : null}
              <Text variant="caption">{timeAgo(item.createdAt)}</Text>
            </View>
          ) : null}
          <View
            className={cn(
              'rounded-2xl px-3.5 py-2',
              mine ? 'rounded-br-md bg-primary' : 'rounded-bl-md border border-border bg-card',
            )}
          >
            <Text className={mine ? 'text-primary-foreground' : undefined}>{item.content}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

export default function MessagesScreen() {
  const { toast } = useToast()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''
  const selfId = session?.user.id

  const query = useMessages(orgId, DEFAULT_CHANNEL)
  const sendMessage = useSendMessage(orgId, DEFAULT_CHANNEL)
  const markRead = useMarkChannelRead(orgId, DEFAULT_CHANNEL)

  const [draft, setDraft] = useState('')
  const listRef = useRef<FlatList<ChatMessage>>(null)

  const pages = query.data?.pages
  const messages = useMemo(() => pages?.flatMap((p) => p.messages) ?? [], [pages])

  /**
   * Anchor the unread divider where the cursor stood when data FIRST arrived (epoch ms; null =
   * never read). Lazily captured into a ref because mark-read advances the live cursor moments
   * later — a divider driven by the live value would vanish before the reader saw it.
   */
  const anchorReadAtMs = useRef<number | null | undefined>(undefined)
  if (anchorReadAtMs.current === undefined && query.data) {
    const cursor = query.data.pages[0]?.readCursor
    const ms = cursor ? new Date(cursor.lastReadAt).getTime() : NaN
    anchorReadAtMs.current = Number.isNaN(ms) ? null : ms
  }

  /** Oldest loaded foreign message past the anchor — the divider renders above this row. */
  const firstUnreadId = useMemo(() => {
    const readAt = anchorReadAtMs.current
    if (readAt === undefined || !selfId) return null
    // Newest-first data: walk from the oldest loaded row toward the newest.
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!m || m.pending || m.senderId === selfId) continue
      const at = new Date(m.createdAt).getTime()
      if (Number.isNaN(at)) continue
      if (readAt === null || at > readAt) return m.id
    }
    return null
  }, [messages, selfId])

  // Mark the channel read on focus, and again when a newer message lands while focused (the id
  // dep re-arms the effect; markRead.mutate is referentially stable in TanStack Query v5).
  const newestServerId = messages.find((m) => !m.pending)?.id ?? null
  useFocusEffect(
    useCallback(() => {
      if (!newestServerId) return
      markRead.mutate()
    }, [newestServerId, markRead.mutate]),
  )

  const handleSend = () => {
    if (!session) return
    const content = draft.trim()
    if (!content) return
    setDraft('')
    // Jump to the live end so the sender sees their own bubble land.
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
    sendMessage.mutate(
      {
        content,
        sender: {
          id: session.user.id,
          name: session.user.name,
          image: session.user.image ?? null,
        },
      },
      {
        onError: () => {
          // The optimistic bubble was removed; put the words back unless newer typing exists.
          setDraft((current) => (current.length ? current : content))
          toast({ title: t('messages.sendFailed'), variant: 'error' })
        },
      },
    )
  }

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ChatMessage>) => (
      <MessageRow
        item={item}
        older={messages[index + 1]}
        mine={Boolean(selfId) && item.senderId === selfId}
        showUnreadDivider={item.id === firstUnreadId}
      />
    ),
    [messages, selfId, firstUnreadId],
  )

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('messages.title') }} />
      <PageWrapper scroll={false} edges={['top', 'bottom']}>
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={MessageSquare}
            title={t('messages.signedOutTitle')}
            description={t('messages.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : (
          // A failed background poll must not wipe a readable transcript: only surface the
          // error state when there's nothing cached to show (polling keeps retrying anyway).
          <AsyncBoundary query={{ ...query, isError: query.isError && messages.length === 0 }}>
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              renderItem={renderItem}
              // Inverted only with rows — RN renders ListEmptyComponent upside down otherwise.
              inverted={messages.length > 0}
              className="flex-1"
              contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
              // Anchor the viewport when polls prepend rows; auto-stick to the live end only
              // when the reader is already within ~80px of it.
              maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
              // The "end" of an inverted list is the TOP of the screen — page in older history.
              onEndReached={() => {
                if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage()
              }}
              onEndReachedThreshold={0.4}
              // Footer of an inverted list renders at the visual top — the history-loading slot.
              ListFooterComponent={
                query.isFetchingNextPage ? (
                  <View className="items-center py-3">
                    <Spinner />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View className="flex-1 justify-center">
                  <EmptyState
                    icon={MessageSquare}
                    title={t('messages.emptyTitle')}
                    description={t('messages.emptyBody')}
                  />
                </View>
              }
              keyboardShouldPersistTaps="handled"
            />
            <View className="flex-row items-end gap-2 border-t border-border pt-3">
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder={t('messages.placeholder')}
                accessibilityLabel={t('messages.placeholder')}
                multiline
                maxLength={4000}
                containerClassName="flex-1"
                className="h-auto max-h-28 min-h-11 py-2.5"
              />
              <Button
                icon={Send}
                accessibilityLabel={t('messages.send')}
                loading={sendMessage.isPending}
                disabled={!draft.trim()}
                onPress={handleSend}
                className="h-11 w-11 rounded-full px-0"
              />
            </View>
          </AsyncBoundary>
        )}
      </PageWrapper>
    </>
  )
}
