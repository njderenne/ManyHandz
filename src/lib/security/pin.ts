import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'

/**
 * App PIN lock — a numeric passcode to enter the app, stored as a salted SHA-256 hash in the
 * device keychain (SecureStore), never in plaintext. Pairs with biometric unlock
 * (lib/native/biometrics). All calls are guarded so a keychain/crypto error can never crash a flow.
 */
const PIN_HASH_KEY = 'app.pin.hash'
const SALT = 'appfactory.pin.v1'

async function hashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${SALT}:${pin}`)
}

export async function setPin(pin: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(PIN_HASH_KEY, await hashPin(pin))
    return true
  } catch {
    return false
  }
}

export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const stored = await SecureStore.getItemAsync(PIN_HASH_KEY)
    return !!stored && stored === (await hashPin(pin))
  } catch {
    return false
  }
}

export async function hasPin(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(PIN_HASH_KEY)) !== null
  } catch {
    return false
  }
}

export async function clearPin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PIN_HASH_KEY)
  } catch {
    // ignore
  }
}
