import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'

/**
 * Skeleton — a shimmering placeholder for loading content. Size it with className
 * (e.g. `h-4 w-32`). The pulse runs on the native thread via Moti/Reanimated.
 *
 * Composed variants for the common shapes so loading screens read as one line each:
 * `SkeletonText` (n lines, last one shorter), `SkeletonCircle` (avatar), and `SkeletonCard`
 * (avatar header + text lines on a card surface).
 */
export function Skeleton({ className, style }: { className?: string; style?: StyleProp<ViewStyle> }) {
  const colors = useColors()
  return (
    <View className={cn('overflow-hidden rounded-md bg-muted', className)} style={style}>
      <MotiView
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.skeleton }]}
        from={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ loop: true, repeatReverse: true, type: 'timing', duration: 900 }}
      />
    </View>
  )
}

/** Paragraph placeholder — `lines` shimmer bars with the final line cut short, like real text. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  // Widths cycle slightly so multi-line blocks don't look like a barcode.
  const widths = ['w-full', 'w-11/12', 'w-full']
  return (
    <View className={cn('gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-3/5' : widths[i % widths.length])} />
      ))}
    </View>
  )
}

/** Avatar placeholder — a shimmering circle sized like the Avatar it stands in for. */
export function SkeletonCircle({ size = 40, className }: { size?: number; className?: string }) {
  return <Skeleton className={cn('rounded-full', className)} style={{ width: size, height: size }} />
}

/** A full loading card: avatar + name/subtitle header over a short paragraph. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <View className={cn('gap-3 rounded-lg border border-border bg-card p-4', className)}>
      <View className="flex-row items-center gap-3">
        <SkeletonCircle size={40} />
        <View className="flex-1 gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </View>
      </View>
      <SkeletonText lines={2} />
    </View>
  )
}
