import { Pressable } from 'react-native'
import { Tabs } from 'expo-router'
import { LayoutGrid, Cpu, Cable, Settings as SettingsIcon } from 'lucide-react-native'
import { useColors } from '@/lib/config/theme'

/**
 * Dev gallery navigator — four tabs. Components is a hub (nested stack) so the chassis can grow
 * without adding tabs; Native and Services are live test surfaces; Settings is user preferences.
 * Lives under the `(dev)` route group so it can be excluded per app.
 */
export default function DevLayout() {
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
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <SettingsIcon color={color} size={size} />,
        }}
      />
    </Tabs>
  )
}
