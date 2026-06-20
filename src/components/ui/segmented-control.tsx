import { useEffect, useState } from 'react'
import { View, Pressable } from 'react-native'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated'
import { cn } from '@/lib/utils'
import { haptics } from '@/lib/native/haptics'
import { Text } from './text'

/**
 * SegmentedControl — a pill toggle between 2–4 mutually exclusive options. The active pill slides
 * between segments on the UI thread (Reanimated), so switching feels smooth rather than snapping.
 * Controlled via `value` + `onValueChange`.
 */
export type SegmentOption = { label: string; value: string }

export type SegmentedControlProps = {
  options: SegmentOption[]
  value?: string
  onValueChange?: (value: string) => void
  className?: string
}

export function SegmentedControl({ options, value, onValueChange, className }: SegmentedControlProps) {
  const [containerWidth, setContainerWidth] = useState(0)
  const x = useSharedValue(0)
  // Raw index: -1 (no/unknown value) means NO pill — clamping to 0 would render a selected-
  // looking first segment whose label still styles as inactive.
  const activeIndex = options.findIndex((o) => o.value === value)
  const segW = containerWidth > 0 ? (containerWidth - 8) / options.length : 0 // -8 for the p-1 inset

  useEffect(() => {
    x.value = withTiming(Math.max(0, activeIndex) * segW, { duration: 180, easing: Easing.out(Easing.cubic) })
  }, [activeIndex, segW, x])

  const pillStyle = useAnimatedStyle(() => ({ width: segW, transform: [{ translateX: x.value }] }))

  return (
    <View
      className={cn('flex-row rounded-lg bg-muted p-1', className)}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {segW > 0 && activeIndex >= 0 ? (
        <Animated.View
          // border keeps the pill visible in light mode, where card-on-muted is white-on-near-white
          className="absolute rounded-md border border-border bg-card"
          style={[{ top: 4, bottom: 4, left: 4 }, pillStyle]}
        />
      ) : null}
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <Pressable
            key={opt.value}
            // Select on touch-down — the pill starts sliding the moment the finger lands.
            onPressIn={() => {
              haptics.selection()
              onValueChange?.(opt.value)
            }}
            // Not redundant: screen-reader/keyboard activation fires onPress without a real
            // touch-down, so this is the accessibility path (idempotent with onPressIn).
            onPress={() => onValueChange?.(opt.value)}
            accessibilityRole="tab"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: active }}
            className="flex-1 items-center py-2 active:opacity-70"
          >
            <Text variant={active ? 'label' : 'muted'}>{opt.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
