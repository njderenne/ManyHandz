import { useState } from 'react'
import { View, Image } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { pickImage, takePhoto } from '@/lib/native/image-picker'

/** Camera tester — pick from the library or shoot a photo, then preview it. */
export default function CameraScreen() {
  const [photo, setPhoto] = useState<string | null>(null)

  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Camera & Photos</Text>
      <Section title="Camera & photos" description="expo-image-picker">
        <View className="flex-row gap-2">
          <Button
            variant="outline"
            label="Pick image"
            onPress={async () => {
              const uri = await pickImage()
              if (uri) setPhoto(uri)
            }}
          />
          <Button
            variant="outline"
            label="Take photo"
            onPress={async () => {
              const uri = await takePhoto()
              if (uri) setPhoto(uri)
            }}
          />
        </View>
        {photo ? (
          <Image source={{ uri: photo }} style={{ width: '100%', height: 200, borderRadius: 12 }} />
        ) : null}
      </Section>
    </PageWrapper>
  )
}
