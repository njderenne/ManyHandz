import { View, type StyleProp } from 'react-native'
import type { ImageStyle } from 'expo-image'
import { Paperclip } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { t } from '@/lib/i18n'
import { Text } from '@/components/ui/text'
import { MediaImage } from '@/components/ui/media-image'
import { VoiceMemoPlayer } from '@/components/voice/voice-memo-player'
import type { Media } from '@/lib/db/schema'

/**
 * MediaAttachment — the blessed way to render a SAVED media row in a feed or detail screen. Switches
 * on the row's mimeType so every kind displays correctly through its auth-gated fetch:
 *   image/* → <MediaImage>        (auth-fetched photo)
 *   audio/* → <VoiceMemoPlayer>   (auth-fetched, play/pause)
 *   else    → a labeled attachment chip.
 *
 * Use this instead of `<Image source={{ uri: `${API}/api/media/${id}` }}>` — that bare URL carries
 * no session, so the upload succeeds and the photo silently never renders (the "uploaded but won't
 * display" trap). A media feature isn't done until capture → upload → DISPLAY all work.
 *
 *   {entry.media.map((m) => <MediaAttachment key={m.id} media={m} />)}
 */
export type MediaAttachmentProps = {
  media: Pick<Media, 'id' | 'mimeType' | 'alt' | 'name'>
  /** Style for the image branch (default: full-width 240px, rounded). */
  imageStyle?: StyleProp<ImageStyle>
  className?: string
}

export function MediaAttachment({ media, imageStyle, className }: MediaAttachmentProps) {
  const colors = useColors()

  if (media.mimeType.startsWith('image/')) {
    return (
      <MediaImage
        mediaId={media.id}
        mimeType={media.mimeType}
        alt={media.alt ?? undefined}
        recyclingKey={media.id}
        style={imageStyle ?? { width: '100%', height: 240, borderRadius: 8 }}
      />
    )
  }
  if (media.mimeType.startsWith('audio/')) {
    return <VoiceMemoPlayer mediaId={media.id} label={media.name ?? undefined} className={className} />
  }
  return (
    <View className={cn('flex-row items-center gap-2 rounded-md border border-border bg-card p-3', className)}>
      <Paperclip color={colors.mutedForeground} size={16} />
      <Text variant="muted">{media.name ?? t('media.attachment')}</Text>
    </View>
  )
}
