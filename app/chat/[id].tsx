import { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { MessageSquare, Send, Sparkles } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { ApiError } from '@/lib/api/client'
import { authClient, useSession } from '@/lib/auth/client'
import {
  ChatSendError,
  useChatMessages,
  useChatThreads,
  useSendMessage,
} from '@/lib/query/hooks/useChat'
import { t } from '@/lib/i18n'
import type { AiChatMessage } from '@/lib/db/schema'

/**
 * Conversation — THE reference chat UI: user bubbles right on the primary surface, assistant
 * bubbles left on the card surface, the reply streaming into its bubble live (useSendMessage
 * patches the cache per chunk), a "thinking" bubble before the first token, an input bar pinned
 * above the keyboard (PageWrapper's KeyboardAvoidingView), and scroll-pinned-to-bottom as content
 * grows. Failed sends restore the draft so typed input is never lost.
 */

/**
 * One message bubble. An assistant row with EMPTY content is the streaming placeholder —
 * rendered as the "thinking" indicator until the first chunk lands (useChat.ts seeds it).
 */
function MessageBubble({ message }: { message: AiChatMessage }) {
  const colors = useColors()
  const isUser = message.role === 'user'
  return (
    <View className={cn('w-full', isUser ? 'items-end' : 'items-start')}>
      <View
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5',
          isUser ? 'rounded-br-md bg-primary' : 'rounded-bl-md border border-border bg-card',
        )}
        accessibilityLabel={isUser ? t('chat.userBubbleA11y') : t('chat.assistantBubbleA11y')}
      >
        {message.content ? (
          <Text variant="body" className={isUser ? 'text-primary-foreground' : undefined}>
            {message.content}
          </Text>
        ) : (
          <View className="flex-row items-center gap-2 py-0.5">
            <Spinner size="small" color={colors.mutedForeground} />
            <Text variant="muted">{t('chat.thinking')}</Text>
          </View>
        )}
      </View>
    </View>
  )
}

export default function ChatConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const threadId = id ?? ''
  const { toast } = useToast()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''

  const threadsQuery = useChatThreads(orgId)
  const messagesQuery = useChatMessages(orgId, threadId)
  const sendMessage = useSendMessage(orgId, threadId)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<ScrollView>(null)

  // The messages endpoint pages FORWARD (chronological); a conversation needs its full history
  // on screen, so drain the remaining pages as they announce themselves. Most threads fit the
  // first page (the Worker's page size is 100), so this rarely runs more than once.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messagesQuery
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const messages = messagesQuery.data?.pages.flat() ?? []
  // Header title: the thread's (possibly auto-set) title, from the already-cached list. Falls
  // back while a cold deep link is still fetching.
  const thread = threadsQuery.data?.pages.flat().find((row) => row.id === threadId)
  const title = thread?.title ?? t('chat.untitled')

  const send = () => {
    const content = draft.trim()
    if (!content || !orgId || !threadId || sendMessage.isPending) return
    setDraft('')
    sendMessage.mutate(
      { content },
      {
        onError: (e) => {
          // Retry path: the draft comes back (typed input is never lost) + an actionable toast.
          // EXCEPT when the user message already persisted server-side (the reply stream broke
          // mid-flight — ChatSendError.userMessagePersisted): its bubble stays on screen, and
          // resending a restored draft would duplicate the message. The input stays editable
          // while streaming, so never clobber newer typing either.
          if (!(e instanceof ChatSendError && e.userMessagePersisted)) {
            setDraft((current) => (current.length ? current : content))
          }
          toast({ title: e instanceof Error ? e.message : t('errors.generic'), variant: 'error' })
        },
      },
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title }} />
      <PageWrapper scroll={false} edges={['top', 'bottom']}>
        {sessionPending ? (
          <View className="flex-1 items-center justify-center">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={MessageSquare}
            title={t('chat.signedOutTitle')}
            description={t('chat.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : messagesQuery.error instanceof ApiError && messagesQuery.error.status === 404 ? (
          // A deleted/unknown thread is product state, not a failure — retrying a 404 just
          // repeats it, and a cold deep link has no history, so give an explicit exit.
          <EmptyState
            icon={MessageSquare}
            title={t('chat.notFoundTitle')}
            description={t('chat.notFoundBody')}
            action={
              <Button
                variant="outline"
                label={t('common.back')}
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/chat'))}
              />
            }
          />
        ) : (
          <>
            <ScrollView
              ref={scrollRef}
              className="flex-1"
              contentContainerClassName="gap-3 py-2"
              keyboardShouldPersistTaps="handled"
              // Pin to the latest content — fires for history loads, optimistic appends, AND
              // every streamed chunk, so the growing reply stays in view.
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              <AsyncBoundary
                query={messagesQuery}
                isEmpty={messages.length === 0}
                empty={
                  <EmptyState
                    icon={Sparkles}
                    title={t('chat.emptyThreadTitle')}
                    description={t('chat.emptyThreadBody')}
                  />
                }
              >
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </AsyncBoundary>
            </ScrollView>

            <View className="flex-row items-end gap-2 border-t border-border pt-3">
              <Input
                containerClassName="flex-1"
                className="h-auto max-h-28 min-h-11 py-2.5"
                value={draft}
                onChangeText={setDraft}
                placeholder={t('chat.inputPlaceholder')}
                multiline
                // Stays editable while streaming — users can compose the next message; send is
                // what's serialized (the button below disables while a reply is in flight).
                accessibilityLabel={t('chat.inputPlaceholder')}
              />
              <Button
                icon={Send}
                accessibilityLabel={t('chat.send')}
                loading={sendMessage.isPending}
                disabled={!draft.trim() || sendMessage.isPending}
                onPress={send}
              />
            </View>
          </>
        )}
      </PageWrapper>
    </>
  )
}
