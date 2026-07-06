import { Pressable } from 'react-native'
import { Tabs, Redirect } from 'expo-router'
import { LayoutGrid, Cpu, Cable, SlidersHorizontal } from 'lucide-react-native'
import { useColors } from '@/lib/config/theme'

/**
 * Dev gallery navigator — four tabs. Components is a hub (nested stack) so the chassis can grow
 * without adding tabs; Native and Services are live test surfaces; Preferences is the prefs tester.
 * Lives under the `(dev)` route group so it can be excluded per app.
 *
 * PRODUCTION GUARD: these are QA/test surfaces — never ship them. In a production build (__DEV__
 * false, EAS preview/production AND the web export), every (dev) route redirects home, so a
 * signed-in user can't reach the gallery by URL/deep link even though the group is bundled. The
 * Preferences tab is `/preferences`, NOT `/settings`, so it never collides with the production
 * Settings hub at app/settings.tsx.
 */
export default function DevLayout() {
  if (!__DEV__) return <Redirect href="/" />
  const colors = useColors()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Pre-mount all four tabs (hubs are lightweight lists) so switching never compiles a
        // screen on first visit — tab taps respond instantly.
        lazy: false,
        // Switch on touch-DOWN (iOS-native feel) instead of waiting for the release; onPress
        // stays for assistive tech (re-navigating to the same tab is a no-op).
        tabBarButton: (props) => (
          <Pressable
            {...(props as React.ComponentProps<typeof Pressable>)}
            onPress={props.onPress}
            onPressIn={props.onPress}
          />
        ),
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="components"
        options={{
          title: 'Components',
          tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="native"
        options={{ title: 'Native', tabBarIcon: ({ color, size }) => <Cpu color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="services"
        options={{ title: 'Services', tabBarIcon: ({ color, size }) => <Cable color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="preferences"
        options={{
          title: 'Preferences',
          tabBarIcon: ({ color, size }) => <SlidersHorizontal color={color} size={size} />,
        }}
      />
    </Tabs>
  )
}
