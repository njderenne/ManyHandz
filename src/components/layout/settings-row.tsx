import { Pressable, View } from 'react-native'
import { Link, type Href } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { Text } from '@/components/ui/text'
import { useColors } from '@/lib/config/theme'

/**
 * SettingsRow — the standard tappable list row for settings-style screens: optional leading
 * icon, title, optional caption, trailing chevron. Stack several inside a Card's CardContent
 * (gap-3) to build a settings section.
 *
 * Navigation: pass `href` to render as an expo-router <Link> (preferred — works on web and
 * supports prefetch semantics), or `onPress` for imperative actions (sign out, opening a mail
 * client). If both are given, `href` wins so a row can never fire two behaviors.
 */
export type SettingsRowProps = {
  /** Row label — already-translated text (callers pass t('…')). */
  title: string
  /** Optional one-line explanation rendered under the title. */
  caption?: string
  /** Optional leading icon, rendered in the muted foreground color. */
  icon?: LucideIcon
  /** Navigate to this route on press. Takes precedence over `onPress`. */
  href?: Href
  /** Imperative press handler — used only when `href` is not provided. */
  onPress?: () => void
}

export function SettingsRow({ title, caption, icon: Icon, href, onPress }: SettingsRowProps) {
  const colors = useColors()

  // When wrapped in <Link asChild>, the Link injects onPress into this Pressable.
  const row = (
    <Pressable
      accessibilityRole={href ? 'link' : 'button'}
      onPress={href ? undefined : onPress}
      className="flex-row items-center justify-between gap-3 py-1 active:opacity-70"
    >
      <View className="flex-1 flex-row items-center gap-3">
        {Icon ? <Icon color={colors.mutedForeground} size={18} /> : null}
        <View className="flex-1 gap-0.5">
          <Text variant="label">{title}</Text>
          {caption ? <Text variant="caption">{caption}</Text> : null}
        </View>
      </View>
      <ChevronRight color={colors.mutedForeground} size={16} />
    </Pressable>
  )

  if (href) {
    return (
      <Link href={href} asChild>
        {row}
      </Link>
    )
  }
  return row
}
