import { useCallback, useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'

/**
 * PageWrapper — the standard screen container: safe-area aware, dark background, padded.
 * Scrolls by default; pass `scroll={false}` for fixed layouts. Pass `onRefresh` to get a themed
 * pull-to-refresh on the ScrollView (the spinner stays visible until the returned promise
 * settles) — only meaningful when `scroll` is true.
 *
 * RESPONSIVE: content renders in a centered column whose max width is named by `width` — on
 * phones nothing changes (every lane is wider than a phone), while web, iPad, and Android
 * tablets get properly constrained, centered layouts instead of edge-to-edge stretching.
 * `form` = 448px (auth/settings forms) · `content` = 672px (default; lists, detail, reading) ·
 * `wide` = 1024px (dashboards, galleries) · `full` = unconstrained (maps, canvases).
 */
const WIDTH_LANES = {
  form: 'max-w-md',
  content: 'max-w-2xl',
  wide: 'max-w-5xl',
  full: '',
} as const

/**
 * Web gets wider lanes than native: desktop browsers have far more horizontal room than a phone
 * or tablet, so the native lanes (tuned for handheld/iPad) leave too much empty gutter on a laptop.
 * NativeWind compiles both maps; native only ever reads WIDTH_LANES, web only ever reads this.
 */
const WIDTH_LANES_WEB = {
  form: 'max-w-md',
  content: 'max-w-4xl',
  wide: 'max-w-7xl',
  full: '',
} as const

export type PageWrapperProps = {
  children: React.ReactNode
  scroll?: boolean
  className?: string
  edges?: Edge[]
  /** Max content width lane — see the responsive note above. Default: 'content'. */
  width?: keyof typeof WIDTH_LANES
  /** Pull-to-refresh handler; await your refetch so the spinner tracks it. */
  onRefresh?: () => void | Promise<unknown>
}

export function PageWrapper({
  children,
  scroll = true,
  className,
  edges = ['top'],
  width = 'content',
  onRefresh,
}: PageWrapperProps) {
  const colors = useColors()
  const [refreshing, setRefreshing] = useState(false)
  const isWeb = Platform.OS === 'web'
  // Wider lanes on web, native lanes everywhere else (see WIDTH_LANES_WEB).
  const lane = isWeb ? WIDTH_LANES_WEB[width] : WIDTH_LANES[width]

  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh])

  const body = scroll ? (
    <ScrollView
      // web:min-h-full makes short screens fill the viewport (centered like the fixed branch)
      // instead of floating mid-page; native is unaffected (web: variant compiles out).
      contentContainerClassName="items-center p-4 web:min-h-full"
      keyboardShouldPersistTaps="handled"
      // Scrolling must NOT dismiss the keyboard — on Android the input sits above the keyboard and
      // a stray scroll was closing it mid-edit. 'none' keeps it open; taps still dismiss normally.
      keyboardDismissMode="none"
      // Keyboard avoidance: iOS insets the scroll content by the keyboard height so the focused
      // field stays visible — WITHOUT a KeyboardAvoidingView shoving the entire screen upward (the
      // old behavior that pushed text out of view when typing). Android resizes the window instead
      // (app.json android.softwareKeyboardLayoutMode "resize"), so the ScrollView shrinks and scrolls
      // to the focused input. Web lets the browser handle it (prop is a native no-op there).
      automaticallyAdjustKeyboardInsets={!isWeb && Platform.OS === 'ios'}
      // RefreshControl nested in web's double-overflow scroll container freezes the page — never
      // mount it on web. Native pull-to-refresh is byte-identical to before.
      refreshControl={
        onRefresh && !isWeb ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.mutedForeground} // iOS spinner
            colors={[colors.primary]} // Android spinner
            progressBackgroundColor={colors.card} // Android circle
          />
        ) : undefined
      }
    >
      <View className={cn('w-full gap-4', lane, className)}>{children}</View>
    </ScrollView>
  ) : (
    <View className="flex-1 items-center p-4">
      <View className={cn('w-full flex-1 gap-4', lane, className)}>{children}</View>
    </View>
  )

  return (
    <SafeAreaView className="flex-1 bg-background" edges={edges}>
      {/* Keyboard avoidance lives where it belongs: the scroll branch insets its own content on iOS
          (automaticallyAdjustKeyboardInsets above) and Android resizes — no whole-screen shove. Only
          FIXED (non-scroll) native layouts, which have no scroll content to inset, still need a
          KeyboardAvoidingView to lift their centered content above the keyboard. Web never avoids. */}
      {scroll || isWeb ? (
        body
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {body}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}
