import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated'
import { cn } from '@/lib/utils'

/**
 * Progress — a determinate bar (0–100) whose fill eases to the new value (premium feel) instead
 * of snapping.
 */
export function Progress({ value = 0, className }: { value?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  const w = useSharedValue(pct)
  useEffect(() => {
    w.value = withTiming(pct, { duration: 500, easing: Easing.out(Easing.cubic) })
  }, [pct, w])
  const style = useAnimatedStyle(() => ({ width: `${w.value}%` }))
  return (
    <View
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
    >
      <Animated.View className="h-full rounded-full bg-primary" style={style} />
    </View>
  )
}
