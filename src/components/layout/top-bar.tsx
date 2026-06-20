import { View, Pressable } from 'react-native'
import { ChevronLeft } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from '@/components/ui/text'

/**
 * TopBar — the app header. Centered title, optional back button, optional right slot (actions).
 * Pairs with PageWrapper for a screen's chrome.
 */
export type TopBarProps = {
  title: string
  onBack?: () => void
  right?: React.ReactNode
  className?: string
}

export function TopBar({ title, onBack, right, className }: TopBarProps) {
  const colors = useColors()
  return (
    <View
      className={cn(
        'h-14 flex-row items-center justify-between border-b border-border bg-card px-2',
        className,
      )}
    >
      <View className="w-12">
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={8}
            className="size-10 items-center justify-center rounded-full active:bg-accent"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            {/* 24px is the header-icon size (icon IS the button). Inline button icons are 16px,
                row glyphs 20px — bigger here on purpose for the bare-icon touch target. */}
            <ChevronLeft color={colors.foreground} size={24} />
          </Pressable>
        ) : null}
      </View>
      <Text variant="label">{title}</Text>
      <View className="w-12 items-end">{right}</View>
    </View>
  )
}
