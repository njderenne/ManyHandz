import { useState } from 'react'
import { View, Pressable, Modal, ScrollView, StyleSheet } from 'react-native'
import { ChevronDown, Check } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'
import { ListItem } from './list'
import { SearchBar } from './search-bar'

/**
 * Select — single-choice dropdown for longer option lists (where RadioGroup/SegmentedControl don't
 * fit). Opens a modal sheet of options. Controlled via `value` + `onValueChange`.
 *
 * Two opt-in upgrades, both backward-compatible:
 * - `searchable` puts a filter input at the top of the option sheet (use for 10+ options).
 * - `multiple` switches to multi-select: drive it with `values` + `onValuesChange` instead, rows
 *   toggle checkmarks without closing, the trigger shows "{n} selected", and the scrim/Done
 *   dismisses.
 */
export type SelectOption = { label: string; value: string }

export type SelectProps = {
  options: SelectOption[]
  /** Single-select (default mode) controlled value. */
  value?: string
  onValueChange?: (value: string) => void
  /** Multi-select mode: pass `multiple` and control with `values` + `onValuesChange`. */
  multiple?: boolean
  values?: string[]
  onValuesChange?: (values: string[]) => void
  /** Show a filter input above the options. */
  searchable?: boolean
  placeholder?: string
  label?: string
  /** Grays the trigger out and blocks opening (loading, conditional logic). */
  disabled?: boolean
  className?: string
}

export function Select({
  options,
  value,
  onValueChange,
  multiple = false,
  values = [],
  onValuesChange,
  searchable = false,
  placeholder = 'Select…',
  label,
  disabled = false,
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const colors = useColors()

  const selected = options.find((o) => o.value === value)
  const selectedMany = options.filter((o) => values.includes(o.value))
  const triggerLabel = multiple
    ? selectedMany.length === 0
      ? placeholder
      : selectedMany.length === 1
        ? selectedMany[0]!.label
        : `${selectedMany.length} selected`
    : (selected?.label ?? placeholder)
  const hasValue = multiple ? selectedMany.length > 0 : !!selected

  const filtered = searchable
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const pick = (option: SelectOption) => {
    if (multiple) {
      const next = values.includes(option.value)
        ? values.filter((v) => v !== option.value)
        : [...values, option.value]
      onValuesChange?.(next)
      return // stay open — multi-select is a toggling session
    }
    onValueChange?.(option.value)
    close()
  }

  const isPicked = (option: SelectOption) =>
    multiple ? values.includes(option.value) : option.value === value

  return (
    <View className={cn('gap-1.5', className)}>
      {label ? <Text variant="label">{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityState={{ disabled }}
        accessibilityValue={hasValue ? { text: triggerLabel } : undefined}
        className={cn(
          'h-11 flex-row items-center justify-between rounded-md border bg-card px-3 active:bg-accent',
          focused ? 'border-primary web:ring-2 web:ring-primary/20' : 'border-border',
          disabled && 'opacity-50',
        )}
      >
        <Text className={hasValue ? 'text-foreground' : 'text-muted-foreground'}>{triggerLabel}</Text>
        <ChevronDown color={colors.mutedForeground} size={18} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        {/* Scrim is a SIBLING behind the card, not its parent — an accessible Pressable wrapping
            the card becomes a leaf a11y element on iOS and hides the options from VoiceOver. */}
        <Pressable
          onPress={close}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close"
          className="bg-black/60"
        />
        <View pointerEvents="box-none" className="flex-1 justify-center p-6">
          <View className="overflow-hidden rounded-xl border border-border bg-card">
            {searchable ? (
              <View className="border-b border-border p-2">
                <SearchBar
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Filter…"
                  accessibilityLabel="Filter options"
                  accessibilityHint="Type to narrow the list"
                />
              </View>
            ) : null}
            <ScrollView className="max-h-96" keyboardShouldPersistTaps="handled">
              {filtered.length === 0 ? (
                <Text variant="muted" className="p-6 text-center">
                  No matches
                </Text>
              ) : (
                filtered.map((o) => (
                  <ListItem
                    key={o.value}
                    title={o.label}
                    right={isPicked(o) ? <Check color={colors.success} size={18} /> : undefined}
                    onPress={() => pick(o)}
                    // Web enhancement: CSS :focus highlight for keyboard navigation (no-op on native).
                    className="web:focus:bg-accent"
                  />
                ))
              )}
            </ScrollView>
            {multiple ? (
              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Done"
                className="items-center border-t border-border py-3 active:bg-accent"
              >
                <Text variant="label" className="text-primary">
                  Done
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  )
}
