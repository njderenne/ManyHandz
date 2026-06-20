import { Image as ExpoImage, type ImageProps } from 'expo-image'
import { useColors } from '@/lib/config/theme'

/**
 * AppImage — the canonical image. Wraps expo-image so every image in the app gets disk/memory
 * caching, a 200ms cross-fade, and a theme-correct loading surface for free; screens never touch
 * RN's bare Image. Pass `blurhash`/`thumbhash` for a real placeholder when the source provides
 * one, and `recyclingKey` (e.g. the item id) inside FlashList/FlatList rows so recycled views
 * don't flash the previous row's image.
 *
 * For a SAVED app photo (a `media.id` from an upload), do NOT pass a remote `{ uri, headers }` here —
 * `GET /api/media/:id` is auth-gated and the image request won't carry the session. Use
 * `<MediaImage mediaId>` (which auth-fetches to a local file), or `<MediaAttachment media>` to render
 * any media row by type.
 */
export type AppImageProps = ImageProps & {
  /** Compact blurhash placeholder string (https://blurha.sh) shown while loading. */
  blurhash?: string
  /** Compact thumbhash placeholder string (https://evanw.github.io/thumbhash) shown while loading. */
  thumbhash?: string
}

export function AppImage({
  blurhash,
  thumbhash,
  placeholder,
  contentFit = 'cover',
  transition = 200,
  style,
  ...props
}: AppImageProps) {
  const colors = useColors()
  return (
    <ExpoImage
      contentFit={contentFit}
      transition={transition}
      placeholder={placeholder ?? (blurhash ? { blurhash } : thumbhash ? { thumbhash } : undefined)}
      // Skeleton-token backdrop fills the frame until the placeholder/image decodes.
      style={[{ backgroundColor: colors.skeleton }, style]}
      {...props}
    />
  )
}
