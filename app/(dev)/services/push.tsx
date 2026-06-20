import { View, Platform } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { useAsyncAction, Result } from '@/components/gallery/async-action'
import { apiFetch } from '@/lib/api/client'
import { registerForPush } from '@/lib/native/notifications'

/** Push tester — register this device with the Worker, then send yourself a test push. */

function PushTester() {
  const register = useAsyncAction()
  const send = useAsyncAction()
  return (
    <View className="gap-3">
      <Button
        label="Register this device"
        loading={register.state.status === 'loading'}
        onPress={() =>
          register.run(async () => {
            const token = await registerForPush()
            if (!token) throw new Error('No push token — needs a dev build + notification permission')
            await apiFetch('/api/push/register', {
              method: 'POST',
              body: JSON.stringify({ token, platform: Platform.OS }),
            })
            return 'Registered with the Worker'
          })
        }
      />
      <Result state={register.state} />
      <Button
        variant="outline"
        label="Send test push"
        loading={send.state.status === 'loading'}
        onPress={() =>
          send.run(async () => {
            const r = await apiFetch<{ sent: number; errors?: string[] }>('/api/push/test', {
              method: 'POST',
              body: JSON.stringify({}),
            })
            if (r.errors?.length) return `Sent ${r.sent} — errors: ${r.errors.join(', ')}`
            return `Sent ${r.sent} push${r.sent === 1 ? '' : 'es'} — check your notifications`
          })
        }
      />
      <Result state={send.state} />
    </View>
  )
}

export default function PushScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Push</Text>
      <Section title="Push notifications — Expo" description="Register this device, then send yourself a test push (signed-in + deployed Worker)">
        <PushTester />
      </Section>
    </PageWrapper>
  )
}
