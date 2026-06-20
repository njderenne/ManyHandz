import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { useToast } from '@/components/ui/toast'
import { haptics } from '@/lib/native/haptics'
import { isBiometricAvailable, authenticate } from '@/lib/native/biometrics'

/** Biometrics tester — availability check + a real auth prompt. */
export default function BiometricsScreen() {
  const { toast } = useToast()

  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Biometrics</Text>
      <Section title="Biometrics" description="expo-local-authentication — Face ID / Touch ID / passcode">
        <View className="flex-row gap-2">
          <Button
            variant="outline"
            label="Check availability"
            onPress={async () => {
              const ok = await isBiometricAvailable()
              toast({ title: ok ? 'Biometrics available' : 'Not available', variant: ok ? 'success' : 'error' })
            }}
          />
          <Button
            label="Unlock"
            onPress={async () => {
              const ok = await authenticate('Unlock the gallery')
              if (ok) haptics.success()
              toast({ title: ok ? 'Authenticated' : 'Failed', variant: ok ? 'success' : 'error' })
            }}
          />
        </View>
      </Section>
    </PageWrapper>
  )
}
