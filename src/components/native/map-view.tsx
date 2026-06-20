import { useEffect, useRef } from 'react'
import { View, Platform } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { APP_CONFIG } from '@/lib/config/app'
import { Text } from '@/components/ui/text'

/**
 * SimpleMap (native) — a map with optional markers.
 *
 * iOS uses Apple Maps out of the box (no key). **Android uses Google Maps and hard-crashes if no
 * API key is present** in the manifest, so we render the real map on Android only when the app has
 * opted into maps (`APP_CONFIG.features.maps`) — otherwise a graceful placeholder. To enable
 * Android maps: set `features.maps: true` AND add the key via app.config.js (GOOGLE_MAPS_API_KEY),
 * then rebuild. The web build resolves map-view.web.tsx.
 */
export type MapPoint = { latitude: number; longitude: number; title?: string }

const mapsEnabled = Platform.OS !== 'android' || APP_CONFIG.features.maps

export function SimpleMap({
  center,
  points = [],
  height = 200,
  className,
}: {
  center: MapPoint
  points?: MapPoint[]
  height?: number
  className?: string
}) {
  const mapRef = useRef<MapView>(null)

  // Re-center when the target changes (e.g. after fetching the user's location). `initialRegion`
  // only sets the FIRST region — without this the map would stay on its initial center.
  useEffect(() => {
    mapRef.current?.animateToRegion(
      {
        latitude: center.latitude,
        longitude: center.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      600,
    )
  }, [center.latitude, center.longitude])

  if (!mapsEnabled) {
    return (
      <View className={className} style={{ height, borderRadius: 12, overflow: 'hidden' }}>
        <View className="flex-1 items-center justify-center gap-1 bg-muted px-4">
          <Text variant="label">Map unavailable</Text>
          <Text variant="caption" className="text-center">
            Add a Google Maps API key + enable maps to use maps on Android.
          </Text>
        </View>
      </View>
    )
  }

  return (
    <View className={className} style={{ height, borderRadius: 12, overflow: 'hidden' }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        showsUserLocation
        initialRegion={{
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
      >
        {points.map((p, i) => (
          <Marker key={i} coordinate={{ latitude: p.latitude, longitude: p.longitude }} title={p.title} />
        ))}
      </MapView>
    </View>
  )
}
