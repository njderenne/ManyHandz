import { useRef, useState } from 'react'
import { View, Pressable, Modal, ScrollView, StyleSheet, Platform, useWindowDimensions } from 'react-native'
import { ChevronDown, Check } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'
import { ListItem } from './list'
import { SearchBar } from './search-bar'

/**
 * Select — single-choice dropdown for longer option lists (where RadioGroup/SegmentedControl don't
 * fit). Controlled via `value` + `onValueChange`.
 *
 * Presentation differs by platform so it feels native to each:
 * - WEB: the option list ANCHORS to the trigger like a real dropdown — measured with
 *   measureInWindow, opening downward and flipping above when there's no room. It floats with a
 *   shadow so it never blends into a card/dialog behind it.
 * - NATIVE: a centered modal sheet of options (the standard mobile picker).
 *
 * Two opt-in upgrades, both backward-compatible:
 * - `searchable` puts a filter input at the top of the option list (use for 10+ options).
 * - `multiple` switches to multi-select: drive it with `values` + `onValuesChange` instead, rows
 *   toggle checkmarks without closing, the trigger shows "{n} selected", and the scrim/Done dismisses.
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

type Anchor = { x: number; y: number; width: number; height: number }

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
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const triggerRef = useRef<View>(null)
  const colors = useColors()
  const { height: winH } = useWindowDimensions()

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
    setAnchor(null)
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

  // Web measures the trigger so the menu anchors to it; native just opens the centered sheet.
  const openMenu = () => {
    if (disabled) return
    if (Platform.OS === 'web' && triggerRef.current?.measureInWindow) {
      triggerRef.current.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height })
        setOpen(true)
      })
    } else {
      setOpen(true)
    }
  }

  // Anchored-dropdown geometry (web): below the trigger, flipped above when the room below is tight.
  const gap = 4
  const spaceBelow = anchor ? winH - (anchor.y + anchor.height) : 0
  const openUp = !!anchor && spaceBelow < 280 && anchor.y > spaceBelow
  const menuMaxH = anchor ? Math.max(140, (openUp ? anchor.y : spaceBelow) - gap - 12) : 384
  const anchoredStyle: object | undefined = anchor
    ? {
        position: 'absolute',
        left: anchor.x,
        width: anchor.width,
        ...(openUp ? { bottom: winH - anchor.y + gap } : { top: anchor.y + anchor.height + gap }),
      }
    : undefined

  const optionsBody = (
    <>
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
      <ScrollView style={{ maxHeight: Platform.OS === 'web' ? menuMaxH : 384 }} keyboardShouldPersistTaps="handled">
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
    </>
  )

  return (
    <View className={cn('gap-1.5', className)}>
      {label ? <Text variant="label">{label}</Text> : null}
      <Pressable
        ref={triggerRef}
        onPress={openMenu}
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

      <Modal
        visible={open}
        transparent
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        onRequestClose={close}
        statusBarTranslucent
      >
        {/* Click-catcher to dismiss. Web stays transparent (a dropdown shouldn't dim the page); native
            dims like the other sheets. The scrim is a SIBLING behind the menu (a11y — see dialog.tsx). */}
        <Pressable
          onPress={close}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close"
          className={Platform.OS === 'web' ? undefined : 'bg-black/60'}
        />
        {Platform.OS === 'web' && anchor ? (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View style={anchoredStyle} className="overflow-hidden rounded-md border border-border bg-card shadow-lg">
              {optionsBody}
            </View>
          </View>
        ) : (
          <View pointerEvents="box-none" className="flex-1 justify-center p-6">
            <View className="overflow-hidden rounded-xl border border-border bg-card">{optionsBody}</View>
          </View>
        )}
      </Modal>
    </View>
  )
}
