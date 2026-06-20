import { useState } from 'react'
import { Modal, View, Pressable, ScrollView, StyleSheet } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { useColors } from '@/lib/config/theme'
import { SearchBar } from './search-bar'
import { ListItem } from './list'
import { Text } from './text'

/**
 * CommandPalette — a global search / quick-action overlay (⌘K-style). Pass searchable items;
 * it filters by label as you type. Use for jump-to navigation, actions, and entity search.
 *
 * The closing scrim is a SIBLING behind the card, never its parent — an accessible Pressable
 * wrapping the card becomes a leaf a11y element on iOS and hides the search bar and results
 * from VoiceOver (same structure as dialog.tsx / sheet.tsx).
 */
export type CommandItem = {
  id: string
  label: string
  subtitle?: string
  icon?: LucideIcon
  onSelect: () => void
}

export function CommandPalette({
  visible,
  onClose,
  items,
  placeholder = 'Search…',
}: {
  visible: boolean
  onClose: () => void
  items: CommandItem[]
  placeholder?: string
}) {
  const colors = useColors()
  const [q, setQ] = useState('')
  const filtered = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()))

  /** Every close path resets the query — reopening with last session's filter is confusing. */
  const close = () => {
    setQ('')
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable
        onPress={close}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="bg-black/60"
      />
      {/* box-none: taps outside the card fall through to the scrim; the card absorbs its own. */}
      <View pointerEvents="box-none" className="flex-1 px-4 pt-20">
        <View className="overflow-hidden rounded-xl border border-border bg-card">
          <View className="border-b border-border p-2">
            <SearchBar value={q} onChangeText={setQ} placeholder={placeholder} />
          </View>
          <ScrollView className="max-h-80" keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <Text variant="muted" className="p-6 text-center">
                No results
              </Text>
            ) : (
              filtered.map((i) => {
                const Icon = i.icon
                return (
                  <ListItem
                    key={i.id}
                    title={i.label}
                    subtitle={i.subtitle}
                    left={Icon ? <Icon color={colors.mutedForeground} size={20} /> : undefined}
                    onPress={() => {
                      i.onSelect()
                      close()
                    }}
                  />
                )
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
