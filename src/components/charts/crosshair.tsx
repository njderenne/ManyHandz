import type { SkFont } from '@shopify/react-native-skia'
import { Circle, Line as SkiaLine, Text as SkiaText, vec } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

/**
 * Drag-to-read crosshair — the headline interactive overlay. Bound to victory's `useChartPressState`
 * SharedValues so the vertical guide, the dot, and the value readout all track the finger on the UI
 * thread (no React re-renders → 60/120fps). Shared by LineChart + AreaChart.
 *
 * The value label is formatted inside a worklet, so it takes `decimals`/`prefix`/`suffix` (plain,
 * worklet-safe values) rather than a JS formatter function (which can't be called on the UI thread).
 */
// Minimal structural shape of the slice of victory's press-state we read (it has more fields).
export type CrosshairState = {
  x: { position: SharedValue<number> }
  y: { y: { position: SharedValue<number>; value: SharedValue<number> } }
}

export function Crosshair({
  state,
  top,
  bottom,
  lineColor,
  dotColor,
  textColor,
  font,
  decimals = 0,
  prefix = '',
  suffix = '',
}: {
  state: CrosshairState
  top: number
  bottom: number
  lineColor: string
  dotColor: string
  textColor: string
  font: SkFont | null
  decimals?: number
  prefix?: string
  suffix?: string
}) {
  const lineP1 = useDerivedValue(() => vec(state.x.position.value, top))
  const lineP2 = useDerivedValue(() => vec(state.x.position.value, bottom))
  const label = useDerivedValue(() => `${prefix}${state.y.y.value.value.toFixed(decimals)}${suffix}`)
  const textX = useDerivedValue(() => state.x.position.value + 6)

  return (
    <>
      <SkiaLine p1={lineP1} p2={lineP2} color={lineColor} strokeWidth={1} />
      <Circle cx={state.x.position} cy={state.y.y.position} r={10} color={dotColor} opacity={0.16} />
      <Circle cx={state.x.position} cy={state.y.y.position} r={5} color={dotColor} />
      {font ? <SkiaText x={textX} y={top + 12} text={label} font={font} color={textColor} /> : null}
    </>
  )
}
