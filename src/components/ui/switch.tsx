import { Platform, Switch as RNSwitch, type SwitchProps } from 'react-native'
import { useColors } from '@/lib/config/theme'

/**
 * Switch — themed wrapper around RN's native Switch (real platform toggle on iOS/Android).
 * Track/thumb colors come from the design tokens.
 *
 * All RN Switch props pass through via the spread — including `disabled` and the accessibility
 * props (`accessibilityLabel`, etc.); the native toggle exposes its disabled state to screen
 * readers on its own, so no extra accessibilityState wiring is needed here.
 */
export function Switch(props: SwitchProps) {
  const colors = useColors()
  return (
    <RNSwitch
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor={colors.onPrimary}
      ios_backgroundColor={colors.border}
      // react-native-web styles the ON thumb via the web-only activeThumbColor prop
      // (thumbColor only covers OFF) — without it the checked thumb is RNW's hardcoded gray.
      {...(Platform.OS === 'web' ? ({ activeThumbColor: colors.onPrimary } as object) : null)}
      {...props}
    />
  )
}
