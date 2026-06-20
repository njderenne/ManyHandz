import { createElement, useState } from 'react'
import { Platform, Pressable, View } from 'react-native'
import RNDateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker'
import { format } from 'date-fns'
import { Calendar, Clock } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useActiveScheme, useColors } from '@/lib/config/theme'
import { Text } from './text'
import { Button } from './button'
import { ActionSheet } from './action-sheet'

/**
 * DateTimePicker — one themed trigger, three platform-correct pickers.
 *
 * The trigger is a Select-style field showing the formatted value. Tapping it opens whatever the
 * platform expects: iOS gets the spinner inside an ActionSheet with a Done button (the native
 * inline picker can't float over content), Android gets the system dialog via the imperative
 * `DateTimePickerAndroid` API (mode `datetime` chains date → time, which Android has no single
 * dialog for), and web falls back to a native `<input type=…>` so the browser supplies the
 * calendar UI. Controlled via `value` + `onValueChange`.
 */
export type DateTimePickerMode = 'date' | 'time' | 'datetime'

export type DateTimePickerProps = {
  value?: Date
  onValueChange: (date: Date) => void
  mode?: DateTimePickerMode
  label?: string
  placeholder?: string
  minimumDate?: Date
  maximumDate?: Date
  /**
   * iOS picker style. `inline` is the graphical calendar — tap the month/year header to jump straight
   * to any year (the right default for backdating). `spinner` is the date wheels, which in `datetime`
   * mode have no year column, so reaching an old date means scrolling day-by-day forever. Defaults to
   * `inline` for date/datetime, `spinner` for time-only (no calendar applies). Android always uses its
   * native calendar (which has a tappable year), web uses the browser's date control.
   */
  display?: 'inline' | 'spinner'
  /** Grays the trigger out and blocks opening the picker. */
  disabled?: boolean
  className?: string
}

const DISPLAY_FORMAT: Record<DateTimePickerMode, string> = {
  date: 'MMM d, yyyy',
  time: 'h:mm a',
  datetime: 'MMM d, yyyy · h:mm a',
}

const INPUT_TYPE: Record<DateTimePickerMode, string> = {
  date: 'date',
  time: 'time',
  datetime: 'datetime-local',
}

const INPUT_FORMAT: Record<DateTimePickerMode, string> = {
  date: 'yyyy-MM-dd',
  time: 'HH:mm',
  datetime: "yyyy-MM-dd'T'HH:mm",
}

/** Parse the web input's string into a local-time Date (bare `yyyy-MM-dd` would parse as UTC). */
function parseInputValue(raw: string, mode: DateTimePickerMode, prev: Date): Date | null {
  if (!raw) return null
  if (mode === 'date') return new Date(`${raw}T00:00`)
  if (mode === 'datetime') return new Date(raw)
  const [h, m] = raw.split(':').map(Number)
  const next = new Date(prev)
  next.setHours(h ?? 0, m ?? 0, 0, 0)
  return next
}

export function DateTimePicker({
  value,
  onValueChange,
  mode = 'date',
  label,
  placeholder = 'Pick…',
  minimumDate,
  maximumDate,
  display,
  disabled = false,
  className,
}: DateTimePickerProps) {
  const colors = useColors()
  const scheme = useActiveScheme()
  // Calendar for date/datetime (year is one tap away), wheels only for time-of-day.
  const iosDisplay = display ?? (mode === 'time' ? 'spinner' : 'inline')
  const [iosOpen, setIosOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  // iOS spins a draft value; Done commits it (so cancelling by scrim-tap discards the spin).
  const [draft, setDraft] = useState<Date>(value ?? new Date())

  const TriggerIcon = mode === 'time' ? Clock : Calendar

  const openAndroid = () => {
    const base = value ?? new Date()
    if (mode === 'time') {
      DateTimePickerAndroid.open({
        value: base,
        mode: 'time',
        onValueChange: (_e, date) => onValueChange(date),
      })
      return
    }
    DateTimePickerAndroid.open({
      value: base,
      mode: 'date',
      // Material calendar (not the spinner) — its header year is tappable for fast backdating.
      display: 'calendar',
      minimumDate,
      maximumDate,
      onValueChange: (_e, date) => {
        if (mode === 'date') {
          onValueChange(date)
          return
        }
        // datetime: chain the time dialog onto the picked date.
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          onValueChange: (_e2, withTime) => onValueChange(withTime),
        })
      },
    })
  }

  if (Platform.OS === 'web') {
    return (
      <View className={cn('gap-1.5', className)}>
        {label ? <Text variant="label">{label}</Text> : null}
        {createElement('input', {
          type: INPUT_TYPE[mode],
          value: value ? format(value, INPUT_FORMAT[mode]) : '',
          min: minimumDate && mode !== 'time' ? format(minimumDate, INPUT_FORMAT[mode]) : undefined,
          max: maximumDate && mode !== 'time' ? format(maximumDate, INPUT_FORMAT[mode]) : undefined,
          disabled,
          'aria-label': label ?? placeholder,
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
          onChange: (e: { target: { value: string } }) => {
            const next = parseInputValue(e.target.value, mode, value ?? new Date())
            if (next && !Number.isNaN(next.getTime())) onValueChange(next)
          },
          // Inline styles are required here: this is a raw DOM <input> (not an RN component), so
          // NativeWind className tokens don't apply — the values mirror border/card/foreground.
          style: {
            height: 44,
            padding: '0 12px',
            borderRadius: 6,
            border: `1px solid ${focused ? colors.primary : colors.border}`,
            backgroundColor: colors.card,
            color: value ? colors.foreground : colors.placeholder,
            fontSize: 16,
            colorScheme: scheme,
            opacity: disabled ? 0.5 : 1,
          },
        })}
      </View>
    )
  }

  return (
    <View className={cn('gap-1.5', className)}>
      {label ? <Text variant="label">{label}</Text> : null}
      <Pressable
        onPress={() => {
          if (Platform.OS === 'android') {
            openAndroid()
          } else {
            setDraft(value ?? new Date())
            setIosOpen(true)
          }
        }}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityState={{ disabled }}
        accessibilityValue={value ? { text: format(value, DISPLAY_FORMAT[mode]) } : undefined}
        className={cn(
          'h-11 flex-row items-center justify-between rounded-md border bg-card px-3 active:bg-accent',
          focused ? 'border-primary web:ring-2 web:ring-primary/20' : 'border-border',
          disabled && 'opacity-50',
        )}
      >
        <Text className={value ? 'text-foreground' : 'text-muted-foreground'}>
          {value ? format(value, DISPLAY_FORMAT[mode]) : placeholder}
        </Text>
        <TriggerIcon color={colors.mutedForeground} size={18} />
      </Pressable>

      {Platform.OS === 'ios' ? (
        <ActionSheet visible={iosOpen} onClose={() => setIosOpen(false)} title={label}>
          <RNDateTimePicker
            value={draft}
            mode={mode}
            display={iosDisplay}
            themeVariant={scheme}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onValueChange={(_e: DateTimePickerChangeEvent, date: Date) => setDraft(date)}
          />
          <Button
            label="Done"
            onPress={() => {
              onValueChange(draft)
              setIosOpen(false)
            }}
          />
        </ActionSheet>
      ) : null}
    </View>
  )
}
