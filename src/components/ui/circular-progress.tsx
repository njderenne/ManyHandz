import { useEffect } from 'react'
import { View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import Animated, { useSharedValue, useAnimatedProps, withTiming, Easing } from 'react-native-reanimated'
import { useColors } from '@/lib/config/theme'
import { AnimatedNumber } from './animated-number'

/**
 * CircularProgress — a determinate ring (0–100) that sweeps to its value with an easing animation
 * and a count-up label. Built on react-native-svg + Reanimated (web-safe).
 */
const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export function CircularProgress({
  value,
  size = 88,
  strokeWidth = 8,
  showLabel = true,
}: {
  value: number
  size?: number
  strokeWidth?: number
  showLabel?: boolean
}) {
  const colors = useColors()
  const pct = Math.max(0, Math.min(100, value))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const prog = useSharedValue(0)

  useEffect(() => {
    prog.value = withTiming(pct / 100, { duration: 800, easing: Easing.out(Easing.cubic) })
  }, [pct, prog])

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - prog.value),
  }))

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.primary}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
        />
      </Svg>
      {showLabel ? <AnimatedNumber value={pct} variant="label" format={(n) => `${Math.round(n)}%`} /> : null}
    </View>
  )
}
