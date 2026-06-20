import { Pressable, View } from 'react-native'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import type { LucideIcon } from 'lucide-react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * SwipeableRow — a list row that reveals tappable actions on a horizontal swipe (delete, archive,
 * pin…). Built on gesture-handler's ReanimatedSwipeable so the drag runs on the UI thread; we own
 * only the themed action buttons. Tapping an action runs its handler and springs the row shut.
 * Wrap each row of a list: `<SwipeableRow rightActions={[{ icon, label, variant, onPress }]}>`.
 */
const actionVariants = cva('h-full w-20 items-center justify-center gap-1', {
  variants: {
    variant: {
      default: 'bg-accent',
      destructive: 'bg-destructive',
      success: 'bg-success',
    },
  },
  defaultVariants: { variant: 'default' },
})

export type SwipeAction = VariantProps<typeof actionVariants> & {
  icon?: LucideIcon
  label: string
  onPress: () => void
}

export type SwipeableRowProps = {
  children: React.ReactNode
  leftActions?: SwipeAction[]
  rightActions?: SwipeAction[]
  className?: string
}

function ActionButton({ action, methods }: { action: SwipeAction; methods: SwipeableMethods }) {
  const colors = useColors()
  const { icon: Icon, label, variant, onPress } = action
  const tint = variant === 'default' || !variant ? colors.foreground : colors.onPrimary
  return (
    <Pressable
      onPress={() => {
        methods.close()
        onPress()
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(actionVariants({ variant }), 'active:opacity-80')}
    >
      {Icon ? <Icon color={tint} size={20} /> : null}
      <Text variant="caption" style={{ color: tint }}>
        {label}
      </Text>
    </Pressable>
  )
}

export function SwipeableRow({ children, leftActions, rightActions, className }: SwipeableRowProps) {
  const renderActions = (actions: SwipeAction[]) => {
    // renderLeft/RightActions pass (progress, translation, methods) — we only need methods.
    const render = (_p: unknown, _t: unknown, methods: SwipeableMethods) => (
      <>
        {actions.map((a) => (
          <ActionButton key={a.label} action={a} methods={methods} />
        ))}
      </>
    )
    return render
  }

  return (
    <ReanimatedSwipeable
      friction={2}
      overshootFriction={8}
      leftThreshold={40}
      rightThreshold={40}
      renderLeftActions={leftActions?.length ? renderActions(leftActions) : undefined}
      renderRightActions={rightActions?.length ? renderActions(rightActions) : undefined}
    >
      {className ? <View className={className}>{children}</View> : children}
    </ReanimatedSwipeable>
  )
}
