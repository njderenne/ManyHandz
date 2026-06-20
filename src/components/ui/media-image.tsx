import { useEffect, useState } from 'react'
import { View, Platform, type StyleProp } from 'react-native'
import type { ImageStyle } from 'expo-image'
import { ImageOff } from 'lucide-react-native'
import { useColors } from '@/lib/config/theme'
import { t } from '@/lib/i18n'
import { Text } from '@/components/ui/text'
import { AppImage, type AppImageProps } from '@/components/ui/image'
import { API_BASE_URL } from '@/lib/api/client'
import { fetchMediaFile, extFromMime } from '@/lib/media/fetch'

/**
 * MediaImage — display a SAVED media photo by its `media.id`.
 *
 * `GET /api/media/:id` is auth-gated. On NATIVE there's no cookie jar and a bare remote URL in
 * <Image> can't carry the session (iOS even disk-caches the 401), so this fetches the bytes WITH the
 * session into a cached local file (see fetchMediaFile) and renders THAT — exactly how
 * <VoiceMemoPlayer> handles audio. On WEB the browser auto-sends the same-origin session cookie to
 * the media route, so a direct URL works (and expo-file-system can't cache on web anyway). The point
 * is the same on both: never hand a remote `{ uri, headers }` to expo-image for app media.
 *
 *   <MediaImage mediaId={media.id} mimeType={media.mimeType} alt={media.alt}
 *               style={{ width: '100%', height: 280, borderRadius: 8 }} />
 */
export type MediaImageProps = {
  /** The stored media row id. */
  mediaId: string
  /** The row's mimeType — used to pick a sane cache-file extension. */
  mimeType: string
  alt?: string
  contentFit?: AppImageProps['contentFit']
  /** Pass the item id inside FlashList/FlatList rows so recycled views don't flash a stale image. */
  recyclingKey?: string
  style?: StyleProp<ImageStyle>
}

export function MediaImage({ mediaId, mimeType, alt, contentFit, recyclingKey, style }: MediaImageProps) {
  const colors = useColors()
  const [uri, setUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // Per-effect token (not a shared ref) so a late OLD fetch can't overwrite a newer mediaId.
    let active = true
    setFailed(false)
    if (Platform.OS === 'web') {
      // Same-origin cookie authenticates the direct request; no native fetch-to-cache.
      setUri(`${API_BASE_URL}/api/media/${mediaId}`)
      return
    }
    setUri(null)
    fetchMediaFile(mediaId, extFromMime(mimeType))
      .then((u) => active && setUri(u))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [mediaId, mimeType])

  if (failed) {
    return (
      <View
        className="items-center justify-center gap-1 rounded-md border border-border bg-card"
        style={[{ minHeight: 120 }, style as object]}
      >
        <ImageOff color={colors.mutedForeground} size={20} />
        <Text variant="caption">{t('media.loadError')}</Text>
      </View>
    )
  }
  if (!uri) {
    // Skeleton surface while the authenticated fetch resolves.
    return <View className="rounded-md" style={[{ backgroundColor: colors.skeleton, minHeight: 120 }, style as object]} />
  }
  return <AppImage source={{ uri }} alt={alt} contentFit={contentFit} recyclingKey={recyclingKey} style={style} />
}
