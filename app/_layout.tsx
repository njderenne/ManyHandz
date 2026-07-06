import '../global.css'
import '@/lib/nativewind-animated' // registers className→style on Animated.* (must precede any Animated mount)
import { useCallback, useEffect, useState } from 'react'
import { AppState, Linking, Platform, Pressable, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { colorScheme } from 'nativewind'
import { useFonts } from '@expo-google-fonts/inter'
import * as SplashScreen from 'expo-splash-screen'
import Constants from 'expo-constants'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { CloudOff, X } from 'lucide-react-native'
import { queryClient, asyncPersister, PERSIST_MAX_AGE } from '@/lib/query/client'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm'
import { ErrorBoundary as CrashGuard } from '@/components/ui/error-boundary'
import { wireNotificationTaps } from '@/lib/native/notifications'
import { useActiveOrgGuard } from '@/lib/auth/use-active-org-guard'
import { useRequireAuth } from '@/lib/auth/use-require-auth'
import { useContextGuard } from '@/lib/context/use-context-guard'                 // B1
import { useRequireSubscription } from '@/lib/billing/use-require-subscription'   // A1
import { useRequireHousehold } from '@/lib/auth/use-require-household'

// expo-router renders this for any screen that throws — navigation survives, white screens don't.
export { RouteError as ErrorBoundary } from '@/components/layout/route-error'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useThemeMode, useActiveScheme, useColors } from '@/lib/config/theme'
import { fontAssets } from '@/lib/config/fonts'
import { apiFetch } from '@/lib/api/client'
import { APP_CONFIG } from '@/lib/config/app'
import { ProductTabBar, ProductTopNav } from '@/components/layout/product-nav'
import { ContainedStackHeader } from '@/components/layout/contained-stack-header'
import { useIsWideWeb } from '@/lib/hooks/use-is-wide-web'

SplashScreen.preventAutoHideAsync()

/**
 * Root layout — the single mount point for the whole app.
 *
 * Wraps the Expo Router navigator with the offline-aware QueryClient (TanStack Query +
 * AsyncStorage persistence), gesture + safe-area providers (needed by native UI and Reanimated).
 * Screens live in app/ as files; this replaces the old web main.tsx + __root.tsx.
 *
 * Two lightweight global guards live here too, both fail-open so they can never brick the app:
 *  - Force-update gate: /api/meta advertises a minAppVersion; if this build is older, a blocking
 *    "Update required" card renders INSTEAD of the navigator (kill-switch for broken old builds).
 *    Any fetch/shape problem means no gate.
 *  - Offline banner: a tiny /api/health probe on launch + foreground-resume; while unreachable, a
 *    slim dismissible banner shows and re-probes every 30s (no NetInfo dependency on purpose).
 */

/** Factory: replace with the real App Store / Play Store listing URL when the app is live. */
const STORE_URL = APP_CONFIG.url

/**
 * Tiny semver-ish compare for "1.2.3"-style strings: negative if a < b, 0 if equal, positive if
 * a > b. Missing or non-numeric segments compare as 0 — lenient by design (a malformed version
 * must never lock users out).
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] ?? '0', 10) || 0
    const nb = parseInt(pb[i] ?? '0', 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

/** Force-update gate: true only when /api/meta succeeds AND this build is below minAppVersion. */
function useForceUpdateGate(): boolean {
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const meta = await apiFetch<{ minAppVersion?: string }>('/api/meta')
        const current = Constants.expoConfig?.version
        if (
          !cancelled &&
          typeof meta?.minAppVersion === 'string' &&
          current &&
          compareVersions(current, meta.minAppVersion) < 0
        ) {
          setBlocked(true)
        }
      } catch {
        // Network failure, missing route, or bad payload = NO gate. Fail open, always.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return blocked
}

/**
 * Minimal connectivity probe — no NetInfo. Pings /api/health (5s timeout) on app start and on
 * foreground resume; while failing, re-probes every 30s. `dismissed` hides the banner for the
 * current outage only — it resets once the server is reachable again.
 */
function useHealthProbe() {
  const [offline, setOffline] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const probe = useCallback(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      await apiFetch<{ ok: boolean }>('/api/health', { signal: controller.signal })
      setOffline(false)
      setDismissed(false) // next outage gets a fresh banner
    } catch {
      setOffline(true)
    } finally {
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    probe()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') probe()
    })
    return () => sub.remove()
  }, [probe])

  useEffect(() => {
    if (!offline) return
    const id = setInterval(probe, 30_000)
    return () => clearInterval(id)
  }, [offline, probe])

  return { offline, dismissed, dismiss: () => setDismissed(true) }
}

/** Full-screen blocking card rendered INSTEAD of the navigator when the build is too old. */
function UpdateRequiredScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="gap-3 p-5">
          <Text variant="h2">Update required</Text>
          <Text variant="muted">
            This version of {APP_CONFIG.name} is no longer supported. Please update to the latest
            version to keep going.
          </Text>
          <Button
            label="Update now"
            onPress={() => {
              Linking.openURL(STORE_URL).catch(() => {})
            }}
          />
        </CardContent>
      </Card>
    </View>
  )
}

/** Full-screen splash held while the session resolves, or while a signed-out user is bounced to the
 *  auth wall — no nav, no chrome, so the gated UI never flashes before the redirect lands. */
function AuthSplash() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Spinner size="large" />
    </View>
  )
}

/** Slim dismissible top banner shown while the server is unreachable. Overlays, never reflows. */
function OfflineBanner({ onDismiss }: { onDismiss: () => void }) {
  const insets = useSafeAreaInsets()
  const colors = useColors()
  return (
    <View
      className="absolute inset-x-0 top-0 z-50 border-b border-border bg-card"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center gap-2 px-4 py-2">
        <CloudOff color={colors.warning} size={16} />
        <Text variant="caption" className="flex-1">
          Can't reach the server — retrying
        </Text>
        <Pressable onPress={onDismiss} hitSlop={8} className="active:opacity-70">
          <X color={colors.mutedForeground} size={16} />
        </Pressable>
      </View>
    </View>
  )
}

// Primary navigation (ProductTabBar bottom bar / ProductTopNav desktop top nav) and its shared
// show/hide + active-tab rules live in src/components/layout/product-nav.tsx and
// src/lib/config/navigation.ts — one rule set, two presentational layouts. The shell picks which
// one mounts via useIsWideWeb() below.

/** The navigator plus its global guards — must render inside the providers (toast, safe area). */
function AppShell() {
  const updateRequired = useForceUpdateGate()
  // Global auth wall (after the update gate so a dead build's update card still wins). A signed-out
  // user is held on a splash and bounced to /login — they never see the shell, nav, or a gated screen.
  const gate = useRequireAuth()
  const { offline, dismissed, dismiss } = useHealthProbe()
  const colors = useColors()
  const wideWeb = useIsWideWeb()
  // Auto-activate a sole organization so a user who created it elsewhere lands straight inside it
  // (no "create → activate" limbo). No-op for 0 or 2+ orgs; loop-safe and fail-open.
  useActiveOrgGuard()
  // B1 — redirects context-less users to /onboarding when tenant.onboarding==='require-create'
  // (inert for ManyHandz: tenant.onboarding='none' — useRequireHousehold below is the product gate).
  useContextGuard()
  // A1 — cadio's hard wall; inert unless monetization.requireSubscription (config, not code).
  useRequireSubscription()
  // ManyHandz: signed in but no household yet → onboarding (create/join). Fail-open; never traps.
  useRequireHousehold()

  if (updateRequired) return <UpdateRequiredScreen />
  // The redirect to /login also clears the nav (isNavHidden('/login') is already true); holding the
  // splash here means the gated tree never mounts for a signed-out user.
  if (gate !== 'allowed') return <AuthSplash />

  return (
    <View style={{ flex: 1 }}>
      {/* Desktop web gets a website-style top nav ABOVE the navigator; phones and narrow web keep
          the bottom tab bar BELOW it. wideWeb is web-only, so native is always the bottom bar. */}
      {wideWeb ? <ProductTopNav /> : null}
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          // Screens that opt into headers (Stack.Screen headerShown: true) inherit the theme —
          // without these the web/native default is a white bar that ignores dark mode.
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.foreground,
          headerTitleStyle: { color: colors.foreground },
          headerShadowVisible: false,
          // Wide desktop web: align the back button + title to the centered content lane (same
          // max-w-4xl as the page body) instead of the far-left screen edge. Native + narrow web
          // keep the default full-width React Navigation header (this branch is web-and-wide only).
          header: wideWeb ? (props) => <ContainedStackHeader {...props} /> : undefined,
        }}
      />
      {wideWeb ? null : <ProductTabBar />}
      {offline && !dismissed ? <OfflineBanner onDismiss={dismiss} /> : null}
    </View>
  )
}

export default function RootLayout() {
  const mode = useThemeMode((s) => s.mode)
  const scheme = useActiveScheme()
  const router = useRouter()
  const [fontsLoaded] = useFonts(fontAssets)
  useEffect(() => {
    // Apply the stored preference (default dark) on launch and whenever it changes.
    colorScheme.set(mode)
  }, [mode])
  // Push-notification taps (warm + cold start) deep-link via the central entity router.
  // Mount once: expo-router's router object is stable for the app's lifetime, and re-running
  // would stack duplicate listeners if that ever changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => wireNotificationTaps(router), [])
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync()
  }, [fontsLoaded])

  // Native blocks the whole tree on fonts (splash stays up, then a clean swap). On web that same
  // gate renders a blank page until Inter downloads — worse than a brief FOUT — so web renders
  // immediately and the font swaps in when it lands.
  if (!fontsLoaded && Platform.OS !== 'web') return null

  return (
    // GestureHandlerRootView MUST stay at the very root and wrap everything. Beyond enabling the
    // bottom-sheet/slider gestures, the kit's small round controls use react-native-gesture-handler's
    // Pressable (voice-memo.tsx) for reliable taps on the new architecture — if this wrapper is ever
    // dropped or moved below the navigator, those gestures silently stop processing (worse than RN's
    // Pressable, which at least degrades). Don't relocate it.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <CrashGuard>
        <SafeAreaProvider>
          <PersistQueryClientProvider
            client={queryClient}
            // buster keyed to the app version: any shipped response-shape change drops stale persisted
            // snapshots on upgrade, so a screen reading newly-added fields can't crash on a pre-update
            // cached object rehydrated from AsyncStorage (defends every screen at the source).
            persistOptions={{ persister: asyncPersister, maxAge: PERSIST_MAX_AGE, buster: Constants.expoConfig?.version ?? '0' }}
          >
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <ToastProvider>
              <ConfirmProvider>
                <AppShell />
              </ConfirmProvider>
            </ToastProvider>
          </PersistQueryClientProvider>
        </SafeAreaProvider>
      </CrashGuard>
    </GestureHandlerRootView>
  )
}
