import { View } from 'react-native'
import { Vibrate, MapPin, Camera, Fingerprint, Bell, QrCode, ChartLine } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { HubList, type HubItem } from '@/components/gallery/hub'

/**
 * Native hub — entry point of the Native tab. One row per device capability; rows push stack
 * screens. Each tester requests its own permission and needs a dev build that includes the module.
 */
const CAPABILITIES: HubItem[] = [
  { title: 'Haptics', description: 'expo-haptics — tactile feedback (no-op on web)', icon: Vibrate, route: '/native/haptics' },
  { title: 'Location & Maps', description: 'expo-location — GPS coords + map view', icon: MapPin, route: '/native/location' },
  { title: 'Camera & Photos', description: 'expo-image-picker — pick or take a photo', icon: Camera, route: '/native/camera' },
  { title: 'Biometrics', description: 'Face ID / Touch ID / passcode unlock', icon: Fingerprint, route: '/native/biometrics' },
  { title: 'Notifications', description: 'Push registration + local scheduling', icon: Bell, route: '/native/notifications' },
  { title: 'QR codes', description: 'react-native-qrcode-svg', icon: QrCode, route: '/native/qr' },
  { title: 'Charts', description: 'Interactive Skia gallery (victory-native)', icon: ChartLine, route: '/charts' },
]

export default function NativeHub() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <View className="gap-1">
        <Text variant="h1">Native</Text>
        <Text variant="muted">Device capabilities behind clean wrappers — install the latest dev build to try them.</Text>
      </View>
      <HubList items={CAPABILITIES} />
    </PageWrapper>
  )
}
