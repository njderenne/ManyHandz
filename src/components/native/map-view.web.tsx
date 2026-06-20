import { View } from 'react-native'
import { MapPin } from 'lucide-react-native'
import { useColors } from '@/lib/config/theme'
import { Text } from '@/components/ui/text'

/**
 * SimpleMap (web fallback) — react-native-maps has no web support, so on web we render a static
 * placeholder with the coordinates. Metro picks this file for the web platform automatically.
 */
export type MapPoint = { latitude: number; longitude: number; title?: string }

export function SimpleMap({
  center,
  height = 200,
  className,
}: {
  center: MapPoint
  points?: MapPoint[]
  height?: number
  className?: string
}) {
  const colors = useColors()
  return (
    <View
      className={`items-center justify-center gap-2 rounded-lg border border-border bg-muted ${className ?? ''}`}
      style={{ height }}
    >
      <MapPin color={colors.mutedForeground} size={28} />
      <Text variant="muted">Map renders on device</Text>
      <Text variant="caption">
        {center.latitude.toFixed(4)}, {center.longitude.toFixed(4)}
      </Text>
    </View>
  )
}
