import { View } from 'react-native'
import { cn } from '@/lib/utils'
import { Text } from '@/components/ui/text'

/**
 * Small layout helpers shared across the dev component gallery (Section / Row / Swatch).
 * Dev tooling only — not part of the shipped chassis.
 */
export function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <View className="gap-3">
      <View className="gap-0.5">
        <Text variant="muted" className="uppercase tracking-wider">
          {title}
        </Text>
        {description ? <Text variant="caption">{description}</Text> : null}
      </View>
      {children}
    </View>
  )
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text variant="muted" className="flex-1">
        {label}
      </Text>
      {children}
    </View>
  )
}

export function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <View className="items-center gap-1">
      <View className={cn('size-14 rounded-md border border-border', className)} />
      <Text variant="caption">{name}</Text>
    </View>
  )
}
