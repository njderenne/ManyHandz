import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { QRCode } from '@/components/native/qr-code'
import { Section } from '@/components/gallery/kit'

/** QR tester — renders a scannable code (point another phone's camera at it). */
export default function QRScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">QR codes</Text>
      <Section title="QR codes" description="react-native-qrcode-svg">
        <QRCode value="https://github.com/njderenne/app-factory" />
      </Section>
    </PageWrapper>
  )
}
