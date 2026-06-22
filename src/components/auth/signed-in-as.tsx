import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { cn } from '@/lib/utils'
import { authClient, useSession } from '@/lib/auth/client'
import { Text } from '@/components/ui/text'

/**
 * SignedInAs — a small "Signed in as {email} · Not you? Sign out" strip.
 *
 * Drop it on any first-run / no-organization / onboarding screen. Without it, a user who signed in to
 * the WRONG account dead-ends on "create your workspace" with no idea why ("I already set one up!") and
 * no way out. Showing the identity makes the mistake obvious; the sign-out gives a one-tap recovery.
 *
 * Self-contained: reads the session and signs out to /login. Renders nothing while signed out.
 */
export function SignedInAs({ className }: { className?: string }) {
  const { data: session } = useSession()
  const email = session?.user?.email
  if (!email) return null

  const onSignOut = async () => {
    await authClient.signOut().catch(() => {})
    router.replace('/login')
  }

  return (
    <View
      className={cn(
        'flex-row flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-border bg-card px-3 py-2.5',
        className,
      )}
    >
      <Text variant="caption">Signed in as</Text>
      <Text variant="caption" className="font-semibold text-foreground">
        {email}
      </Text>
      <Text variant="caption">·</Text>
      <Pressable onPress={onSignOut} hitSlop={6} accessibilityRole="button">
        <Text variant="caption" className="font-semibold text-primary">
          Not you? Sign out
        </Text>
      </Pressable>
    </View>
  )
}
