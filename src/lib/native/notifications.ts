import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { routeForEntity } from './notification-router'

/**
 * Push + local notifications. `registerForPush` returns an Expo push token to store server-side
 * (the Worker sends pushes via Expo's push service). `scheduleLocal` fires a local notification —
 * handy for reminders/timers. `wireNotificationTaps` turns push taps into navigation. No-ops
 * gracefully on web.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web') return null
  try {
    const { status } = await Notifications.requestPermissionsAsync()
    if (status !== 'granted') return null
    // Dev-client / EAS builds can't infer the EAS project — pass its id explicitly.
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    return token.data
  } catch {
    return null
  }
}

export async function scheduleLocal(title: string, body: string, seconds = 3): Promise<boolean> {
  if (Platform.OS === 'web') return false
  try {
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync()
      if (req.status !== 'granted') return false
    }
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, repeats: false },
    })
    return true
  } catch {
    return false
  }
}

// Cold-start tap (the push that LAUNCHED the app) is fetched at most once per JS runtime, so
// layout remounts / fast refresh never re-navigate. Per-runtime is exactly right: a new cold
// start is a new runtime.
let coldStartHandled = false

// Some platforms surface the cold-start response through BOTH paths (the warm listener fires
// once JS boots AND getLastNotificationResponseAsync returns it) — dedupe by request identifier
// so one tap never navigates twice.
let lastHandledTapId: string | null = null

/**
 * Wire push-notification taps to navigation. Call once from the root layout:
 *
 *   const router = useRouter()
 *   useEffect(() => wireNotificationTaps(router), [router])
 *
 * Covers both tap paths: warm taps (app running or backgrounded) via the response listener, and
 * the cold-start tap via `getLastNotificationResponseAsync` — the listener can't see a tap that
 * happened before JS booted. The target screen comes from routeForEntity() reading the
 * { entityType, entityId } data payload the Worker attaches in notify() (worker/notify.ts).
 * No-op on web; returns the unsubscribe for effect cleanup.
 */
export function wireNotificationTaps(router: { push: (href: any) => void }): () => void {
  if (Platform.OS === 'web') return () => {}

  const handleTap = (response: Notifications.NotificationResponse | null) => {
    if (!response) return
    const id = response.notification.request.identifier
    if (id && id === lastHandledTapId) return
    lastHandledTapId = id

    // Payload shape is { kind, entityType, entityId } — set by worker/notify.ts. Anything
    // malformed degrades to the notifications inbox via routeForEntity's fallback.
    const data = response.notification.request.content.data
    const entityType = typeof data?.entityType === 'string' ? data.entityType : null
    const entityId = typeof data?.entityId === 'string' ? data.entityId : null
    const href = routeForEntity(entityType, entityId)
    if (href) router.push(href)
  }

  const sub = Notifications.addNotificationResponseReceivedListener(handleTap)

  if (!coldStartHandled) {
    coldStartHandled = true
    Notifications.getLastNotificationResponseAsync()
      .then(handleTap)
      .catch(() => {}) // tap routing is best-effort — never crash the layout over it
  }

  return () => sub.remove()
}
