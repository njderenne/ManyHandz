import { forwardRef, useState } from 'react'
import { TextInput, View, type TextInputProps } from 'react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * Textarea — multi-line text field. Same label/error/helper affordances as Input, plus the same
 * focus treatment (primary border; ring on web). Pass `disabled` to gray it out and block editing.
 */
export type TextareaProps = TextInputProps & {
  label?: string
  error?: string
  helper?: string
  containerClassName?: string
  rows?: number
  /** Grays the field out and blocks editing. */
  disabled?: boolean
}

export const Textarea = forwardRef<TextInput, TextareaProps>(function Textarea(
  { className, containerClassName, label, error, helper, rows = 4, disabled, onFocus, onBlur, ...props },
  ref,
) {
  const colors = useColors()
  const [focused, setFocused] = useState(false)
  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        multiline
        textAlignVertical="top"
        spellCheck
        autoCorrect
        editable={!disabled}
        placeholderTextColor={colors.placeholder}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        style={{ minHeight: rows * 22 }}
        className={cn(
          'rounded-md border bg-card px-3 py-2.5 text-base text-foreground',
          error
            ? 'border-destructive'
            : focused
              ? 'border-primary web:ring-2 web:ring-primary/20'
              : 'border-border',
          disabled && 'opacity-50',
          className,
        )}
        {...props}
      />
      {error ? (
        <Text variant="caption" className="text-destructive">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption">{helper}</Text>
      ) : null}
    </View>
  )
})
