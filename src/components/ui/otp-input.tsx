import { useRef, useState } from 'react'
import { View, TextInput, Pressable } from 'react-native'
import { cn } from '@/lib/utils'
import { Text } from './text'

/**
 * OTPInput — segmented one-time-code entry (email/SMS verification, PIN). A hidden field captures
 * digits; the boxes display them. Controlled via `value` + `onChangeText`. Numeric-only. While the
 * hidden field is focused, the next-digit box gets the shared focus treatment (primary border;
 * ring on web).
 */
export function OTPInput({
  value,
  onChangeText,
  length = 6,
  className,
}: {
  value: string
  onChangeText: (value: string) => void
  length?: number
  className?: string
}) {
  const inputRef = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)
  const digits = value.slice(0, length).split('')

  return (
    <Pressable onPress={() => inputRef.current?.focus()} className={cn('flex-row gap-2', className)}>
      {Array.from({ length }).map((_, i) => {
        const active = focused && i === digits.length
        return (
          <View
            key={i}
            className={cn(
              'h-12 w-11 items-center justify-center rounded-lg border bg-card',
              active ? 'border-primary web:ring-2 web:ring-primary/20' : 'border-border',
            )}
          >
            <Text variant="h3">{digits[i] ?? ''}</Text>
          </View>
        )
      })}
      <TextInput
        ref={inputRef}
        value={value}
        accessibilityLabel="Verification code"
        onChangeText={(t) => onChangeText(t.replace(/[^0-9]/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        maxLength={length}
        caretHidden
        className="absolute size-0 opacity-0"
      />
    </Pressable>
  )
}
