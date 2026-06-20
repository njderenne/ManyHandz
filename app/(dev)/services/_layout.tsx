import { Stack } from 'expo-router'
import { useColors } from '@/lib/config/theme'

/**
 * Services stack — the hub (index) pushes into each capability tester. Nested inside the
 * Services tab, so the tab bar stays visible while testing.
 */
export default function ServicesLayout() {
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
