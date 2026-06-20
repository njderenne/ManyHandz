import { useState } from 'react'
import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Section } from '@/components/gallery/kit'
import { useAsyncAction, Result } from '@/components/gallery/async-action'
import { streamCompletion, type AiTier } from '@/lib/api/stream'
import { VoiceNote } from '@/components/voice'
import { APP_CONFIG } from '@/lib/config/app'

/** AI tester — streaming completion against the Worker's tiered AI route. */

function AiTester() {
  const [prompt, setPrompt] = useState('Write a friendly one-line hello.')
  const [tier, setTier] = useState('reason')
  const [output, setOutput] = useState('')
  const { state, run } = useAsyncAction()
  return (
    <View className="gap-3">
      <Input label="Prompt" value={prompt} onChangeText={setPrompt} />
      <SegmentedControl
        value={tier}
        onValueChange={setTier}
        options={[
          { label: 'Classify', value: 'classify' },
          { label: 'Reason', value: 'reason' },
          { label: 'Complex', value: 'complex' },
        ]}
      />
      <Button
        label="Run AI"
        loading={state.status === 'loading'}
        onPress={() =>
          run(async () => {
            setOutput('')
            let text = ''
            await streamCompletion({ prompt, tier: tier as AiTier }, (chunk) => {
              text += chunk
              setOutput(text)
            })
            return text ? 'Done' : 'No output'
          })
        }
      />
      {output ? <Text variant="muted">{output}</Text> : null}
      <Result state={state} />
    </View>
  )
}

/** Voice-note demo — record → STT → transcript. Lives behind APP_CONFIG.features.voice. */
function VoiceTester() {
  const [transcript, setTranscript] = useState('')
  return (
    <View className="items-center gap-4">
      <VoiceNote
        label="Tap to dictate"
        onTranscript={(text) => setTranscript((prev) => (prev ? `${prev} ${text}` : text))}
      />
      {transcript ? (
        <View className="w-full gap-2">
          <Text variant="muted">{transcript}</Text>
          <Button label="Clear" variant="outline" size="sm" onPress={() => setTranscript('')} />
        </View>
      ) : null}
    </View>
  )
}

export default function AiScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">AI</Text>
      <Section title="AI — Claude · OpenAI · Grok" description="Tiered: classify → OpenAI · reason → Sonnet · complex → Opus">
        <AiTester />
      </Section>
      <Section
        title="Voice notes"
        description={
          APP_CONFIG.features.voice
            ? 'Record → speech-to-text → transcript (needs an EAS dev build — mic is a native module).'
            : 'Disabled — set features.voice: true in src/lib/config/app.ts to enable.'
        }
      >
        <VoiceTester />
      </Section>
    </PageWrapper>
  )
}
