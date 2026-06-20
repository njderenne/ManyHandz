import { MotiView } from 'moti'

/**
 * FadeIn — entrance animation wrapper (fade + slide). Wrap screen content or list rows; pass
 * staggered `delay`s for a cascade. Runs on the native UI thread via Reanimated/Moti.
 */
export type FadeInProps = {
  children: React.ReactNode
  delay?: number
  from?: 'bottom' | 'top' | 'left' | 'right'
  distance?: number
}

export function FadeIn({ children, delay = 0, from = 'bottom', distance = 16 }: FadeInProps) {
  const offset =
    from === 'bottom'
      ? { translateY: distance }
      : from === 'top'
        ? { translateY: -distance }
        : from === 'left'
          ? { translateX: -distance }
          : { translateX: distance }

  return (
    <MotiView
      from={{ opacity: 0, ...offset }}
      animate={{ opacity: 1, translateX: 0, translateY: 0 }}
      transition={{ type: 'timing', duration: 350, delay }}
    >
      {children}
    </MotiView>
  )
}
