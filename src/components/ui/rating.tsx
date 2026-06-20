import { View, Pressable } from 'react-native'
import { Star } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { haptics } from '@/lib/native/haptics'

/**
 * Rating — star rating, interactive or read-only. Controlled via `value` (0–max) + `onValueChange`.
 * Selects on touch-down (with a selection haptic) so it feels instant; onPress remains for
 * assistive tech.
 */
export function Rating({
  value,
  onValueChange,
  max = 5,
  size = 24,
  readOnly = false,
  className,
}: {
  value: number
  onValueChange?: (value: number) => void
  max?: number
  size?: number
  readOnly?: boolean
  className?: string
}) {
  const colors = useColors()
  return (
    <View className={cn('flex-row gap-1', className)}>
      {Array.from({ length: max }).map((_, i) => (
        <Pressable
          key={i}
          disabled={readOnly}
          onPressIn={() => {
            haptics.selection()
            onValueChange?.(i + 1)
          }}
          onPress={() => onValueChange?.(i + 1)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Rate ${i + 1} of ${max}`}
          accessibilityState={{ selected: i < value }}
          className="active:scale-105 active:opacity-80"
        >
          <Star color={colors.warning} fill={i < value ? colors.warning : 'transparent'} size={size} />
        </Pressable>
      ))}
    </View>
  )
}
