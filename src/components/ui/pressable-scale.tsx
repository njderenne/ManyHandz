import { Pressable, type PressableProps } from 'react-native'

/**
 * PressableScale — the app's canonical pressable.
 *
 * Deliberately a *plain* Pressable: NativeWind's `className` applies to it reliably, and press
 * feedback (scale + opacity/bg) is expressed declaratively with `active:` utilities in the caller's
 * className (see button.tsx). The previous version wrapped `Animated.createAnimatedComponent(Pressable)`
 * with a manual `cssInterop`, which conflicts with NativeWind v4's JSX transform and SILENTLY DROPPED
 * className on native — so every Button rendered as bare text with no background/padding. Keeping the
 * press animation in `active:*` classes means styling can never be dropped by an interop edge case again.
 */
export type PressableScaleProps = PressableProps

export function PressableScale(props: PressableScaleProps) {
  return <Pressable {...props} />
}
