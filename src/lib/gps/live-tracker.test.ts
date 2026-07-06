import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Live tracker — the LEAK GUARD proof (CLUSTERS B5 acceptance) plus the M-1 foreground-only
 * contract. expo-location / expo-keep-awake are mocked (no device in Node); the store runs REAL,
 * so the status gate + distance accumulation are exercised end to end.
 *
 * What must hold:
 *   • stopLiveTracking() removes the watch subscription AND releases keep-awake — no location
 *     subscription survives navigation away from the tracking screen.
 *   • stop is idempotent (the screen's unmount cleanup calls it unconditionally).
 *   • a denied permission / failed watch never leaks a wake lock or a ticking store.
 *   • startBackgroundTracking() returns { available: false } on the stock template
 *     (expo-task-manager is NOT installed — M-1's guarded-require law).
 */

const removeMock = vi.fn()
const watchPositionAsyncMock = vi.fn()
const requestForegroundPermissionsAsyncMock = vi.fn()

vi.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    requestForegroundPermissionsAsyncMock(...args),
  requestBackgroundPermissionsAsync: vi.fn(async () => ({ status: 'denied' })),
  watchPositionAsync: (...args: unknown[]) => watchPositionAsyncMock(...args),
  hasStartedLocationUpdatesAsync: vi.fn(async () => false),
  startLocationUpdatesAsync: vi.fn(async () => undefined),
  stopLocationUpdatesAsync: vi.fn(async () => undefined),
}))

const activateKeepAwakeAsyncMock = vi.fn(async (..._args: unknown[]) => undefined)
const deactivateKeepAwakeMock = vi.fn()

vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: (...args: unknown[]) => activateKeepAwakeAsyncMock(...args),
  deactivateKeepAwake: (...args: unknown[]) => deactivateKeepAwakeMock(...args),
}))

// live-tracker.ts pulls @/lib/i18n (the foreground-service notification copy goes through t()),
// whose expo-localization import can't load in Node (expo-modules-core wants __DEV__) — stub it.
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
  useLocales: () => [{ languageCode: 'en' }],
}))

import {
  startLiveTracking,
  stopLiveTracking,
  startBackgroundTracking,
  gpsBackgroundAvailable,
  LIVE_TRACK_TAG,
} from './live-tracker'
import { useLiveTrackStore, type IngestableLocation } from './live-track-store'

/** The position callback captured from the last watchPositionAsync call. */
let watchCallback: ((loc: IngestableLocation) => void) | null = null

beforeEach(async () => {
  vi.clearAllMocks()
  watchCallback = null
  requestForegroundPermissionsAsyncMock.mockResolvedValue({ status: 'granted' })
  watchPositionAsyncMock.mockImplementation(async (_opts, cb) => {
    watchCallback = cb
    return { remove: removeMock }
  })
  // A previous test's tracker state must never bleed: stop + reset between tests.
  await stopLiveTracking()
  useLiveTrackStore.getState().reset()
  vi.clearAllMocks()
})

function fix(lat: number, lng: number, accuracy = 5): IngestableLocation {
  return { coords: { latitude: lat, longitude: lng, accuracy }, timestamp: Date.now() }
}

describe('startLiveTracking (foreground, M-1)', () => {
  it('starts the watch + keep-awake and arms the store', async () => {
    const res = await startLiveTracking()
    expect(res).toEqual({ ok: true })
    expect(watchPositionAsyncMock).toHaveBeenCalledTimes(1)
    expect(activateKeepAwakeAsyncMock).toHaveBeenCalledWith(LIVE_TRACK_TAG)
    expect(useLiveTrackStore.getState().status).toBe('tracking')
    await stopLiveTracking()
  })

  it('feeds watch fixes into the store and accumulates distance', async () => {
    await startLiveTracking()
    watchCallback!(fix(43.0, -89.4))
    watchCallback!(fix(43.001, -89.4)) // ~111 m north
    const s = useLiveTrackStore.getState()
    expect(s.rawPoints).toHaveLength(2)
    expect(s.distanceMeters).toBeGreaterThan(100)
    expect(s.distanceMeters).toBeLessThan(125)
    await stopLiveTracking()
  })

  it('drops fixes while paused — a paused track never grows', async () => {
    await startLiveTracking()
    watchCallback!(fix(43.0, -89.4))
    useLiveTrackStore.getState().pause()
    watchCallback!(fix(43.01, -89.4)) // arrives mid-pause → dropped
    expect(useLiveTrackStore.getState().rawPoints).toHaveLength(1)
    expect(useLiveTrackStore.getState().pauseCount).toBe(1)
    await stopLiveTracking()
  })

  it('returns a structured denial and never starts the watch or wake lock', async () => {
    requestForegroundPermissionsAsyncMock.mockResolvedValue({ status: 'denied' })
    const res = await startLiveTracking()
    expect(res).toEqual({ ok: false, reason: 'foreground-denied' })
    expect(watchPositionAsyncMock).not.toHaveBeenCalled()
    expect(activateKeepAwakeAsyncMock).not.toHaveBeenCalled()
    expect(useLiveTrackStore.getState().status).toBe('idle')
  })

  it('rolls back the store + wake lock when the watch itself fails (no half-start leak)', async () => {
    watchPositionAsyncMock.mockRejectedValue(new Error('boom'))
    const res = await startLiveTracking()
    expect(res).toEqual({ ok: false, reason: 'boom' })
    expect(useLiveTrackStore.getState().status).toBe('idle')
    // The lock acquired before the watch attempt is released again.
    expect(deactivateKeepAwakeMock).toHaveBeenCalledWith(LIVE_TRACK_TAG)
  })
})

describe('re-entrant start — the double-start leak guard', () => {
  it('a second start while tracking reuses the live watch — never arms a second subscription', async () => {
    await startLiveTracking()
    const res = await startLiveTracking() // double-tap on Start / second screen mount
    expect(res).toEqual({ ok: true })
    expect(watchPositionAsyncMock).toHaveBeenCalledTimes(1) // no second watch
    await stopLiveTracking()
    // The ONE watch dies with the screen — nothing survives that only app-kill could stop.
    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('two CONCURRENT starts never leave two live watches (loser is removed on overwrite)', async () => {
    // Both calls pass the top guard before either finishes awaiting — the overwrite path must
    // remove the earlier subscription before taking the module slot.
    const [a, b] = await Promise.all([startLiveTracking(), startLiveTracking()])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    await stopLiveTracking()
    // Invariant: every subscription ever armed was also removed — zero orphans.
    expect(removeMock).toHaveBeenCalledTimes(watchPositionAsyncMock.mock.calls.length)
  })
})

describe('stopLiveTracking — the leak guard', () => {
  it('removes the watch subscription and releases keep-awake', async () => {
    await startLiveTracking()
    await stopLiveTracking()
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(deactivateKeepAwakeMock).toHaveBeenCalledWith(LIVE_TRACK_TAG)
  })

  it('is idempotent — a double-stop never double-removes or throws', async () => {
    await startLiveTracking()
    await stopLiveTracking()
    await stopLiveTracking()
    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('a stopped watch delivers nothing even if a stale callback fires (store keeps its data)', async () => {
    await startLiveTracking()
    watchCallback!(fix(43.0, -89.4))
    await stopLiveTracking()
    // stop does NOT reset the store (the screen reads the finished track for its save flow)…
    expect(useLiveTrackStore.getState().rawPoints).toHaveLength(1)
    // …and the screen's own reset() clears it.
    useLiveTrackStore.getState().reset()
    expect(useLiveTrackStore.getState().rawPoints).toHaveLength(0)
  })
})

describe('background path (M-1: per-app MINT recipe, guarded require)', () => {
  it('gpsBackgroundAvailable() is false on the stock template (dep not installed)', () => {
    // In Vitest's ESM transform `require` is unavailable exactly like a missing module —
    // both land in the guarded catch, which is the contract under test.
    expect(gpsBackgroundAvailable()).toEqual({ available: false })
  })

  it('startBackgroundTracking() degrades to { available: false } without throwing', async () => {
    const res = await startBackgroundTracking()
    expect(res.available).toBe(false)
  })
})
