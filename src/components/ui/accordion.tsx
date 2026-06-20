import { useState } from 'react'
import { View, Pressable } from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * Accordion — collapsible sections. Compose `<Accordion>` with `<AccordionItem title=…>`.
 * Each item manages its own open state.
 */
export function Accordion({ className, children }: { className?: string; children: React.ReactNode }) {
  return <View className={cn('rounded-lg border border-border bg-card px-4', className)}>{children}</View>
}

export function AccordionItem({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const colors = useColors()
  return (
    <View className="border-b border-border">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        className="flex-row items-center justify-between py-3.5 active:opacity-70"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text variant="label">{title}</Text>
        <ChevronDown
          color={colors.mutedForeground}
          size={18}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {open ? <View className="pb-3.5">{children}</View> : null}
    </View>
  )
}
