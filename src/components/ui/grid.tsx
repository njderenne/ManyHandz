import { Children, type ReactNode } from 'react'
import { View, type DimensionValue } from 'react-native'
import { cn } from '@/lib/utils'

/**
 * Grid — lay children out in an equal-width grid that WRAPS (N per row), instead of the "tall skinny
 * columns" you get from `flex-row` + `flex-1` with several items. Each cell takes a fixed fraction
 * of the width; a 7-item, 3-column grid becomes rows of 3 + 3 + 1.
 *
 * Gutters come from per-cell padding — RN's flex `gap` plus percentage widths overflow and wrap
 * wrong — offset by the container's negative margin (`-m-1`). Pair with `aspect-square` (or a min
 * height) on each child for tidy card cells:
 *
 *   <Grid columns={3}>
 *     {days.map((d) => <DayCard key={d.iso} … />)}
 *   </Grid>
 *
 * Reach for this over a raw `flex-row` whenever you have more than ~4 equal cells: a phone-width row
 * of 7 turns each into an unusable sliver.
 */
export type GridProps = {
  /** Cells per row. Default 3. */
  columns?: number
  children: ReactNode
  className?: string
}

export function Grid({ columns = 3, children, className }: GridProps) {
  const items = Children.toArray(children)
  const width = `${100 / columns}%` as DimensionValue
  return (
    <View className={cn('-m-1 flex-row flex-wrap', className)}>
      {items.map((child, i) => (
        <View key={i} style={{ width }} className="p-1">
          {child}
        </View>
      ))}
    </View>
  )
}
