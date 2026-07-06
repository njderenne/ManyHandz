import { Platform } from 'react-native'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Health bridge — a BUILD-SAFE adapter over the native Apple HealthKit / Google Health Connect
 * read APIs, modeled on the RevenueCat IAP adapter (src/lib/billing/purchases.ts). projectgains
 * donor, generalized: nothing here knows what the app does with the samples.
 *
 * The native read modules (react-native-health on iOS, react-native-health-connect on Android) are a
 * documented DEVICE-FINALIZATION step (see the bottom of this file), so this module must NOT
 * hard-depend on them: they are not in package.json, and `npm run export:web` + the current EAS
 * build must stay GREEN without them. The trick is identical to the IAP adapter:
 *
 *   - On web (Platform.OS === 'web') we never even attempt the require.
 *   - Every reference to a native module goes through a GUARDED dynamic `require`, wrapped so that
 *     when the module / native binary is absent, every call returns `{ available: false }` instead
 *     of throwing — so an integrations screen shows "Available in the app" rather than crashing.
 *
 * FEATURE GATE: `isHealthAvailable()` also requires `APP_CONFIG.features.health` — the one surface
 * gate. An app that hasn't opted into the health module sees `false` everywhere (no dangling
 * "connect health" affordances), and flipping the flag costs nothing until the modules are
 * actually installed.
 *
 * To FINALIZE on device (one-time, no code here changes — the guards light up automatically once the
 * modules + native binaries exist):
 *   iOS      → `npm i react-native-health`, add its config plugin to app.config.js (HealthKit
 *              entitlement + NSHealthShareUsageDescription), rebuild via EAS, then implement the
 *              read calls below against its API (HealthKit query for body mass + workouts).
 *   Android  → `npm i react-native-health-connect`, add its config plugin (Health Connect
 *              permissions in AndroidManifest), rebuild via EAS, then implement the reads against
 *              its `readRecords('Weight' | 'ExerciseSession', …)` API.
 *   Server   → the synced rows POST through whatever domain routes the app owns; the sync_state
 *              toggle rides the existing per-(user, provider) checkpoint table
 *              (src/lib/db/schema.ts `sync_state`, provider 'apple_health' / 'health_connect').
 */

/** A bodyweight reading read from the device health store. */
export interface HealthBodyweight {
  /** ms epoch of the measurement. */
  measuredAtMs: number
  /** Weight in kilograms (HealthKit/Health Connect store SI units). */
  weightKg: number
  /** Stable per-record id from the health store, used as the dedupe external_id. */
  externalId: string
}

/** A workout/exercise session read from the device health store. */
export interface HealthWorkout {
  externalId: string
  startedAtMs: number
  endedAtMs: number | null
  /** Distance in meters (null for non-distance workouts). */
  distanceMeters: number | null
  /** Active energy burned, kcal. */
  calories: number | null
  /** Workout type label from the store (e.g. 'running'). */
  kind: string | null
}

/** Result envelope — `available:false` is the build-safe "no native module / web / flag off" signal. */
export type HealthResult<T> = ({ available: true } & T) | { available: false }

/**
 * Lazy, guarded handle to the native health module. Returns null on web, when the module isn't
 * installed, or when the native binary is missing — callers treat null as unavailable.
 *
 * The require uses LITERAL module strings (one per platform) inside a try/catch — Metro/webpack
 * needs a static literal to resolve a `require`, but because the package isn't in package.json the
 * bundler treats the unresolved id as a runtime miss (the catch swallows it) rather than a hard
 * build error. This is exactly the pattern src/lib/billing/purchases.ts uses for react-native-
 * purchases, so the web export + the EAS build both stay green without the health module installed.
 */
function getHealthModule(): any | null {
  if (Platform.OS === 'ios') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('react-native-health')
      return mod?.default ?? mod ?? null
    } catch {
      return null
    }
  }
  if (Platform.OS === 'android') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('react-native-health-connect')
      return mod?.default ?? mod ?? null
    } catch {
      return null
    }
  }
  // web / anything else — no native health store.
  return null
}

/**
 * Is the native health read API available right now? True only when the app has opted in
 * (`features.health`) AND we're on a native platform where the module + its native binary both
 * exist. Integration screens read this to decide between the real sync row and an
 * `t('health.notAvailable')` placeholder. Pure + synchronous — safe during render.
 */
export function isHealthAvailable(): boolean {
  if (!APP_CONFIG.features.health) return false
  return Platform.OS !== 'web' && getHealthModule() !== null
}

/** Human label for the active platform's health store (UI copy, e.g. `t('health.connect', { platform })`). */
export function healthPlatformLabel(): string {
  if (Platform.OS === 'ios') return 'Apple Health'
  if (Platform.OS === 'android') return 'Health Connect'
  return 'Health'
}

/**
 * Request read permission for bodyweight + workouts. Returns `available:false` when the native
 * module is absent; `{ available:true, granted }` once it's wired up. The real implementation calls
 * the module's permission request (HealthKit `initHealthKit` / Health Connect `requestPermission`).
 */
export async function requestPermissions(): Promise<HealthResult<{ granted: boolean }>> {
  const mod = APP_CONFIG.features.health ? getHealthModule() : null
  if (!mod) return { available: false }
  try {
    // DEVICE FINALIZATION: implement against the installed module's permission API. The guard above
    // guarantees `mod` is the real native module here. Until implemented, report not-granted rather
    // than guess — the screen treats this as "couldn't enable" without crashing.
    return { available: true, granted: false }
  } catch {
    return { available: false }
  }
}

/**
 * Read bodyweight samples since `sinceMs`. Returns `available:false` when unavailable so the caller
 * can fall back. The real implementation queries body-mass records and maps them to HealthBodyweight.
 */
export async function readBodyweight(_sinceMs: number): Promise<HealthResult<{ samples: HealthBodyweight[] }>> {
  const mod = APP_CONFIG.features.health ? getHealthModule() : null
  if (!mod) return { available: false }
  try {
    // DEVICE FINALIZATION: query body-mass samples since `_sinceMs` and map to HealthBodyweight[].
    return { available: true, samples: [] }
  } catch {
    return { available: false }
  }
}

/**
 * Read workouts since `sinceMs`. Returns `available:false` when unavailable. The real implementation
 * queries workout/exercise-session records and maps them to HealthWorkout — what the app does with
 * them (which domain table they land in) is app-layer, not chassis.
 */
export async function readWorkouts(_sinceMs: number): Promise<HealthResult<{ workouts: HealthWorkout[] }>> {
  const mod = APP_CONFIG.features.health ? getHealthModule() : null
  if (!mod) return { available: false }
  try {
    // DEVICE FINALIZATION: query workouts since `_sinceMs` and map to HealthWorkout[].
    return { available: true, workouts: [] }
  } catch {
    return { available: false }
  }
}
