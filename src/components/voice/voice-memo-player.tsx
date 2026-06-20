import { useEffect, useRef, useState } from 'react'
import { View, Pressable, Platform, ActivityIndicator } from 'react-native'
import { Play, Pause } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { t } from '@/lib/i18n'
import { API_BASE_URL } from '@/lib/api/client'
import { useToast } from '@/components/ui/toast'
import { Text } from '@/components/ui/text'
import { playMemo, fetchMemoFile } from '@/lib/native/audio'

/**
 * VoiceMemoPlayer — play back a SAVED voice memo (the `media.id` you stored from <VoiceMemo>).
 *
 * `GET /api/media/:id` is auth-gated. On NATIVE there's no cookie jar and expo-audio can't carry the
 * session, so the clip is fetched WITH the session into a cached file (fetchMemoFile) and played from
 * disk via expo-audio. On WEB the browser auto-sends the same-origin session cookie, so an
 * HTMLAudioElement streams the URL directly — expo-file-system/expo-audio don't exist in the browser.
 * This is the same platform split MediaImage uses for photos. Tap to play/pause.
 *
 *   <VoiceMemoPlayer mediaId={entry.voiceMemoId} label="Cassie's first word" />
 */
export type VoiceMemoPlayerProps = {
  /** The stored media row id of the recording. */
  mediaId: string
  label?: string
  className?: string
}

/** Platform-uniform playback handle the component drives — built per platform in buildPlayer(). */
type MemoHandle = { restart: () => void; pause: () => void; release: () => void }

/** Minimal HTMLAudioElement surface (the kit's tsconfig doesn't pull in the DOM lib, so we don't lean
 *  on the global Audio type). Only the web branch constructs one; native never reaches it. */
type WebAudio = {
  currentTime: number
  play: () => Promise<void>
  pause: () => void
  addEventListener: (type: 'ended', listener: () => void) => void
}

export function VoiceMemoPlayer({ mediaId, label, className }: VoiceMemoPlayerProps) {
  const colors = useColors()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  // Built lazily on first play and reused for re-plays; released on unmount.
  const playerRef = useRef<MemoHandle | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      playerRef.current?.release()
    }
  }, [])

  // Web streams the auth-gated URL through an HTMLAudioElement (the same-origin cookie authenticates);
  // native fetches the clip into a cached file and plays it with expo-audio. Same split as MediaImage.
  async function buildPlayer(): Promise<MemoHandle> {
    if (Platform.OS === 'web') {
      const Ctor = (globalThis as unknown as { Audio: new (src: string) => WebAudio }).Audio
      const audio = new Ctor(`${API_BASE_URL}/api/media/${mediaId}`)
      audio.addEventListener('ended', () => {
        if (mounted.current) setPlaying(false)
      })
      return {
        restart: () => {
          audio.currentTime = 0
          void audio.play()
        },
        pause: () => audio.pause(),
        release: () => audio.pause(),
      }
    }
    const uri = await fetchMemoFile(mediaId)
    const player = playMemo(uri)
    player.addListener('playbackStatusUpdate', (status: { didJustFinish?: boolean }) => {
      if (status.didJustFinish && mounted.current) setPlaying(false)
    })
    return {
      restart: () => {
        player.seekTo(0)
        player.play()
      },
      pause: () => player.pause(),
      release: () => player.remove?.(),
    }
  }

  async function toggle() {
    if (playing) {
      playerRef.current?.pause()
      setPlaying(false)
      return
    }
    try {
      if (!playerRef.current) {
        setLoading(true)
        const handle = await buildPlayer()
        if (!mounted.current) {
          handle.release()
          return
        }
        playerRef.current = handle
        setLoading(false)
      }
      playerRef.current.restart()
      setPlaying(true)
    } catch {
      if (!mounted.current) return
      setLoading(false)
      toast({ title: t('voice.playError'), variant: 'error' })
    }
  }

  return (
    <Pressable
      onPress={toggle}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={playing ? t('voice.pauseA11y') : t('voice.playA11y')}
      className={cn('flex-row items-center gap-3 self-start rounded-full border border-border bg-card py-2 pl-2 pr-4 active:opacity-80', className)}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-primary">
        {loading ? (
          <ActivityIndicator size="small" color={colors.onPrimary} />
        ) : playing ? (
          <Pause size={18} color={colors.onPrimary} fill={colors.onPrimary} />
        ) : (
          <Play size={18} color={colors.onPrimary} fill={colors.onPrimary} />
        )}
      </View>
      <Text variant="label">{label ?? t('voice.memoLabel')}</Text>
    </Pressable>
  )
}
