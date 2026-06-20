import { forwardRef, useState } from 'react'
import { TextInput, View, type TextInputProps } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * Input — the canonical single-line text field.
 *
 * Wraps RN's TextInput with an optional label, helper, and error message. Pass `error` to flip
 * it into the error state (red border + the message rendered below). Forwards a ref so forms
 * (react-hook-form) can focus/scroll to it. The `state` variant is an explicit visual override
 * (rarely needed) — passing `error` text always wins. While focused it shows the shared focus
 * treatment (primary border; ring on web).
 */
// web:outline-none suppresses the browser's default focus outline, which would double up with
// our own focus ring (border-primary + web:ring) on keyboard focus.
const inputVariants = cva('rounded-md border bg-card px-3 text-base text-foreground web:outline-none', {
  variants: {
    state: {
      default: 'border-border',
      error: 'border-destructive',
    },
    size: {
      default: 'h-11',
      lg: 'h-12',
    },
  },
  defaultVariants: { state: 'default', size: 'default' },
})

export type InputProps = TextInputProps &
  VariantProps<typeof inputVariants> & {
    label?: string
    error?: string
    helper?: string
    containerClassName?: string
  }

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { className, containerClassName, label, error, helper, state, size, onFocus, onBlur, ...props },
  ref,
) {
  const colors = useColors()
  const [focused, setFocused] = useState(false)
  const hasError = !!error || state === 'error'
  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.placeholder}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        className={cn(
          inputVariants({ state: hasError ? 'error' : state, size }),
          focused && !hasError && 'border-primary web:ring-2 web:ring-primary/20',
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
