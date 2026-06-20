import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { playSound, SOUND_NAMES } from '@/lib/native/sounds'

/** Sounds tester — plays each standard UI sound from assets/sounds. */

export default function SoundsScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Sounds</Text>
      <Section title="Sounds" description="Standard UI sounds (assets/sounds)">
        <View className="flex-row gap-2">
          {SOUND_NAMES.map((n) => (
            <Button
              key={n}
              size="sm"
              variant="outline"
              label={n[0].toUpperCase() + n.slice(1)}
              onPress={() => playSound(n)}
              className="flex-1"
            />
          ))}
        </View>
      </Section>
    </PageWrapper>
  )
}
