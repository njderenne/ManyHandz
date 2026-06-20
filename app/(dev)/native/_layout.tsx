import { Stack } from 'expo-router'
import { useColors } from '@/lib/config/theme'

/**
 * Native stack — the hub (index) pushes into each capability tester. Nested inside the
 * Native tab, so the tab bar stays visible while browsing.
 */
export default function NativeLayout() {
  const colors = useColors()
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        headerTitle: '', // screens carry their own h1 — the header is just the back affordance
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  )
}
