import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated'

/**
 * SwipeToDismiss — wrap any content to make it horizontally swipeable; past a threshold it
 * flings off-screen and calls `onDismiss`. Runs on the native UI thread (Reanimated + Gesture
 * Handler). Used for dismissible cards, toasts, "swipe to close" rows.
 */
export function SwipeToDismiss({
  children,
  onDismiss,
  threshold = 120,
}: {
  children: React.ReactNode
  onDismiss?: () => void
  threshold?: number
}) {
  const tx = useSharedValue(0)

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > threshold) {
        tx.value = withTiming(Math.sign(e.translationX) * 600)
        if (onDismiss) runOnJS(onDismiss)()
      } else {
        tx.value = withSpring(0)
      }
    })

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    opacity: 1 - Math.min(Math.abs(tx.value) / 320, 0.65),
  }))

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  )
}
