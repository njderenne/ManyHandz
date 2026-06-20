import { Stack } from 'expo-router'
import { useColors } from '@/lib/config/theme'

/**
 * Components stack — the hub (index) pushes into each gallery category. Nested inside the
 * Components tab, so the tab bar stays visible while browsing.
 */
export default function ComponentsLayout() {
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
