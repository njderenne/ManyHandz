import { useEffect, useRef, useState } from 'react'
import { View, Pressable, ActivityIndicator } from 'react-native'
import { MotiView } from 'moti'
import { Mic, Square } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { haptics } from '@/lib/native/haptics'
import { t } from '@/lib/i18n'
import { APP_CONFIG } from '@/lib/config/app'
import { useToast } from '@/components/ui/toast'
import { Text } from '@/components/ui/text'
import { useVoiceTranscriber } from '@/lib/native/audio'

/**
 * VoiceNote — a drop-in voice memo recorder. Tap to record, tap to stop; the clip is uploaded to
 * speech-to-text and the transcript comes back through `onTranscript` (with the audio `uri` for
 * callers that want to keep the recording). This is the WHOLE integration for "let the user dictate":
 *
 *   <VoiceNote onTranscript={(text) => setBody((b) => (b ? `${b} ${text}` : text))} />
 *
 * States are explicit and visible: idle → recording (live mm:ss timer + pulsing ring) → transcribing
 * (spinner) → back to idle. Permission denial and STT/network failures surface as a toast and reset
 * to idle — never a crash, never a dead button.
 *
 * Gated on APP_CONFIG.features.voice: when the flag is off the component renders nothing (returns
 * null), so callers can mount it unconditionally and apps opt in by flipping one flag. The recorder
 * and STT upload live in lib/native/audio.ts (expo-audio); this is the UI shell around them.
 *
 * Native module: expo-audio is a native dependency, so recording needs an EAS dev build (no Expo Go).
 */
export type VoiceNoteProps = {
  /** Fired once per finished recording with the STT transcript and the local audio file uri. */
  onTranscript: (text: string, meta: { uri: string | null }) => void
  /** Optional label above the button (e.g. "Add a voice note"). */
  label?: string
  /** Compact mode — hides the helper/status line, for tight rows and toolbars. */
  compact?: boolean
  className?: string
}

type Phase = 'idle' | 'recording' | 'transcribing'

/** Seconds → m:ss for the live timer. */
function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function VoiceNote({ onTranscript, label, compact = false, className }: VoiceNoteProps) {
  // Feature-gated: apps without voice never render the recorder (no "coming soon" stub).
  if (!APP_CONFIG.features.voice) return null
  return <VoiceNoteImpl onTranscript={onTranscript} label={label} compact={compact} className={className} />
}

function VoiceNoteImpl({ onTranscript, label, compact, className }: VoiceNoteProps) {
  const colors = useColors()
  const { toast } = useToast()
  const { start, stop } = useVoiceTranscriber()
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Guards a late async callback (stop/transcribe) from updating state after unmount.
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  async function beginRecording() {
    try {
      const granted = await start()
      if (!mounted.current) return
      if (!granted) {
        // Permission denied at the OS prompt — tell the user where to fix it, stay idle.
        toast({ title: t('voice.permissionDenied'), description: t('voice.permissionHint'), variant: 'error' })
        return
      }
      haptics.medium()
      setElapsed(0)
      setPhase('recording')
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    } catch {
      if (!mounted.current) return
      toast({ title: t('voice.recordError'), variant: 'error' })
      setPhase('idle')
    }
  }

  async function finishRecording() {
    stopTimer()
    haptics.selection()
    setPhase('transcribing')
    try {
      const transcript = await stop()
      if (!mounted.current) return
      setPhase('idle')
      setElapsed(0)
      if (!transcript.trim()) {
        // Recorded silence / nothing recognized — nudge rather than fire an empty callback.
        toast({ title: t('voice.noSpeech'), variant: 'default' })
        return
      }
      haptics.success()
      onTranscript(transcript, { uri: null })
    } catch {
      if (!mounted.current) return
      toast({ title: t('voice.transcribeError'), description: t('voice.transcribeHint'), variant: 'error' })
      setPhase('idle')
      setElapsed(0)
    }
  }

  function onPress() {
    if (phase === 'idle') beginRecording()
    else if (phase === 'recording') finishRecording()
    // transcribing → button is disabled; ignore taps.
  }

  const recording = phase === 'recording'
  const transcribing = phase === 'transcribing'

  const a11yLabel = recording ? t('voice.stopA11y') : t('voice.recordA11y')
  const statusText = recording
    ? t('voice.recording', { time: fmt(elapsed) })
    : transcribing
      ? t('voice.transcribing')
      : t('voice.hint')

  return (
    <View className={cn('items-center gap-2', className)}>
      <Pressable
        onPress={onPress}
        disabled={transcribing}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ disabled: transcribing, busy: transcribing }}
        className="items-center justify-center"
      >
        {/* Pulsing ring while recording — a clear "live" affordance under the round button. */}
        <View className="h-16 w-16 items-center justify-center">
          {recording ? (
            <MotiView
              from={{ opacity: 0.5, scale: 1 }}
              animate={{ opacity: 0, scale: 1.8 }}
              transition={{ type: 'timing', duration: 1200, loop: true, repeatReverse: false }}
              style={{ position: 'absolute', height: 56, width: 56, borderRadius: 28, backgroundColor: colors.destructive }}
            />
          ) : null}
          <View
            className={cn(
              'h-14 w-14 items-center justify-center rounded-full active:scale-95',
              recording ? 'bg-destructive' : 'bg-primary',
              transcribing && 'opacity-60',
            )}
          >
            {transcribing ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : recording ? (
              <Square size={22} color={colors.onPrimary} fill={colors.onPrimary} />
            ) : (
              <Mic size={24} color={colors.onPrimary} />
            )}
          </View>
        </View>
      </Pressable>

      {!compact ? (
        <View className="items-center gap-0.5">
          {label ? <Text variant="label">{label}</Text> : null}
          <Text variant="muted" className={cn(recording && 'text-destructive')}>
            {statusText}
          </Text>
        </View>
      ) : null}
    </View>
  )
}
