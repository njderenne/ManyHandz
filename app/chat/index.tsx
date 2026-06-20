import { useState } from 'react'
import { View, Pressable } from 'react-native'
import { router, Stack } from 'expo-router'
import { ChevronRight, MessageSquare, MessageSquarePlus, Trash2 } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { List } from '@/components/ui/list'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { SwipeableRow } from '@/components/ui/swipeable-row'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { authClient, useSession } from '@/lib/auth/client'
import { useChatThreads, useCreateThread, useDeleteThread } from '@/lib/query/hooks/useChat'
import { t } from '@/lib/i18n'
import type { AiChatThread } from '@/lib/db/schema'

/**
 * Chat threads — the conversation list for the AI assistant (worker/routes/chat.ts). Same screen
 * shape as notifications.tsx: cursor-paginated list, header action, signed-out guard. Each row
 * deep-links to the conversation (app/chat/[id].tsx); swipe-left reveals delete, confirmed by a
 * dialog because the cascade is irreversible.
 */

/**
 * Compact recency timestamp — same scale as the notification feed, so the time keys are shared
 * (notifications.time* are universal abbreviations, not feature copy).
 */
function timeAgo(value: AiChatThread['lastMessageAt']): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) return t('notifications.timeNow')
  if (minutes < 60) return t('notifications.timeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('notifications.timeHours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('notifications.timeDays', { count: days })
  return date.toLocaleDateString()
}

/** One thread row — swipe-left to delete, tap to open. Untitled threads show a placeholder. */
function ThreadRow({
  thread,
  onDelete,
}: {
  thread: AiChatThread
  onDelete: (thread: AiChatThread) => void
}) {
  const colors = useColors()
  const title = thread.title ?? t('chat.untitled')
  return (
    <SwipeableRow
      rightActions={[
        {
          icon: Trash2,
          label: t('common.delete'),
          variant: 'destructive',
          onPress: () => onDelete(thread),
        },
      ]}
    >
      <Pressable
        onPress={() => router.push({ pathname: '/chat/[id]', params: { id: thread.id } })}
        accessibilityRole="button"
        accessibilityLabel={title}
        className="flex-row items-center gap-3 border-b border-border bg-card px-4 py-3.5 active:bg-accent"
      >
        <View className="size-9 items-center justify-center rounded-full bg-accent">
          <MessageSquare color={colors.brand} size={18} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text variant="label" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption">{timeAgo(thread.lastMessageAt)}</Text>
        </View>
        <ChevronRight color={colors.mutedForeground} size={18} />
      </Pressable>
    </SwipeableRow>
  )
}

export default function ChatThreadsScreen() {
  const { toast } = useToast()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''

  const query = useChatThreads(orgId)
  const createThread = useCreateThread(orgId)
  const deleteThread = useDeleteThread(orgId)
  /** Thread awaiting delete confirmation — non-null renders the dialog. */
  const [pendingDelete, setPendingDelete] = useState<AiChatThread | null>(null)

  const threads = query.data?.pages.flat() ?? []

  /** Create an (untitled) thread and land in it — the first send auto-titles it server-side. */
  const startChat = () =>
    createThread.mutate(undefined, {
      onSuccess: (thread) => router.push({ pathname: '/chat/[id]', params: { id: thread.id } }),
      onError: () => toast({ title: t('errors.generic'), variant: 'error' }),
    })

  const confirmDelete = () => {
    if (!pendingDelete) return
    deleteThread.mutate(pendingDelete.id, {
      onError: () => toast({ title: t('errors.generic'), variant: 'error' }),
    })
    // Optimistic close — the row already left the list (useDeleteThread rolls back on error).
    setPendingDelete(null)
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('chat.title'),
          headerRight: () => (
            <Button
              size="sm"
              variant="ghost"
              icon={MessageSquarePlus}
              label={t('chat.newChat')}
              loading={createThread.isPending}
              disabled={!session || !orgId}
              onPress={startChat}
            />
          ),
        }}
      />
      <PageWrapper className="pb-24" onRefresh={() => query.refetch()}>
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={MessageSquare}
            title={t('chat.signedOutTitle')}
            description={t('chat.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : (
          <AsyncBoundary
            query={query}
            isEmpty={threads.length === 0}
            empty={
              <EmptyState
                icon={MessageSquare}
                title={t('chat.emptyTitle')}
                description={t('chat.emptyBody')}
                action={
                  <Button
                    label={t('chat.startChat')}
                    icon={MessageSquarePlus}
                    loading={createThread.isPending}
                    // Same guard as the header button — startChat needs an active org resolved.
                    disabled={!session || !orgId}
                    onPress={startChat}
                  />
                }
              />
            }
          >
            <List>
              {threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} onDelete={setPendingDelete} />
              ))}
            </List>
            {query.hasNextPage ? (
              <Button
                variant="outline"
                label={t('notifications.loadMore')}
                loading={query.isFetchingNextPage}
                onPress={() => query.fetchNextPage()}
                className="self-center"
              />
            ) : null}
          </AsyncBoundary>
        )}
      </PageWrapper>

      <Dialog
        visible={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t('chat.deleteTitle')}
        description={t('chat.deleteBody')}
      >
        <View className="flex-row justify-end gap-3 pt-1">
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setPendingDelete(null)} />
          <Button variant="destructive" label={t('common.delete')} onPress={confirmDelete} />
        </View>
      </Dialog>
    </>
  )
}
