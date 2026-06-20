import { useState } from 'react'
import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/gallery/kit'
import { useAsyncAction, Result } from '@/components/gallery/async-action'
import { speak, useVoiceTranscriber } from '@/lib/native/audio'

/** Voice tester — ElevenLabs TTS playback + record → transcribe (STT). */

function VoiceTester() {
  const [text, setText] = useState('Hello from the template.')
  const [transcript, setTranscript] = useState<string | null>(null)
  const { state, run } = useAsyncAction()
  const recorder = useVoiceTranscriber()
  return (
    <View className="gap-3">
      <Input label="Text to speak" value={text} onChangeText={setText} />
      <Button
        label="Speak (TTS)"
        loading={state.status === 'loading'}
        onPress={() =>
          run(async () => {
            await speak(text)
            return 'Played'
          })
        }
      />
      <Result state={state} />
      <Button
        variant="outline"
        label={recorder.isRecording ? 'Stop & transcribe' : 'Record (STT)'}
        onPress={async () => {
          try {
            if (recorder.isRecording) setTranscript(await recorder.stop())
            else await recorder.start()
          } catch (e) {
            setTranscript(e instanceof Error ? e.message : 'Recording failed')
          }
        }}
      />
      {transcript ? <Text variant="muted">Transcript: {transcript}</Text> : null}
    </View>
  )
}

export default function VoiceScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Voice</Text>
      <Section title="Voice — ElevenLabs" description="TTS playback + record → transcribe">
        <VoiceTester />
      </Section>
    </PageWrapper>
  )
}
