import { useLiveTrackStore } from './live-track-store'

/**
 * Live tracker (WEB fallback) — Metro resolves this file on web in place of live-tracker.ts.
 *
 * The browser has no background task, no foreground service, no keep-awake, and no
 * expo-task-manager — so this is a thin wrapper over `navigator.geolocation.watchPosition` that
 * feeds the SAME live-track store. It exists primarily so
 * `import { startLiveTracking } from '@/lib/gps/live-tracker'` resolves identically on web and
 * keeps `npm run export:web` green (the native file imports native-only modules).
 *
 * Tracking screens should still show `t('gps.webLimited')` on web — a browser tab throttles
 * geolocation aggressively when hidden — but having a working watch here means the web build is
 * fully type-safe and honestly best-effort rather than a dead stub.
 */

/** Mirrors the native tag so shared code can reference one constant. */
export const LIVE_TRACK_TAG = 'live-track'

export type StartTrackingResult = { ok: true } | { ok: false; reason: string }

export type BackgroundTrackingResult =
  | { available: false; reason: string }
  | { available: true; started: boolean; reason?: string }

/** The active geolocation watch id, or null when not watching. */
let watchId: number | null = null

export async function startLiveTracking(): Promise<StartTrackingResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { ok: false, reason: 'geolocation-unavailable' }
  }

  // RE-ENTRANCY GUARD (mirrors live-tracker.ts): already watching → reuse it. Overwriting
  // `watchId` without clearWatch would orphan the first browser watch until the tab dies. The
  // guard is race-safe here because `watchId` is assigned synchronously below (watchPosition
  // returns its id inside the Promise executor — no await precedes the assignment).
  if (watchId != null) {
    return { ok: true }
  }

  // Arm the store before the first fix so nothing is dropped by the status gate.
  useLiveTrackStore.getState().start()

  return new Promise<StartTrackingResult>((resolve) => {
    let settled = false
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        // First successful fix resolves the start; every fix feeds the store.
        useLiveTrackStore.getState().ingest([
          {
            coords: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
            },
            timestamp: pos.timestamp,
          },
        ])
        if (!settled) {
          settled = true
          resolve({ ok: true })
        }
      },
      (err) => {
        if (!settled) {
          settled = true
          // A denied/failed watch must not leave a ticking store — or a claimed watch slot —
          // behind. Clearing + nulling here keeps the re-entrancy guard honest: a retry after a
          // denial starts a fresh watch instead of short-circuiting on a dead one.
          navigator.geolocation.clearWatch(id)
          if (watchId === id) watchId = null
          useLiveTrackStore.getState().reset()
          const reason = err.code === err.PERMISSION_DENIED ? 'foreground-denied' : err.message
          resolve({ ok: false, reason })
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    // Claim the slot after arming — geolocation callbacks are queued, never synchronous, so `id`
    // is always assigned before either callback can run.
    watchId = id
  })
}

/** Clear the geolocation watch. Idempotent — the screen's unmount cleanup calls it blindly. */
export async function stopLiveTracking(): Promise<void> {
  if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId)
  }
  watchId = null
}

/** Background GPS does not exist in a browser — same `{ available: false }` degradation as native. */
export function gpsBackgroundAvailable(): { available: boolean } {
  return { available: false }
}

export async function startBackgroundTracking(_options?: {
  notificationTitle?: string
  notificationBody?: string
}): Promise<BackgroundTrackingResult> {
  return { available: false, reason: 'web' }
}

export async function stopBackgroundTracking(): Promise<void> {
  // nothing to stop on web
}
