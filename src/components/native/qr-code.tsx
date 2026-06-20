import { View } from 'react-native'
import QRCodeSvg from 'react-native-qrcode-svg'

/**
 * QRCode — renders a QR for any string (referral links, share URLs, pairing codes). Built on
 * react-native-svg, so it works on native and web. Keep the light background for scan contrast.
 */
export function QRCode({ value, size = 160 }: { value: string; size?: number }) {
  if (!value) return null
  return (
    <View className="self-start rounded-xl bg-white p-3">
      <QRCodeSvg value={value} size={size} color="#0a0e1a" backgroundColor="#ffffff" />
    </View>
  )
}
