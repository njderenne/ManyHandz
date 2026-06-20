import { useRef, useState } from 'react'
import { MapPin } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { SimpleMap, type MapPoint } from '@/components/native/map-view'
import { Section } from '@/components/gallery/kit'
import { useToast } from '@/components/ui/toast'
import { haptics } from '@/lib/native/haptics'
import { getCurrentLocation, type Coords } from '@/lib/native/location'

/** Location tester — GPS fix + map. Requests its own permission; needs a dev build. */

const DEFAULT_CENTER: MapPoint = { latitude: 37.7749, longitude: -122.4194 }

export default function LocationScreen() {
  const { toast } = useToast()
  const [loc, setLoc] = useState<Coords | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const locationRequestId = useRef(0)
  const center: MapPoint = loc ? { latitude: loc.latitude, longitude: loc.longitude } : DEFAULT_CENTER

  // Disabled-while-loading stops most double taps; the request id guards against any that slip
  // through before state commits, so a stale response can't overwrite a newer one.
  const handleGetLocation = async () => {
    haptics.selection()
    setLocationLoading(true)
    const id = ++locationRequestId.current
    try {
      const res = await getCurrentLocation()
      if (id !== locationRequestId.current) return
      if (res.ok) {
        setLoc(res.coords)
        toast({ title: 'Location found', variant: 'success' })
      } else {
        toast({ title: res.error, variant: 'error' })
      }
    } finally {
      if (id === locationRequestId.current) setLocationLoading(false)
    }
  }

  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Location & Maps</Text>
      <Section title="Location / GPS" description="expo-location">
        <Button
          icon={MapPin}
          label="Get my location"
          loading={locationLoading}
          disabled={locationLoading}
          onPress={handleGetLocation}
        />
        {loc ? (
          <Text variant="muted">
            {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)} (±{Math.round(loc.accuracy ?? 0)}m)
          </Text>
        ) : null}
        <SimpleMap center={center} points={loc ? [{ ...center, title: 'You' }] : []} />
      </Section>
    </PageWrapper>
  )
}
