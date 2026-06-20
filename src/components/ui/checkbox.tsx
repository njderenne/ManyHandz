import { useState } from 'react'
import { Pressable, type PressableProps } from 'react-native'
import { Check } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'

/**
 * Checkbox — a controlled, square toggle. Pass `checked` + `onCheckedChange`. Shows the shared
 * focus treatment (primary border; ring on web) while focused.
 */
export type CheckboxProps = Omit<PressableProps, 'children'> & {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function Checkbox({
  checked = false,
  onCheckedChange,
  disabled,
  className,
  onFocus,
  onBlur,
  ...props
}: CheckboxProps) {
  const colors = useColors()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      onPress={() => onCheckedChange?.(!checked)}
      disabled={disabled}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      className={cn(
        'size-6 items-center justify-center rounded-md border active:opacity-80',
        checked ? 'border-primary bg-primary' : 'border-border bg-card',
        focused && 'border-primary web:ring-2 web:ring-primary/20',
        disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      {checked ? <Check color={colors.onPrimary} size={16} strokeWidth={3} /> : null}
    </Pressable>
  )
}
