import * as Location from 'expo-location'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useLiveTrackStore, type IngestableLocation } from './live-track-store'
import { t, type TranslationKey } from '@/lib/i18n'

/**
 * Live tracker (NATIVE) — the device layer that feeds the live-track store with GPS fixes.
 *
 * ── FOREGROUND-ONLY IN V1, BY CONTRACT (M-1) ─────────────────────────────────────────────────────
 * The template's app.json declares whenInUse location only: no `UIBackgroundModes: ['location']`,
 * no `ACCESS_BACKGROUND_LOCATION`, and `expo-task-manager` is deliberately NOT in package.json.
 * Adding those keys template-wide would declare background location for every minted app (Apple
 * 2.5.4/5.1.1 review + the Play Console background-location declaration audit) when almost none
 * use it. So v1 tracking is `Location.watchPositionAsync` + `expo-keep-awake` while the tracking
 * screen is up — which genuinely works today: the screen stays awake, fixes keep flowing, and the
 * track survives pause/resume. Locking the phone or switching apps suspends the watch; the track
 * resumes (with a gap) when the app returns.
 *
 * The BACKGROUND path is a per-app MINT recipe (builder/MINT.md § "enabling background GPS"): the
 * app installs `expo-task-manager`, adds the app.json background keys + purpose strings, files the
 * Play declaration, and cuts a NEW EAS build. `startBackgroundTracking()` below reaches that path
 * through a guarded dynamic require and returns `{ available: false }` until the app has done so —
 * never a top-level import, so today's EAS + web builds stay green.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Both the foreground watch and (when finalized) the background task feed the SAME
 * `useLiveTrackStore.getState().ingest(...)`, which de-dupes by distance, so overlapping fixes
 * never double-count the route. The web build resolves live-tracker.web.ts instead
 * (navigator.geolocation only).
 *
 * LEAK GUARD: `stopLiveTracking()` MUST run when the tracking screen unmounts (a `useEffect`
 * cleanup on the screen) — it removes the watch subscription and releases the wake lock, and is
 * idempotent so double-stops are safe. No location subscription may survive navigation away;
 * live-tracker.test.ts proves the teardown. The guard has a re-entrancy half: there is ONE
 * module-level subscription slot, so `startLiveTracking()` while already tracking short-circuits
 * (and a concurrent double-start removes the older watch before overwriting the slot) — a
 * double-tapped Start button must never orphan a live GPS watch that only app-kill can stop.
 */

/** Tag for the keep-awake lock (and the background task name once an app finalizes that path). */
export const LIVE_TRACK_TAG = 'live-track'

/** Live foreground subscription handle — removed in stopLiveTracking. */
let foregroundSub: Location.LocationSubscription | null = null

export type StartTrackingResult = { ok: true } | { ok: false; reason: string }

/**
 * Request foreground permission, start the store + the position watch, and keep the screen awake.
 * Returns a structured result so the screen can render a clear EmptyState on denial
 * (`t('gps.permissionDenied')`) rather than failing silently.
 */
export async function startLiveTracking(): Promise<StartTrackingResult> {
  // RE-ENTRANCY GUARD: already tracking → reuse the live watch. Assigning a second subscription
  // over `foregroundSub` would orphan the first — it keeps firing (GPS + battery) and only the
  // LAST one is reachable by stopLiveTracking(). Double-tap on Start, or a second tracking screen
  // mounting before the first one's cleanup, must land here, not on a second watch.
  if (foregroundSub) {
    return { ok: true }
  }

  // Foreground permission first — without it there's no location at all.
  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== 'granted') {
    return { ok: false, reason: 'foreground-denied' }
  }

  // Keep the screen on while tracking (M-1: the screen being up IS the tracking guarantee).
  try {
    await activateKeepAwakeAsync(LIVE_TRACK_TAG)
  } catch {
    // non-fatal — tracking still works, the screen may just sleep sooner
  }

  // Arm the store before the first fix so nothing is dropped by the status gate.
  useLiveTrackStore.getState().start()

  // Foreground watch — high-rate updates feeding the route + readouts.
  try {
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 5,
        timeInterval: 1000,
      },
      (loc) => {
        useLiveTrackStore.getState().ingest([loc])
      },
    )
    // Concurrent-start race: two calls can pass the top guard before either awaits back. Whoever
    // lands second removes the earlier watch before taking the slot — one live subscription, ever.
    // (The cast re-widens what TS narrowed to null at the top guard — the awaits above are
    // exactly where a racing call can assign the module slot.)
    const raced = foregroundSub as Location.LocationSubscription | null
    if (raced) {
      raced.remove()
    }
    foregroundSub = sub
  } catch (e) {
    // Roll back the half-start so a failed watch never leaves a ticking store or a wake lock.
    useLiveTrackStore.getState().reset()
    try {
      deactivateKeepAwake(LIVE_TRACK_TAG)
    } catch {
      // non-fatal
    }
    return { ok: false, reason: e instanceof Error ? e.message : 'watch-failed' }
  }

  return { ok: true }
}

/**
 * Tear down the watch and release the wake lock. Safe to call repeatedly (idempotent) — the
 * screen's unmount cleanup calls this unconditionally. Deliberately does NOT reset the store:
 * the screen reads the finished track (points/distance/duration) for its save flow, then calls
 * `useLiveTrackStore.getState().reset()` itself.
 */
export async function stopLiveTracking(): Promise<void> {
  if (foregroundSub) {
    foregroundSub.remove()
    foregroundSub = null
  }

  try {
    deactivateKeepAwake(LIVE_TRACK_TAG)
  } catch {
    // non-fatal — the lock dies with the screen either way
  }
}

// ─── Background path — per-app MINT recipe, guarded (M-1) ─────────────────────────────────────────

export type BackgroundTrackingResult =
  | { available: false; reason: string }
  | { available: true; started: boolean; reason?: string }

/**
 * Lazy, guarded handle to expo-task-manager. The require uses a LITERAL module string inside a
 * try/catch — Metro needs a static literal to resolve a `require`, but because the package isn't
 * in package.json the bundler treats the unresolved id as a runtime miss (the catch swallows it)
 * rather than a hard build error. Identical to the react-native-purchases pattern in
 * src/lib/billing/purchases.ts and the health bridge (src/lib/health/bridge.ts).
 */
function getTaskManager(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-task-manager')
    return mod?.default ?? mod ?? null
  } catch {
    return null
  }
}

/**
 * Is the background-GPS path available on this build? False on the stock template (the dep isn't
 * installed) and on web. True only after an app follows the MINT background-GPS recipe. Cheap +
 * synchronous — screens use it to decide whether to even offer a "keep tracking in background"
 * toggle.
 */
export function gpsBackgroundAvailable(): { available: boolean } {
  return { available: getTaskManager() !== null }
}

/**
 * Start background location updates — the projectgains dual-pipeline path, reachable ONLY after
 * the per-app device-finalization recipe (builder/MINT.md § "enabling background GPS"):
 *
 *   1. `npx expo install expo-task-manager`
 *   2. app.json: `UIBackgroundModes: ['location']` (iOS), `isAndroidBackgroundLocationEnabled` +
 *      `ACCESS_BACKGROUND_LOCATION`/`FOREGROUND_SERVICE_LOCATION` (Android), purpose strings
 *   3. the Play Console background-location declaration, then a NEW EAS build
 *   4. app code defines the location task at MODULE SCOPE (TaskManager.defineTask(LIVE_TRACK_TAG,
 *      …ingest into the store…)) so headless background launches can deliver batches — a task
 *      defined only inside this call covers app-alive backgrounding, not process relaunch
 *
 * Until then this returns `{ available: false }` and the foreground tracker carries the session.
 * Background permission is best-effort even when available: "while using" grants still track in
 * the foreground watch.
 */
export async function startBackgroundTracking(options?: {
  notificationTitle?: string
  notificationBody?: string
}): Promise<BackgroundTrackingResult> {
  const TaskManager = getTaskManager()
  if (!TaskManager) {
    return { available: false, reason: 'not-installed' }
  }

  // The dep exists (an app finalized the recipe) — request the background grant and start updates.
  let backgroundGranted = false
  try {
    const bg = await Location.requestBackgroundPermissionsAsync()
    backgroundGranted = bg.status === 'granted'
  } catch {
    backgroundGranted = false
  }
  if (!backgroundGranted) {
    return { available: true, started: false, reason: 'background-denied' }
  }

  // Defensive in-call task definition — the recipe's module-scope defineTask (step 4) is the real
  // registration; this covers the app-alive window if that wiring is missing.
  try {
    if (!TaskManager.isTaskDefined(LIVE_TRACK_TAG)) {
      TaskManager.defineTask(LIVE_TRACK_TAG, async ({ data, error }: { data: unknown; error: unknown }) => {
        if (error) return
        const locations = (data as { locations?: IngestableLocation[] } | undefined)?.locations
        if (locations && locations.length > 0) {
          useLiveTrackStore.getState().ingest(locations)
        }
      })
    }

    const already = await Location.hasStartedLocationUpdatesAsync(LIVE_TRACK_TAG)
    if (!already) {
      await Location.startLocationUpdatesAsync(LIVE_TRACK_TAG, {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 5,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          // User-facing Android notification copy — through the catalog like everything else
          // (house i18n rule); every finalized background-GPS app ships translatable defaults.
          // The casts bridge the stage-0 file split: the two gps.backgroundNotification* keys land
          // in en.ts via this cluster's i18n manifest at integration — drop the casts if en.ts
          // ever exports them before this file compiles against it.
          notificationTitle:
            options?.notificationTitle ?? t('gps.backgroundNotificationTitle' as TranslationKey),
          notificationBody:
            options?.notificationBody ?? t('gps.backgroundNotificationBody' as TranslationKey),
        },
      })
    }
    return { available: true, started: true }
  } catch (e) {
    // Background updates failed (service restrictions, missing app.json keys despite the dep) —
    // the foreground watch still records.
    return { available: true, started: false, reason: e instanceof Error ? e.message : 'start-failed' }
  }
}

/** Stop background updates if the finalized path ever started them. Safe on the stock template. */
export async function stopBackgroundTracking(): Promise<void> {
  const TaskManager = getTaskManager()
  if (!TaskManager) return
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LIVE_TRACK_TAG)
    if (started) {
      await Location.stopLocationUpdatesAsync(LIVE_TRACK_TAG)
    }
  } catch {
    // already stopped / not registered — fine
  }
}
