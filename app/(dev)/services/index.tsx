import { View } from 'react-native'
import {
  Sparkles,
  Mic,
  ImageMinus,
  Calendar,
  Volume2,
  BellRing,
  Gift,
  CreditCard,
  FileText,
} from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { HubList, type HubItem } from '@/components/gallery/hub'

/**
 * Services hub — entry point of the Services tab. One row per backend capability; rows push
 * stack screens with a live tester each. Backend-gated tests (AI / voice / email / billing)
 * need the Worker deployed + keys set; on-device ones work now.
 */
const SERVICES: HubItem[] = [
  { title: 'AI', description: 'Claude · OpenAI · Grok, streamed by tier', icon: Sparkles, route: '/services/ai' },
  { title: 'Voice', description: 'ElevenLabs TTS playback + record → transcribe', icon: Mic, route: '/services/voice' },
  { title: 'Background removal', description: 'rembg — pick an image → transparent PNG', icon: ImageMinus, route: '/services/image' },
  { title: 'Calendar', description: "Drop an event into the phone's built-in calendar", icon: Calendar, route: '/services/calendar' },
  { title: 'Sounds', description: 'Standard UI sounds (assets/sounds)', icon: Volume2, route: '/services/sounds' },
  { title: 'Push', description: 'Register this device, then send a test push', icon: BellRing, route: '/services/push' },
  { title: 'Referrals', description: 'Shareable code via the native share sheet', icon: Gift, route: '/services/referrals' },
  { title: 'PDF export', description: 'Tamper-evident report → PDF on device', icon: FileText, route: '/services/pdf' },
  { title: 'Email & Billing', description: 'Resend + Stripe, wired server-side', icon: CreditCard, route: '/services/billing' },
]

export default function ServicesHub() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <View className="gap-1">
        <Text variant="h1">Services</Text>
        <Text variant="muted">Live test surface for every backend capability</Text>
      </View>
      <HubList items={SERVICES} />
    </PageWrapper>
  )
}
