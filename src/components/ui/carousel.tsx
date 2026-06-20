import { Children, memo, useState } from 'react'
import { View, ScrollView, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native'
import { cn } from '@/lib/utils'

/**
 * Carousel — a horizontally paged swiper with page dots. Each direct child is one full-width page
 * (onboarding, feature highlights, image galleries).
 */
/** Page dots — memoized so parent re-renders with an unchanged index skip the row entirely. */
const Dots = memo(function Dots({ count, index }: { count: number; index: number }) {
  return (
    <View className="flex-row justify-center gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          className={cn('h-1.5 rounded-full', i === index ? 'w-4 bg-primary' : 'w-1.5 bg-muted')}
        />
      ))}
    </View>
  )
})
export function Carousel({ children, className }: { children: React.ReactNode; className?: string }) {
  const [width, setWidth] = useState(0)
  const [index, setIndex] = useState(0)
  const pages = Children.toArray(children)

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = e.nativeEvent.layoutMeasurement.width
    if (w > 0) setIndex(Math.round(e.nativeEvent.contentOffset.x / w))
  }

  return (
    <View className={cn('gap-3', className)} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
      >
        {pages.map((page, i) => (
          <View key={i} style={{ width }}>
            {page}
          </View>
        ))}
      </ScrollView>
      {pages.length > 1 ? <Dots count={pages.length} index={index} /> : null}
    </View>
  )
}
