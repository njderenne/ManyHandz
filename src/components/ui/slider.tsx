import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated'
import { cn } from '@/lib/utils'

/**
 * Slider — draggable value selector on Gesture Handler + Reanimated (no extra native module).
 * The thumb/fill are driven by a shared value on the UI thread, so dragging stays buttery even
 * while the parent re-renders; the stepped value is pushed to `onValueChange` separately.
 * Screen readers step the value via the adjustable increment/decrement actions; while focused
 * the thumb gets the shared focus treatment (ring on web).
 */
const THUMB = 20

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  accessibilityLabel,
  className,
}: {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Names the control for screen readers ("Volume", "Brightness") — pass it whenever the slider lacks a visible label. */
  accessibilityLabel?: string
  className?: string
}) {
  const offset = useSharedValue(0) // 0..1 along the track
  const w = useSharedValue(0)
  const dragging = useSharedValue(false)
  const [focused, setFocused] = useState(false)

  // Defensive: a NaN `value` would wedge the thumb — fall back to min and clamp to range.
  const safeValue = Number.isNaN(value) ? min : Math.max(min, Math.min(max, value))

  // Keep the thumb in sync with the controlled value when not actively dragging.
  useEffect(() => {
    if (!dragging.value) {
      offset.value = max > min ? (safeValue - min) / (max - min) : 0
    }
  }, [safeValue, min, max, offset, dragging])

  const emit = (ratio: number) => {
    const raw = min + ratio * (max - min)
    const stepped = Math.round(raw / step) * step
    onValueChange(Math.max(min, Math.min(max, stepped)))
  }

  /** Step the value from screen-reader adjustable actions (VoiceOver/TalkBack swipe up/down). */
  const nudge = (direction: 1 | -1) => {
    onValueChange(Math.max(min, Math.min(max, safeValue + direction * step)))
  }

  const pan = Gesture.Pan()
    .onBegin((e) => {
      dragging.value = true
      const track = Math.max(1, w.value - THUMB)
      offset.value = Math.max(0, Math.min(1, (e.x - THUMB / 2) / track))
      runOnJS(emit)(offset.value)
    })
    .onUpdate((e) => {
      const track = Math.max(1, w.value - THUMB)
      offset.value = Math.max(0, Math.min(1, (e.x - THUMB / 2) / track))
      runOnJS(emit)(offset.value)
    })
    .onFinalize(() => {
      dragging.value = false
    })

  const fillStyle = useAnimatedStyle(() => ({ width: `${offset.value * 100}%` }))
  const thumbStyle = useAnimatedStyle(() => ({ left: offset.value * Math.max(0, w.value - THUMB) }))

  return (
    <GestureDetector gesture={pan}>
      <View
        className={cn('h-10 justify-center', className)}
        focusable
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min, max, now: safeValue }}
        // Web enhancement path: full ARIA keyboard handling (arrow keys, Home/End, PageUp/Down)
        // would hook key events on this focusable view via react-native-web.
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        onLayout={(e) => {
          w.value = e.nativeEvent.layout.width
        }}
      >
        <View className="h-2 overflow-hidden rounded-full bg-muted">
          <Animated.View className="h-2 rounded-full bg-primary" style={fillStyle} />
        </View>
        <Animated.View
          className={cn(
            'absolute size-5 rounded-full border-2 border-primary bg-card',
            focused && 'web:ring-2 web:ring-primary/20',
          )}
          style={[{ top: 10 }, thumbStyle]}
        />
      </View>
    </GestureDetector>
  )
}
