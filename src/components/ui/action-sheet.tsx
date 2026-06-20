import { Modal, View, Pressable, StyleSheet } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { X } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * ActionSheet — a bottom sheet that slides up for contextual actions / "More" menus.
 *
 * Closes three consistent ways (matching SheetModal/Dialog so every window behaves alike): tap the
 * scrim, tap the upper-right ✕, or drag the sheet down past a threshold (it follows your finger and
 * springs back if you don't commit). Compose rows (e.g. ListItem or Button) as children.
 *
 * The closing scrim is a SIBLING behind the sheet, never its parent — an accessible Pressable
 * wrapping the sheet becomes a leaf a11y element on iOS and hides the actions from VoiceOver
 * (same structure as dialog.tsx / sheet.tsx).
 */
export type ActionSheetProps = {
  visible: boolean
  onClose: () => void
  title?: string
  /** Show the upper-right close (✕) button. Default true. */
  showClose?: boolean
  children?: React.ReactNode
  className?: string
}

const SPRING = { damping: 26, stiffness: 320, mass: 0.9 }

export function ActionSheet({ visible, onClose, title, showClose = true, children, className }: ActionSheetProps) {
  const colors = useColors()
  const translateY = useSharedValue(0)

  // Drag down to dismiss: the sheet tracks the finger (never upward), and on release a drag past
  // ~80px or a downward fling closes it; otherwise it springs back home. Modal's native slide plays
  // the entrance/exit, so we only own the in-flight drag.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY)
    })
    .onEnd((e) => {
      if (e.translationY > 80 || e.velocityY > 800) {
        translateY.value = 0
        runOnJS(onClose)()
      } else {
        translateY.value = withSpring(0, SPRING)
      }
    })

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }))

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        translateY.value = 0
      }}
      statusBarTranslucent
    >
      <Pressable
        onPress={onClose}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="bg-black/60"
      />
      {/* Gestures inside a Modal need their own root view on Android; box-none lets taps above the
          sheet fall through to the scrim behind it. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View pointerEvents="box-none" className="flex-1 justify-end">
          <GestureDetector gesture={pan}>
            <Animated.View
              style={sheetStyle}
              className={cn('gap-2 rounded-t-2xl border-t border-border bg-card p-4 pb-9', className)}
            >
              <View className="mb-1 h-1 w-10 self-center rounded-full bg-border" />
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
                <Text variant="muted" className="mb-1 text-center uppercase tracking-wider">
                  {title}
                </Text>
              ) : null}
              {children}
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}
