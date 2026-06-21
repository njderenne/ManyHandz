import { View, Pressable } from 'react-native'
import { Link, usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { APP_CONFIG } from '@/lib/config/app'
import { isNavHidden, activeNavName } from '@/lib/config/navigation'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { Text } from '@/components/ui/text'

/**
 * Product navigation — one nav, two layouts, one shared rule set.
 *
 * Both bars consume the SAME `PRIMARY_NAV`, the SAME `activeNavName` (longest-href-prefix match),
 * and the SAME `isNavHidden` (forms/auth hide it) from src/lib/config/navigation.ts — so there is
 * no parallel navigation tree to keep in sync, only a presentational difference:
 *   - ProductTabBar → bottom tab bar (phones + narrow web). The default.
 *   - ProductTopNav → desktop-web top nav (website-style: brand left, tabs right). Rendered only on
 *     wide web; the app shell (app/_layout.tsx) picks which one mounts via useIsWideWeb().
 */

/**
 * ProductTabBar — the persistent bottom navigation. Shown on content/detail screens, hidden on
 * forms (see isNavHidden). insets.bottom keeps it above the home indicator / gesture bar on native.
 */
export function ProductTabBar() {
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const colors = useColors()
  const { navTabs } = useHouseholdMode()

  if (isNavHidden(pathname)) return null
  const active = activeNavName(pathname, navTabs)
  // A route that matches NO tab (a standalone drill-in like /paywall, or a screen owned by a nested
  // navigator like the dev gallery's own Tabs) is full-screen with its own back affordance — no
  // nav, and never a double bar stacked under another navigator's tabs.
  if (!active) return null

  return (
    <View className="flex-row border-t border-border bg-card" style={{ paddingBottom: insets.bottom }}>
      {navTabs.map((item) => {
        const isActive = item.name === active
        const Icon = item.icon
        return (
          <Link key={item.name} href={item.href as never} asChild>
            <Pressable
              className="flex-1 items-center gap-1 py-2 active:opacity-70"
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: isActive }}
            >
              <Icon color={isActive ? colors.brand : colors.mutedForeground} size={22} />
              <Text variant="caption" style={isActive ? { color: colors.brand } : undefined}>
                {item.label}
              </Text>
            </Pressable>
          </Link>
        )
      })}
    </View>
  )
}

/**
 * ProductTopNav — the desktop-web top navigation. A full-width frame (the thing that anchors the
 * centered content column so it stops reading as a lonely strip) with the app's brand on the left
 * and PRIMARY_NAV as website-style tabs on the right; the inner row is constrained to max-w-7xl and
 * centered to line up with page content. Shares isNavHidden/activeNavName with ProductTabBar, so
 * form/auth hiding and active-tab resolution are identical by construction.
 *
 * Kept in NORMAL document flow (NOT position:fixed) on purpose: the web build locks body scroll so
 * the root ScrollView owns scrolling (app/+html.tsx), and a fixed bar would escape that overflow
 * context. As a sibling above the navigator it simply reflows content down.
 */
export function ProductTopNav() {
  const pathname = usePathname()
  const colors = useColors()
  const { navTabs } = useHouseholdMode()

  if (isNavHidden(pathname)) return null
  const active = activeNavName(pathname, navTabs)
  if (!active) return null

  const initial = (APP_CONFIG.name.trim()[0] ?? 'A').toUpperCase()

  return (
    <View className="border-b border-border bg-card">
      <View className="w-full max-w-7xl flex-row items-center justify-between gap-6 self-center px-6 py-3">
        <Link href={'/' as never} asChild>
          <Pressable
            className="flex-row items-center gap-2 active:opacity-70"
            accessibilityRole="link"
            accessibilityLabel={`${APP_CONFIG.name} home`}
          >
            <View className="size-7 items-center justify-center rounded-lg" style={{ backgroundColor: colors.brand }}>
              <Text variant="label" style={{ color: colors.onPrimary }}>
                {initial}
              </Text>
            </View>
            <Text variant="label">{APP_CONFIG.name}</Text>
          </Pressable>
        </Link>
        <View className="flex-row items-center gap-1">
          {navTabs.map((item) => {
            const isActive = item.name === active
            return (
              <Link key={item.name} href={item.href as never} asChild>
                <Pressable
                  className={cn('rounded-md px-3 py-2 active:opacity-70 web:hover:bg-accent', isActive && 'bg-accent')}
                  // 'tab' (not 'link') so the selected state is idiomatic, matching ProductTabBar.
                  accessibilityRole="tab"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected: isActive }}
                >
                  <Text variant="label" style={{ color: isActive ? colors.brand : colors.mutedForeground }}>
                    {item.label}
                  </Text>
                </Pressable>
              </Link>
            )
          })}
        </View>
      </View>
    </View>
  )
}
