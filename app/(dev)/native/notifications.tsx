import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { useToast } from '@/components/ui/toast'
import { registerForPush, scheduleLocal } from '@/lib/native/notifications'

/** Notifications tester — schedule a local notification + register for push. */
export default function NotificationsScreen() {
  const { toast } = useToast()

  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Notifications</Text>
      <Section title="Notifications" description="expo-notifications">
        <View className="flex-row gap-2">
          <Button
            variant="outline"
            label="Schedule (3s)"
            onPress={async () => {
              const ok = await scheduleLocal('Hello from AppFactory', 'Your local notification fired.', 3)
              toast({ title: ok ? 'Scheduled — leave the app' : 'Permission denied', variant: ok ? 'success' : 'error' })
            }}
          />
          <Button
            variant="outline"
            label="Register push"
            onPress={async () => {
              const token = await registerForPush()
              toast({ title: token ? 'Got push token' : 'No token', variant: token ? 'success' : 'error' })
            }}
          />
        </View>
      </Section>
    </PageWrapper>
  )
}
