import { useId } from 'react'
import { View, StyleSheet } from 'react-native'
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg'
import { cn } from '@/lib/utils'

/**
 * Gradient — a linear-gradient surface drawn with react-native-svg (no extra native module).
 * Pass 2+ `colors`; children render on top. Diagonal top-left → bottom-right by default.
 */
export type GradientProps = {
  colors: string[]
  className?: string
  borderRadius?: number
  children?: React.ReactNode
  /** Direction as unit coords: [x1,y1,x2,y2], 0–1. Default diagonal. */
  direction?: [number, number, number, number]
}

export function Gradient({
  colors,
  className,
  borderRadius = 12,
  children,
  direction = [0, 0, 1, 1],
}: GradientProps) {
  const id = `grad-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [x1, y1, x2, y2] = direction
  return (
    <View className={cn('overflow-hidden', className)} style={{ borderRadius }}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgLinearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
            {colors.map((c, i) => (
              <Stop key={i} offset={colors.length > 1 ? i / (colors.length - 1) : 0} stopColor={c} />
            ))}
          </SvgLinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  )
}
