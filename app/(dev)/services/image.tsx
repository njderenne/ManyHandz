import { useState } from 'react'
import { View, Image } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { useAsyncAction, Result } from '@/components/gallery/async-action'
import { pickAndRemoveBackground } from '@/lib/media/remove-background'

/** Background-removal tester — pick an image, rembg returns a transparent PNG. */

function RembgTester() {
  const [img, setImg] = useState<string | null>(null)
  const { state, run } = useAsyncAction()
  return (
    <View className="gap-3">
      <Button
        label="Pick image & remove background"
        loading={state.status === 'loading'}
        onPress={() =>
          run(async () => {
            const result = await pickAndRemoveBackground()
            if (!result) return 'Cancelled'
            setImg(result)
            return 'Background removed'
          })
        }
      />
      <Result state={state} />
      {img ? <Image source={{ uri: img }} className="h-40 w-40 self-center rounded-md bg-muted" /> : null}
    </View>
  )
}

export default function ImageScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Background removal</Text>
      <Section title="Background removal — rembg" description="Pick an image → transparent PNG">
        <RembgTester />
      </Section>
    </PageWrapper>
  )
}
