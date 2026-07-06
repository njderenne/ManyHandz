import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { OTPInput } from '@/components/ui/otp-input'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { verifyPin, hasPin, clearPin } from '@/lib/security/pin'
import { authenticate } from '@/lib/native/biometrics'

/** Failed PIN attempts after which the recovery affordance always appears, even if a PIN hash
 *  exists — a last-resort escape hatch (e.g. a forgotten passcode), not just the desync case. */
const MAX_ATTEMPTS = 5

/**
 * PinLock — full-screen passcode gate. Calls `onUnlock` when the PIN verifies or biometrics
 * succeed. Render it over the app (or a sensitive screen) until unlocked. See lib/security/pin.
 *
 * Recovery affordance: on mount it checks the keychain for an actual PIN hash. If none exists
 * (e.g. an OS/iCloud restore that kept app prefs but not the keychain entry) or after MAX_ATTEMPTS
 * failed entries, a "Reset app lock" action appears that clears any stored hash and unlocks — so a
 * user can never be permanently stranded behind an unverifiable PIN with biometrics unavailable.
 * A host that gates the whole app behind this (see the AppLockGate pattern) should ALSO turn its
 * own app-lock pref off in onUnlock so the gate doesn't immediately re-lock.
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
  const [attempts, setAttempts] = useState(0)
  // null = not yet checked; false = no PIN hash in the keychain (always recoverable).
  const [pinExists, setPinExists] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void hasPin().then((exists) => {
      if (!cancelled) setPinExists(exists)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function onChange(value: string) {
    setError(false)
    setPin(value)
    if (value.length === length) {
      if (await verifyPin(value)) onUnlock()
      else {
        setError(true)
        setPin('')
        setAttempts((n) => n + 1)
      }
    }
  }

  async function tryBiometric() {
    if (await authenticate('Unlock the app')) onUnlock()
  }

  // Clear the lock and let the user back in — used when the keychain has no PIN to verify against,
  // or as a forgotten-passcode escape hatch after repeated failures.
  async function resetLock() {
    await clearPin()
    onUnlock()
  }

  // Surface recovery when there's no PIN to verify against, or after enough failed attempts.
  const showReset = pinExists === false || attempts >= MAX_ATTEMPTS

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
      {showReset ? (
        <Button variant="ghost" label="Reset app lock" onPress={resetLock} />
      ) : null}
    </View>
  )
}
