import * as LocalAuthentication from 'expo-local-authentication'

/**
 * Biometrics — Face ID / Touch ID / device passcode gate (the "PIN to get in" flow). Pair with
 * expo-secure-store to gate access to sensitive screens. Returns false on web / unsupported devices.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync()
    const enrolled = await LocalAuthentication.isEnrolledAsync()
    return hasHardware && enrolled
  } catch {
    return false
  }
}

export async function authenticate(reason = 'Unlock'): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: reason })
    return res.success
  } catch {
    return false
  }
}
