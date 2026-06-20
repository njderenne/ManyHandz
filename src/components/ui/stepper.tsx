import { useState } from 'react'
import { View, Pressable } from 'react-native'
import { Minus, Plus } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * Stepper — a compact +/- quantity control. Controlled via `value` + `onValueChange`, clamped to
 * [min, max]. The focused button gets the shared focus treatment (ring on web).
 */
export function Stepper({
  value,
  onValueChange,
  min = 0,
  max = 99,
  step = 1,
  className,
}: {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
}) {
  const colors = useColors()
  const [focusedButton, setFocusedButton] = useState<'dec' | 'inc' | null>(null)
  // Defensive: a NaN `value` would render "NaN" and disable neither button (NaN comparisons
  // are all false), wedging the control — same guard as Slider's safeValue.
  const safeValue = Number.isNaN(value) ? min : Math.max(min, Math.min(max, value))
  const atMin = safeValue <= min
  const atMax = safeValue >= max
  return (
    <View className={cn('flex-row items-center self-start rounded-md border border-border', className)}>
      <Pressable
        onPress={() => onValueChange(Math.max(min, safeValue - step))}
        disabled={atMin}
        onFocus={() => setFocusedButton('dec')}
        onBlur={() => setFocusedButton((b) => (b === 'dec' ? null : b))}
        className={cn(
          'size-10 items-center justify-center active:bg-accent active:opacity-80',
          focusedButton === 'dec' && 'rounded-md web:ring-2 web:ring-primary/20',
          atMin && 'opacity-50',
        )}
        accessibilityRole="button"
        accessibilityLabel="Decrement"
      >
        <Minus color={atMin ? colors.border : colors.foreground} size={18} />
      </Pressable>
      <View className="min-w-12 items-center border-x border-border py-2.5">
        <Text variant="label">{safeValue}</Text>
      </View>
      <Pressable
        onPress={() => onValueChange(Math.min(max, safeValue + step))}
        disabled={atMax}
        onFocus={() => setFocusedButton('inc')}
        onBlur={() => setFocusedButton((b) => (b === 'inc' ? null : b))}
        className={cn(
          'size-10 items-center justify-center active:bg-accent active:opacity-80',
          focusedButton === 'inc' && 'rounded-md web:ring-2 web:ring-primary/20',
          atMax && 'opacity-50',
        )}
        accessibilityRole="button"
        accessibilityLabel="Increment"
      >
        <Plus color={atMax ? colors.border : colors.foreground} size={18} />
      </Pressable>
    </View>
  )
}
