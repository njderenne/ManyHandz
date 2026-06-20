import { View } from 'react-native'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

/**
 * ChartEmpty — what every chart renders when it has nothing plottable. victory-native's domain
 * math chokes on empty input (min/max of an empty set → Infinity → NaN rects in Skia), so the
 * chart components guard BEFORE mounting CartesianChart/PolarChart and show this instead. A new
 * app's first launch has zero rows everywhere — this state is the common case, not the edge.
 */
export function ChartEmpty({ height = 220, label }: { height?: number; label?: string }) {
  return (
    <View
      style={{ height }}
      className="items-center justify-center rounded-xl border border-dashed border-border bg-muted/30"
    >
      <Text variant="muted">{label ?? t('charts.noData')}</Text>
    </View>
  )
}
