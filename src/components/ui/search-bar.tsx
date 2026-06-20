import { useState } from 'react'
import { View, TextInput, Pressable } from 'react-native'
import { Search, X } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'

/**
 * SearchBar — a search input with a leading magnifier and a clear button. Shows the shared focus
 * treatment (primary border; ring on web) while the field is focused.
 */
export type SearchBarProps = {
  value?: string
  onChangeText?: (text: string) => void
  placeholder?: string
  onClear?: () => void
  className?: string
  /** Screen-reader label override (defaults to the placeholder). */
  accessibilityLabel?: string
  accessibilityHint?: string
}

export function SearchBar({
  value = '',
  onChangeText,
  placeholder = 'Search',
  onClear,
  className,
  accessibilityLabel,
  accessibilityHint,
}: SearchBarProps) {
  const colors = useColors()
  const [focused, setFocused] = useState(false)
  return (
    <View
      className={cn(
        'h-11 flex-row items-center gap-2 rounded-md border bg-card px-3',
        focused ? 'border-primary web:ring-2 web:ring-primary/20' : 'border-border',
        className,
      )}
    >
      <Search color={colors.mutedForeground} size={18} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        accessibilityRole="search"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        accessibilityHint={accessibilityHint}
        className="flex-1 text-base text-foreground"
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => (onClear ? onClear() : onChangeText?.(''))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <X color={colors.mutedForeground} size={18} />
        </Pressable>
      ) : null}
    </View>
  )
}
