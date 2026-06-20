import { useEffect, useRef, useState } from 'react'
import { View, ActivityIndicator } from 'react-native'
// RNGH's Pressable (not RN's): its NATIVE gesture recognizer fires reliably for small round targets
// inside a ScrollView, where RN's built-in Pressable loses the touch responder to the scroll view on
// the new architecture — the "tap record/stop/play a dozen times before it registers" bug. The
// visual styling stays on inner <View>s so NativeWind className is never routed through this
// component (no cssInterop, no risk of the silent className-drop the kit hit once with an Animated
// Pressable). GestureHandlerRootView is already mounted at the app root.
import { Pressable } from 'react-native-gesture-handler'
import { MotiView } from 'moti'
import { Mic, Square, Play, RotateCcw } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { haptics } from '@/lib/native/haptics'
import { t } from '@/lib/i18n'
import { APP_CONFIG } from '@/lib/config/app'
import { useToast } from '@/components/ui/toast'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { useVoiceMemo, playMemo } from '@/lib/native/audio'
import { uploadMedia, MediaNotConfiguredError } from '@/lib/media/upload'
import type { Media } from '@/lib/db/schema'

/**
 * VoiceMemo — record an actual AUDIO keepsake (not a transcript). Tap to record, tap to stop, then
 * review (play it back), and Save keeps the real recording: the clip is uploaded to media (R2) and
 * the saved `media` row comes back through `onSaved` — store it with your entry, then play it later
 * with <VoiceMemoPlayer mediaId={…}/>.
 *
 *   <VoiceMemo onSaved={(media) => attachToEntry(media.id)} />
 *
 * For voice→text (dictation, AI input) use <VoiceNote> instead — that transcribes and discards the
 * audio. This component is the opposite: the audio IS the artifact.
 *
 * Flow: idle → recording (live timer + pulse) → review (play / re-record / save) → saving → idle.
 * Saving needs media storage; if R2 isn't enabled the save surfaces a friendly toast and stays in
 * review so nothing is lost. Gated on APP_CONFIG.features.voice (renders null when off — no stub).
 * expo-audio is a native module, so recording needs an EAS dev build.
 */
export type VoiceMemoProps = {
  /** Fired once the recording is saved to media — persist `media.id` with your entry. */
  onSaved: (media: Media) => void
  label?: string
  className?: string
}

type Phase = 'idle' | 'recording' | 'review' | 'saving'

/** Seconds → m:ss. */
function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function VoiceMemo(props: VoiceMemoProps) {
  if (!APP_CONFIG.features.voice) return null
  return <VoiceMemoImpl {...props} />
}

function VoiceMemoImpl({ onSaved, label, className }: VoiceMemoProps) {
  const colors = useColors()
  const { toast } = useToast()
  const { start, stop } = useVoiceMemo()
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [clipUri, setClipUri] = useState<string | null>(null)
  // In-flight guard for the async start/stop window. On iOS the FIRST record tap triggers a blocking
  // mic-permission dialog; without this the button stays tappable, so impatient taps queue overlapping
  // start() calls (the "had to press it ten times" bug). True = a start/stop is resolving.
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(true)
  // The review-playback player, kept in a ref so we can release it before the next play and on
  // unmount — an orphaned player holds the iOS audio session and blocks the next recording.
  const playerRef = useRef<ReturnType<typeof playMemo> | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timerRef.current) clearInterval(timerRef.current)
      playerRef.current?.remove?.()
    }
  }, [])

  // Release the review player whenever we leave review (re-record, saved, or discarded → idle) so it
  // can't linger holding the iOS audio session and stall the next recording.
  useEffect(() => {
    if (phase === 'idle') {
      playerRef.current?.remove?.()
      playerRef.current = null
    }
  }, [phase])

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  async function beginRecording() {
    if (busy || phase !== 'idle') return // ignore taps while a start/stop is already resolving
    setBusy(true)
    try {
      const granted = await start()
      if (!mounted.current) return
      if (!granted) {
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
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function finishRecording() {
    if (busy) return
    setBusy(true)
    stopTimer()
    haptics.selection()
    try {
      const uri = await stop()
      if (!mounted.current) return
      if (!uri) {
        toast({ title: t('voice.noSpeech'), variant: 'default' })
        setPhase('idle')
        setElapsed(0)
        return
      }
      setClipUri(uri)
      setPhase('review')
    } catch {
      if (!mounted.current) return
      toast({ title: t('voice.recordError'), variant: 'error' })
      setPhase('idle')
      setElapsed(0)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  function playClip() {
    if (!clipUri) return
    // Release the previous player before making a new one — otherwise it lingers holding the iOS
    // audio session (GC is not prompt), which is what makes the NEXT recording need many taps.
    playerRef.current?.remove?.()
    const player = playMemo(clipUri)
    playerRef.current = player
    player.play()
  }

  function reRecord() {
    setClipUri(null)
    setElapsed(0)
    setPhase('idle')
  }

  async function save() {
    if (!clipUri) return
    setPhase('saving')
    try {
      const media = await uploadMedia(clipUri, { mimeType: 'audio/mp4' })
      if (!mounted.current) return
      haptics.success()
      toast({ title: t('voice.saved'), variant: 'success' })
      onSaved(media)
      setClipUri(null)
      setElapsed(0)
      setPhase('idle')
    } catch (e) {
      if (!mounted.current) return
      if (e instanceof MediaNotConfiguredError) {
        toast({ title: t('media.notConfiguredTitle'), description: t('media.notConfiguredHint'), variant: 'error' })
      } else {
        toast({ title: t('voice.saveError'), description: t('voice.transcribeHint'), variant: 'error' })
      }
      setPhase('review') // keep the clip so the user can retry, not lose the recording
    }
  }

  const recording = phase === 'recording'
  const saving = phase === 'saving'

  // Review card — play it back, then keep or redo. The recording is safe until they choose.
  // w-full so the card fills its container and the Re-record/Save buttons keep their labels — without
  // it, a parent that centers content (items-center) shrink-wraps the card and crushes the buttons
  // into unlabeled blobs (the "I can't find Save" bug).
  if (phase === 'review' || saving) {
    return (
      <View className={cn('w-full gap-3 rounded-xl border border-border bg-card p-4', className)}>
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={playClip}
            disabled={saving}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('voice.play')}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
          >
            <View className="h-11 w-11 items-center justify-center rounded-full bg-primary">
              <Play size={20} color={colors.onPrimary} fill={colors.onPrimary} />
            </View>
          </Pressable>
          <View className="flex-1">
            <Text variant="label">{label ?? t('voice.memoReady')}</Text>
            <Text variant="muted">{fmt(elapsed)}</Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            icon={RotateCcw}
            label={t('voice.rerecord')}
            disabled={saving}
            onPress={reRecord}
          />
          <Button
            size="sm"
            className="flex-1"
            label={saving ? t('voice.saving') : t('voice.save')}
            loading={saving}
            onPress={save}
          />
        </View>
      </View>
    )
  }

  // idle / recording — the round mic/stop button.
  const a11yLabel = recording ? t('voice.stopA11y') : t('voice.recordA11y')
  const statusText = recording ? t('voice.recording', { time: fmt(elapsed) }) : t('voice.hint')

  return (
    <View className={cn('items-center gap-2', className)}>
      <Pressable
        onPress={recording ? finishRecording : beginRecording}
        disabled={busy}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ disabled: busy, busy }}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
      >
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
              'h-14 w-14 items-center justify-center rounded-full',
              recording ? 'bg-destructive' : 'bg-primary',
              busy && 'opacity-70',
            )}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : recording ? (
              <Square size={22} color={colors.onPrimary} fill={colors.onPrimary} />
            ) : (
              <Mic size={24} color={colors.onPrimary} />
            )}
          </View>
        </View>
      </Pressable>
      <View className="items-center gap-0.5">
        {label ? <Text variant="label">{label}</Text> : null}
        <Text variant="muted" className={cn(recording && 'text-destructive')}>
          {statusText}
        </Text>
      </View>
    </View>
  )
}
