import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { haptics } from '@/lib/native/haptics'

/** Haptics tester — every feedback style the wrapper exposes. */
export default function HapticsScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Haptics</Text>
      <Section title="Haptics" description="expo-haptics — tactile feedback (no-op on web)">
        <View className="flex-row flex-wrap gap-2">
          <Button size="sm" variant="outline" label="Light" onPress={() => { haptics.light() }} />
          <Button size="sm" variant="outline" label="Medium" onPress={() => { haptics.medium() }} />
          <Button size="sm" variant="outline" label="Heavy" onPress={() => { haptics.heavy() }} />
          <Button size="sm" variant="outline" label="Success" onPress={() => { haptics.success() }} />
          <Button size="sm" variant="outline" label="Error" onPress={() => { haptics.error() }} />
        </View>
      </Section>
    </PageWrapper>
  )
}
