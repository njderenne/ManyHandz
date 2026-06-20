import { useState } from 'react'
import { View } from 'react-native'
import { OTPInput } from '@/components/ui/otp-input'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { verifyPin } from '@/lib/security/pin'
import { authenticate } from '@/lib/native/biometrics'

/**
 * PinLock — full-screen passcode gate. Calls `onUnlock` when the PIN verifies or biometrics
 * succeed. Render it over the app (or a sensitive screen) until unlocked. See lib/security/pin.
 */
export function PinLock({
  onUnlock,
  length = 4,
  allowBiometrics = true,
}: {
  onUnlock: () => void
  length?: number
  allowBiometrics?: boolean
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  async function onChange(value: string) {
    setError(false)
    setPin(value)
    if (value.length === length) {
      if (await verifyPin(value)) onUnlock()
      else {
        setError(true)
        setPin('')
      }
    }
  }

  async function tryBiometric() {
    if (await authenticate('Unlock the app')) onUnlock()
  }

  return (
    <View className="flex-1 items-center justify-center gap-6 bg-background p-6">
      <Text variant="h2">Enter your PIN</Text>
      <OTPInput value={pin} onChangeText={onChange} length={length} />
      {error ? (
        <Text variant="caption" className="text-destructive">
          Incorrect PIN — try again
        </Text>
      ) : (
        <Text variant="muted">Use your {length}-digit passcode</Text>
      )}
      {allowBiometrics ? (
        <Button variant="ghost" label="Use Face ID / Touch ID" onPress={tryBiometric} />
      ) : null}
    </View>
  )
}
