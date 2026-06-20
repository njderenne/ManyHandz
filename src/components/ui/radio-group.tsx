import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { cn } from '@/lib/utils'
import { Text } from './text'

/**
 * RadioGroup — single-select list of options. Controlled via `value` + `onValueChange`. The
 * focused row gets the shared focus treatment (accent wash; ring on web).
 */
export type RadioOption = { label: string; value: string }

export type RadioGroupProps = {
  value?: string
  onValueChange?: (value: string) => void
  options: RadioOption[]
  className?: string
}

export function RadioGroup({ value, onValueChange, options, className }: RadioGroupProps) {
  const [focusedValue, setFocusedValue] = useState<string | null>(null)
  return (
    <View className={cn('gap-1', className)} accessibilityRole="radiogroup">
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <Pressable
            key={opt.value}
            onPress={() => onValueChange?.(opt.value)}
            onFocus={() => setFocusedValue(opt.value)}
            onBlur={() => setFocusedValue((v) => (v === opt.value ? null : v))}
            accessibilityRole="radio"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected, checked: selected }}
            className={cn(
              'flex-row items-center gap-3 rounded-md py-2 active:opacity-80',
              focusedValue === opt.value && 'bg-accent web:ring-2 web:ring-primary/20',
            )}
          >
            <View
              className={cn(
                'size-5 items-center justify-center rounded-full border-2',
                selected ? 'border-primary' : 'border-border',
              )}
            >
              {selected ? <View className="size-2.5 rounded-full bg-primary" /> : null}
            </View>
            <Text>{opt.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
