import { View, Pressable, type PressableProps } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { useIsWideWeb } from '@/lib/hooks/use-is-wide-web'

/**
 * FAB — floating action button, pinned bottom-right. Use for the primary action of a screen
 * (compose, add, …). Has a real elevation/shadow for depth.
 *
 * Position adapts to the surface:
 *  - Native + narrow web: bottom-right of the SCREEN. On narrow web it clears the bottom nav with an
 *    extra offset (web:bottom-24); native uses bottom-6 (web: variants compile out, and the nav is
 *    handled by safe-area insets).
 *  - Wide desktop web: bottom-right of the centered CONTENT LANE (same max-w-4xl as the page body),
 *    not the screen edge — so it lines up with the contained column instead of flying to the corner.
 */
export type FABProps = Omit<PressableProps, 'children'> & {
  icon: LucideIcon
  /** Required: the icon is the only content, so screen readers need a name ("Add plant"). */
  accessibilityLabel: string
}

export function FAB({ icon: Icon, className, ...props }: FABProps) {
  const colors = useColors()
  const wideWeb = useIsWideWeb()

  const button = (
    <Pressable
      className={cn('size-14 items-center justify-center rounded-full bg-primary active:opacity-90', className)}
      style={{
        elevation: 6,
        shadowColor: colors.shadow,
        shadowOpacity: 0.3,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      }}
      accessibilityRole="button"
      {...props}
    >
      <Icon color={colors.onPrimary} size={26} />
    </Pressable>
  )

  // Wide web: a click-through overlay centers a max-w-4xl lane (the web 'content' lane) and pins the
  // button to its bottom-right corner, so the FAB aligns with the contained content column.
  if (wideWeb) {
    return (
      <View pointerEvents="box-none" className="absolute inset-0 items-center">
        <View pointerEvents="box-none" className="w-full max-w-4xl flex-1">
          <View className="absolute bottom-6 right-6">{button}</View>
        </View>
      </View>
    )
  }

  // Native + narrow web: pinned to the screen's bottom-right (clearing the bottom bar on web).
  return (
    <View pointerEvents="box-none" className="absolute bottom-6 right-6 web:bottom-24">
      {button}
    </View>
  )
}
