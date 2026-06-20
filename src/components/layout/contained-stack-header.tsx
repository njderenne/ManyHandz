import { View, Pressable } from 'react-native'
import { ChevronLeft } from 'lucide-react-native'
import { useColors } from '@/lib/config/theme'
import { Text } from '@/components/ui/text'

/**
 * ContainedStackHeader — a desktop-web replacement for the default Stack header.
 *
 * The default React Navigation header is full-width and pins the back button + title to the far-left
 * screen edge — which, next to a centered content column on a wide desktop, leaves the chrome
 * stranded in the gutter. This header constrains the SAME pieces the default would render — the back
 * affordance (a screen's custom `headerLeft` if it supplies one, else a back arrow when there's
 * somewhere to go back to), the title, and any `headerRight` action — to the centered content lane
 * (max-w-4xl, identical to PageWrapper's web 'content' lane) so they line up with the page body.
 *
 * Wired into the navigator's screenOptions.header ONLY on wide web (app/_layout.tsx). Native and
 * narrow web keep the stock React Navigation header — this component never renders there.
 */
type HeaderSlot = (props: { canGoBack?: boolean; tintColor?: string }) => React.ReactNode
type ContainedStackHeaderProps = {
  navigation: { goBack: () => void }
  options: { title?: string; headerLeft?: HeaderSlot; headerRight?: HeaderSlot }
  back?: unknown
}

export function ContainedStackHeader({ navigation, options, back }: ContainedStackHeaderProps) {
  const colors = useColors()
  const slotProps = { canGoBack: !!back, tintColor: colors.foreground }
  return (
    <View className="border-b border-border bg-card">
      <View className="h-14 w-full max-w-4xl flex-row items-center gap-1 self-center px-2">
        {options.headerLeft ? (
          options.headerLeft(slotProps)
        ) : back ? (
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            className="size-10 items-center justify-center rounded-full active:bg-accent"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft color={colors.foreground} size={24} />
          </Pressable>
        ) : null}
        <Text variant="label">{options.title ?? ''}</Text>
        <View className="flex-1" />
        {options.headerRight ? options.headerRight(slotProps) : null}
      </View>
    </View>
  )
}
