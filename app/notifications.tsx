import { View, Pressable } from 'react-native'
import { router, Stack, type Href } from 'expo-router'
import { Bell, Inbox } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { List } from '@/components/ui/list'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { fonts } from '@/lib/config/fonts'
import { authClient, useSession } from '@/lib/auth/client'
import {
  unreadCount,
  useInfiniteNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
} from '@/lib/query/hooks/useNotifications'
import { routeForEntity } from '@/lib/native/notification-router'
import { t } from '@/lib/i18n'
import type { Notification } from '@/lib/db/schema'

/**
 * Notification center — the standard in-app feed every shipped app needs. Cursor-paginated list
 * (load-more affordance), optimistic read-state (tap a row / "Mark all read" in the header — row
 * taps confirm the write before deep-linking), and deep links into the entity each notification
 * is about via routeForEntity. Pushed route (Settings → Notifications); signed-out visitors get
 * a sign-in prompt.
 */

/** Compact feed timestamp: "now" → "{m}m" → "{h}h" → "{d}d" → locale date for older rows. */
function timeAgo(value: Notification['createdAt']): string {
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

/**
 * One feed row. Unread rows are visually distinct twice over: a primary dot on the right and a
 * semibold title (weight = font family on RN; see ui/text.tsx). Layout mirrors ListItem so the
 * feed reads like the rest of the app's lists — custom only because the title weight varies.
 */
function NotificationRow({
  item,
  onPress,
}: {
  item: Notification
  onPress: (n: Notification) => void
}) {
  const colors = useColors()
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={
        item.isRead ? item.title : t('notifications.unreadRowA11y', { title: item.title })
      }
      className="flex-row items-center gap-3 border-b border-border px-4 py-3.5 active:bg-accent"
    >
      <View className="size-9 items-center justify-center rounded-full bg-accent">
        <Bell color={item.isRead ? colors.mutedForeground : colors.brand} size={18} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text
          variant="label"
          numberOfLines={1}
          style={item.isRead ? undefined : { fontFamily: fonts.semibold }}
        >
          {item.title}
        </Text>
        {item.body ? (
          <Text variant="muted" numberOfLines={2}>
            {item.body}
          </Text>
        ) : null}
      </View>
      <View className="items-end gap-1.5">
        <Text variant="caption">{timeAgo(item.createdAt)}</Text>
        {item.isRead ? null : <View className="size-2 rounded-full bg-primary" />}
      </View>
    </Pressable>
  )
}

export default function NotificationsScreen() {
  const { toast } = useToast()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''

  const query = useInfiniteNotifications(orgId)
  const markRead = useMarkNotificationsRead(orgId)
  const markAllRead = useMarkAllNotificationsRead(orgId)

  const rows = query.data?.pages.flat() ?? []
  const unread = unreadCount(rows)

  /**
   * Tap = mark read (awaited — on failure the optimistic flip rolls back, and navigating away
   * would hide that rollback), then deep-link to the entity (null target = stay here).
   */
  const openNotification = async (n: Notification) => {
    if (!n.isRead) {
      try {
        await markRead.mutateAsync([n.id])
      } catch {
        toast({ title: t('errors.generic'), variant: 'error' })
        return
      }
    }
    const target = routeForEntity(n.entityType, n.entityId)
    if (target) router.push(target as Href)
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('notifications.title'),
          // Always mounted, disabled at zero unread — unmounting on the 0 transition shifts the header.
          headerRight: () => (
            <Button
              size="sm"
              variant="ghost"
              label={t('notifications.markAllRead')}
              loading={markAllRead.isPending}
              disabled={unread === 0}
              onPress={() => markAllRead.mutate()}
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
            icon={Bell}
            title={t('notifications.signedOutTitle')}
            description={t('notifications.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : (
          <AsyncBoundary
            query={query}
            isEmpty={rows.length === 0}
            empty={
              <EmptyState
                icon={Inbox}
                title={t('notifications.emptyTitle')}
                description={t('notifications.emptyBody')}
              />
            }
          >
            <List>
              {rows.map((n) => (
                <NotificationRow key={n.id} item={n} onPress={openNotification} />
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
    </>
  )
}
