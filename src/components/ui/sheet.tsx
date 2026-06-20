import { useEffect, useMemo, useState } from 'react'
import { Keyboard, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { X } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * SheetModal — a true draggable bottom sheet we own (no @gorhom dependency).
 *
 * Controlled via `visible` + `onClose` (the same API as Dialog/ActionSheet, so swapping between
 * them is a one-word change). The sheet pans on the UI thread (Gesture Handler + Reanimated shared
 * values, same pattern as slider.tsx), springs between `snapPoints` (fractions of the window
 * height, e.g. [0.4, 0.9]), and closes on a downward fling, a drag past the lowest snap, a
 * backdrop tap, or the hardware back button. The backdrop fades with drag progress, and the sheet
 * lifts above the keyboard so inputs inside stay visible.
 *
 * Use ActionSheet for simple tap-a-row menus; use SheetModal when content needs height, dragging
 * between detents, or keyboard interaction.
 */
export type SheetModalProps = {
  visible: boolean
  onClose: () => void
  /** Snap detents as fractions of the window height, ascending. Opens at the first one. */
  snapPoints?: number[]
  title?: string
  /** Show the upper-right close (✕) button. Default true — every window closes the same two ways. */
  showClose?: boolean
  children?: React.ReactNode
  className?: string
}

const SPRING = { damping: 28, stiffness: 320, mass: 0.9 }

export function SheetModal({
  visible,
  onClose,
  snapPoints = [0.5, 0.9],
  title,
  showClose = true,
  children,
  className,
}: SheetModalProps) {
  const colors = useColors()
  const { height: windowH } = useWindowDimensions()
  // Keep the Modal mounted while the exit spring plays, then unmount.
  const [mounted, setMounted] = useState(visible)

  // Sheet height = the tallest detent; translateY positions it (0 = fully open, sheetH = hidden).
  // Keyed on the *contents* of snapPoints so inline arrays don't re-trigger the open spring
  // (and yank the sheet back to the first detent) every time the parent re-renders.
  const snapKey = snapPoints.join(',')
  const fractions = useMemo(
    () => (snapPoints.length ? [...snapPoints].sort((a, b) => a - b) : [0.5]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapKey],
  )
  const sheetH = Math.round(fractions[fractions.length - 1]! * windowH)
  const detents = useMemo(
    () => fractions.map((f) => sheetH - Math.round(f * windowH)),
    [fractions, sheetH, windowH],
  )

  const translateY = useSharedValue(sheetH)
  const dragStartY = useSharedValue(0)
  const keyboardH = useSharedValue(0)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      translateY.value = withSpring(detents[0]!, SPRING)
    } else {
      translateY.value = withSpring(sheetH, SPRING, (finished) => {
        if (finished) runOnJS(setMounted)(false)
      })
    }
  }, [visible, detents, sheetH, translateY])

  // Keyboard-safe: lift the sheet by the keyboard height (the gap it leaves sits under the keyboard).
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvt, (e) => {
      keyboardH.value = withTiming(e.endCoordinates.height, { duration: 220 })
    })
    const hide = Keyboard.addListener(hideEvt, () => {
      keyboardH.value = withTiming(0, { duration: 220 })
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [keyboardH])

  const pan = Gesture.Pan()
    .onBegin(() => {
      dragStartY.value = translateY.value
    })
    .onUpdate((e) => {
      const next = dragStartY.value + e.translationY
      // Rubber-band when dragged above the tallest detent.
      translateY.value = next < 0 ? next / 3 : next
    })
    .onEnd((e) => {
      // Project where the gesture is headed, then spring to the nearest detent (or close).
      const projected = translateY.value + e.velocityY * 0.15
      const candidates = [...detents, sheetH]
      let dest = candidates[0]!
      for (const c of candidates) {
        if (Math.abs(c - projected) < Math.abs(dest - projected)) dest = c
      }
      if (dest === sheetH) {
        runOnJS(onClose)()
      } else {
        translateY.value = withSpring(dest, SPRING)
      }
    })

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, translateY.value) - keyboardH.value }],
  }))
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [detents[detents.length - 1]!, sheetH], [1, 0]),
  }))

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Gestures inside a Modal need their own root view on Android. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View
          className="bg-black/60"
          style={[StyleSheet.absoluteFill, backdropStyle]}
        />
        <Pressable
          onPress={onClose}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close sheet"
        />
        <GestureDetector gesture={pan}>
          <Animated.View
            className={cn('absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card', className)}
            style={[{ height: sheetH }, sheetStyle]}
          >
            <View className="items-center px-4 pb-2 pt-3">
              <View className="h-1 w-10 rounded-full bg-border" />
            </View>
            {showClose ? (
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                className="absolute right-2 top-2 z-10 size-9 items-center justify-center rounded-full active:bg-accent"
              >
                <X size={20} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
            {title ? (
              <Text variant="muted" className="px-4 pb-2 text-center uppercase tracking-wider">
                {title}
              </Text>
            ) : null}
            <View className="flex-1 px-4 pb-9">{children}</View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  )
}
