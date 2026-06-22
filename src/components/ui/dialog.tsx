import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { X } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * Dialog — a centered modal for confirmations and short forms.
 *
 * TWO implementations behind one API (same split as SheetModal/ActionSheet): NATIVE is the
 * flick-to-dismiss Reanimated card; WEB is a plain centered card. On react-native-web a Reanimated
 * `Animated.View` doesn't apply its `bg-card` className — the card renders TRANSPARENT and the page
 * shows through it. The split is at the COMPONENT boundary so the native Reanimated/Gesture hooks
 * never mount on web.
 *
 * Closes three consistent ways (matching ActionSheet/SheetModal): tap the scrim, tap the upper-right
 * ✕, or (native) flick the card down. Provide `title`/`description` and compose actions as children.
 */
export type DialogProps = {
  visible: boolean
  onClose: () => void
  title?: string
  description?: string
  /** Show the upper-right close (✕) button. Default true. */
  showClose?: boolean
  children?: React.ReactNode
  className?: string
}

const SPRING = { damping: 26, stiffness: 320, mass: 0.9 }

export function Dialog(props: DialogProps) {
  return Platform.OS === 'web' ? <WebDialog {...props} /> : <NativeDialog {...props} />
}

/** Web fallback: a dimmed backdrop + a plain OPAQUE centered card (no Animated.View, so bg-card sticks). */
function WebDialog({ visible, onClose, title, description, showClose = true, children, className }: DialogProps) {
  const colors = useColors()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        onPress={onClose}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="bg-black/60"
      />
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill} className="flex-1 items-center justify-center p-6">
        <View className={cn('w-full max-w-sm gap-3 rounded-xl border border-border bg-card p-5', className)}>
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
          {title ? <Text variant="h3" className={showClose ? 'pr-8' : undefined}>{title}</Text> : null}
          {description ? <Text variant="muted">{description}</Text> : null}
          {children}
        </View>
      </View>
    </Modal>
  )
}

function NativeDialog({ visible, onClose, title, description, showClose = true, children, className }: DialogProps) {
  const colors = useColors()
  const translateY = useSharedValue(0)

  // Flick the card down to dismiss (same gesture as the bottom sheets, for consistency): tracks the
  // finger downward only, and a release past ~90px or a downward fling closes; otherwise springs back.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY)
    })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 800) {
        translateY.value = 0
        runOnJS(onClose)()
      } else {
        translateY.value = withSpring(0, SPRING)
      }
    })

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }))

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
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
      {/* Gestures inside a Modal need their own root view on Android; box-none lets taps outside the
          card fall through to the scrim behind it. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View pointerEvents="box-none" className="flex-1 items-center justify-center p-6">
          <GestureDetector gesture={pan}>
            <Animated.View
              style={cardStyle}
              className={cn('w-full max-w-sm gap-3 rounded-xl border border-border bg-card p-5', className)}
            >
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
              {title ? <Text variant="h3" className={showClose ? 'pr-8' : undefined}>{title}</Text> : null}
              {description ? <Text variant="muted">{description}</Text> : null}
              {children}
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}
