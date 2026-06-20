import { forwardRef, useEffect, useState } from 'react'
import { View, TextInput, type TextInputProps } from 'react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { usePrefs } from '@/lib/prefs'
import {
  formatMeasurement,
  fromDisplayValue,
  toDisplayValue,
  unitSymbol,
  type MeasurementKind,
  type UnitSystem,
} from '@/lib/config/units'
import { Text } from './text'

/**
 * MeasurementInput — enter a height / weight / distance in the user's active unit system while
 * storing a single canonical SI value (cm / kg / m). The field DISPLAYS in the active system and
 * shows its unit label (e.g. "lbs"); `value`/`onValueChange` always speak canonical, so swapping
 * the unit preference re-renders the same data with no migration and no caller changes.
 *
 * Controlled around the canonical number. Internally it keeps the raw text the user is typing
 * (so a half-typed "5." doesn't get reformatted out from under them) and only re-derives that
 * text from `value` when the canonical value or the unit system changes externally.
 */
export type MeasurementInputProps = Omit<
  TextInputProps,
  'value' | 'onChangeText' | 'keyboardType'
> & {
  /** Which measurement this is — picks the canonical unit + display symbol. */
  kind: MeasurementKind
  /** Canonical SI value (cm / kg / m), or undefined when empty. */
  value: number | undefined
  /** Fires with the new canonical SI value (or undefined when the field is cleared). */
  onValueChange: (canonical: number | undefined) => void
  label?: string
  helper?: string
  error?: string
  /** Override the active preference (rarely needed — the gallery uses it to show both systems). */
  system?: UnitSystem
  containerClassName?: string
}

/** Round a display value for the field text so we don't show "72.00000001 in". */
function displayText(canonical: number | undefined, kind: MeasurementKind, system: UnitSystem): string {
  if (canonical === undefined || Number.isNaN(canonical)) return ''
  const display = toDisplayValue(canonical, kind, system)
  return String(Math.round(display * 100) / 100)
}

export const MeasurementInput = forwardRef<TextInput, MeasurementInputProps>(function MeasurementInput(
  { kind, value, onValueChange, label, helper, error, system, containerClassName, className, onFocus, onBlur, ...props },
  ref,
) {
  const colors = useColors()
  const prefSystem = usePrefs((s) => s.unitSystem)
  const activeSystem = system ?? prefSystem
  const symbol = unitSymbol(kind, activeSystem)

  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(() => displayText(value, kind, activeSystem))

  // Re-sync the field text from the canonical value when it (or the unit system) changes from the
  // outside — but never while focused, which would fight the user's in-progress typing.
  useEffect(() => {
    if (!focused) setText(displayText(value, kind, activeSystem))
  }, [value, kind, activeSystem, focused])

  const hasError = !!error

  const handleChange = (next: string) => {
    setText(next)
    const trimmed = next.trim()
    if (trimmed === '') {
      onValueChange(undefined)
      return
    }
    const parsed = Number(trimmed)
    if (Number.isNaN(parsed)) return // ignore junk keystrokes; keep showing what they typed
    onValueChange(fromDisplayValue(parsed, kind, activeSystem))
  }

  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Text variant="label">{label}</Text> : null}
      <View
        className={cn(
          'h-11 flex-row items-center rounded-md border bg-card pl-3 pr-2',
          hasError ? 'border-destructive' : focused ? 'border-primary web:ring-2 web:ring-primary/20' : 'border-border',
        )}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          value={text}
          onChangeText={handleChange}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholderTextColor={colors.placeholder}
          onFocus={(e) => {
            setFocused(true)
            onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            // Normalize the text on blur so a trailing "5." tidies to "5".
            setText(displayText(value, kind, activeSystem))
            onBlur?.(e)
          }}
          className={cn('flex-1 text-base text-foreground web:outline-none', className)}
          {...props}
        />
        {/* The live unit label — updates the instant the user flips Imperial ↔ Metric. */}
        <Text variant="muted" className="pl-2">
          {symbol}
        </Text>
      </View>
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

/**
 * MeasurementValue — render a stored canonical measurement as text in the active unit system.
 * The read-only counterpart to MeasurementInput: store canonical, display anywhere with this.
 *
 * @example <MeasurementValue value={182.88} kind="length" feetInches />  // "6 ft 0 in"
 */
export function MeasurementValue({
  value,
  kind,
  system,
  digits,
  feetInches,
  className,
}: {
  value: number | undefined
  kind: MeasurementKind
  system?: UnitSystem
  digits?: number
  /** Length + imperial: render as `6 ft 0 in` instead of `72 in`. */
  feetInches?: boolean
  className?: string
}) {
  const prefSystem = usePrefs((s) => s.unitSystem)
  const activeSystem = system ?? prefSystem
  if (value === undefined || Number.isNaN(value)) {
    return <Text className={className}>—</Text>
  }
  return <Text className={className}>{formatMeasurement(value, kind, activeSystem, { digits, feetInches })}</Text>
}
