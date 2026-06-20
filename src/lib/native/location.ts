import * as Location from 'expo-location'

/**
 * Location (GPS) — request permission + read the current position. Works on native and on web
 * (browser geolocation). For continuous tracking (live runs/routes) use Location.watchPositionAsync
 * with expo-task-manager for background updates.
 *
 * Speed strategy (a precise GPS fix can take 10s+, which felt broken):
 *  1. getLastKnownPositionAsync() — near-instant; return it if recent enough.
 *  2. else getCurrentPositionAsync(Balanced) — typically 1–3s — raced against a timeout so it can
 *     never hang.
 *  3. on timeout/failure, fall back to last known (even if stale) before giving up.
 * Note: the permission request is intentionally NOT timed out — it waits on the user's dialog.
 */
export type Coords = { latitude: number; longitude: number; accuracy: number | null }

export type LocationResult =
  | { ok: true; coords: Coords }
  | { ok: false; error: string }

const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes — fresh enough for a "where am I" tap
const POSITION_TIMEOUT_MS = 6000

function toCoords(p: Location.LocationObject): Coords {
  return { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Location request timed out')), ms)),
  ])
}

export async function getCurrentLocation(): Promise<LocationResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') return { ok: false, error: 'Location permission denied' }

    // 1) Last known — usually returns in well under a second.
    const lastKnown = await Location.getLastKnownPositionAsync()
    if (lastKnown && Date.now() - lastKnown.timestamp < LAST_KNOWN_MAX_AGE_MS) {
      return { ok: true, coords: toCoords(lastKnown) }
    }

    // 2) Fresh fix at Balanced accuracy, bounded by a timeout so it can't hang.
    try {
      const pos = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        POSITION_TIMEOUT_MS,
      )
      return { ok: true, coords: toCoords(pos) }
    } catch (fetchError) {
      // 3) Timed out / failed — better to show a slightly stale spot than nothing.
      if (lastKnown) return { ok: true, coords: toCoords(lastKnown) }
      throw fetchError
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Location unavailable' }
  }
}
