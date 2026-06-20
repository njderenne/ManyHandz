import { View } from 'react-native'
import { cn } from '@/lib/utils'
import { fonts } from '@/lib/config/fonts'
import { AppImage } from './image'
import { Text } from './text'

/**
 * Avatar — circular user image with an initials fallback when no `uri` is provided. The photo
 * renders through AppImage, so avatars get caching, a cross-fade, and recycling-safe loading in
 * lists without each call site thinking about it.
 */
export type AvatarProps = {
  uri?: string
  name?: string
  size?: number
  className?: string
}

function initialsFrom(name?: string) {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function Avatar({ uri, name, size = 40, className }: AvatarProps) {
  return (
    <View
      className={cn('items-center justify-center overflow-hidden rounded-full bg-accent', className)}
      style={{ width: size, height: size }}
      accessibilityRole="image"
      accessibilityLabel={name}
    >
      {uri ? (
        <AppImage source={{ uri }} recyclingKey={uri} style={{ width: size, height: size }} />
      ) : (
        <Text
          className="text-foreground"
          style={{ fontSize: size * 0.4, fontFamily: fonts.semibold }}
        >
          {initialsFrom(name)}
        </Text>
      )}
    </View>
  )
}
