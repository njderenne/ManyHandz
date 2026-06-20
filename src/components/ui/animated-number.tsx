import { memo, useEffect, useState } from 'react'
import {
  useSharedValue,
  useAnimatedReaction,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated'
import { Text, type TextProps } from './text'

/**
 * AnimatedNumber — eases from the previous value to the new one (count-up). Great for stats,
 * balances, and counters. Pass `format` to render currency/units. Inherits Text variants.
 * Memoized: the count-up re-renders itself ~60×/s while animating, so parents re-rendering
 * mid-flight shouldn't multiply that work.
 */
function AnimatedNumberImpl({
  value,
  duration = 700,
  format = (n) => String(Math.round(n)),
  ...textProps
}: {
  value: number
  duration?: number
  format?: (n: number) => string
} & Omit<TextProps, 'children'>) {
  const progress = useSharedValue(value)
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    progress.value = withTiming(value, { duration, easing: Easing.out(Easing.cubic) })
  }, [value, duration, progress])

  useAnimatedReaction(
    () => progress.value,
    (current) => runOnJS(setDisplay)(current),
  )

  return <Text {...textProps}>{format(display)}</Text>
}

export const AnimatedNumber = memo(AnimatedNumberImpl)
