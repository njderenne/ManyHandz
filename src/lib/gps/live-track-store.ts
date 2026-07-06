import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { filterGpsPoints, haversineMeters, type LatLng } from './polyline'

/**
 * Live-track store — the single source of truth for the ACTIVE GPS track (projectgains'
 * live-run-store, generalized: the running-specific unit/split/pace bookkeeping moved to the app
 * layer — the chassis accumulates points, distance, and pause-aware duration, nothing else).
 *
 * This is deliberately plain Zustand (no persistence): a live track is ephemeral and is flushed
 * to the server by whatever domain mutation the app wires to Stop. It is read + written from TWO
 * places:
 *
 *   • the React tracking screen, via the `useLiveTrack()` selector hook, and
 *   • the device layer (live-tracker.ts / live-tracker.web.ts), which calls
 *     `useLiveTrackStore.getState().ingest(locations)` OUTSIDE React — location callbacks fire
 *     with no component context, so they must reach the store imperatively.
 *
 * Distance is meters (SI-canonical, per src/lib/config/units.ts doctrine) — display conversion is
 * the screen's job (`formatMeasurement(distanceMeters, 'distance', system)`). Duration excludes
 * pauses: pause() freezes the elapsed segment into an accumulator; resume() restarts the clock.
 * Fixes arriving while paused/idle are DROPPED — a paused track never grows.
 *
 * The GPS math itself is the pure-TS layer (polyline.ts) — this store only orchestrates
 * accumulation on top of it. What apps layer back on top (splits, pace, laps) composes over
 * `rawPoints`/`distanceMeters`/`elapsedSeconds()` without touching this file.
 */

export type LiveTrackStatus = 'idle' | 'tracking' | 'paused'

/** A raw fix as delivered by the device layer — kept verbatim for accuracy filtering. */
export interface RawPoint extends LatLng {
  accuracy?: number
  timestamp: number
}

/** A loose shape that covers both expo-location's LocationObject and the browser GeolocationPosition. */
export interface IngestableLocation {
  coords: { latitude: number; longitude: number; accuracy?: number | null }
  timestamp: number
}

interface LiveTrackState {
  status: LiveTrackStatus
  /** Every accepted fix (post accuracy filter), in order. */
  rawPoints: RawPoint[]
  /** Accumulated great-circle distance in meters. */
  distanceMeters: number
  /** Wall-clock ms at the most recent start()/resume(). 0 when not actively tracking. */
  startedAtMs: number
  /** Epoch ms of the very first start() — the track's startedAt. */
  trackStartedAtMs: number
  /** Frozen elapsed seconds accumulated across prior tracking segments (excludes pauses). */
  accumulatedSeconds: number
  /** How many times the track has been paused (surfaced for domain saves that care). */
  pauseCount: number

  start: () => void
  pause: () => void
  resume: () => void
  reset: () => void
  ingest: (locations: IngestableLocation[]) => void
  /** Total elapsed tracking seconds (accumulated + current live segment), excluding pauses. */
  elapsedSeconds: () => number
}

const INITIAL = {
  status: 'idle' as LiveTrackStatus,
  rawPoints: [] as RawPoint[],
  distanceMeters: 0,
  startedAtMs: 0,
  trackStartedAtMs: 0,
  accumulatedSeconds: 0,
  pauseCount: 0,
}

export const useLiveTrackStore = create<LiveTrackState>((set, get) => ({
  ...INITIAL,

  start: () => {
    const now = Date.now()
    set({
      ...INITIAL,
      status: 'tracking',
      startedAtMs: now,
      trackStartedAtMs: now,
    })
  },

  pause: () => {
    const s = get()
    if (s.status !== 'tracking') return
    // Freeze the live segment's seconds into the accumulator, then stop the clock.
    const liveSeconds = s.startedAtMs > 0 ? (Date.now() - s.startedAtMs) / 1000 : 0
    set({
      status: 'paused',
      accumulatedSeconds: s.accumulatedSeconds + liveSeconds,
      startedAtMs: 0,
      pauseCount: s.pauseCount + 1,
    })
  },

  resume: () => {
    const s = get()
    if (s.status !== 'paused') return
    set({ status: 'tracking', startedAtMs: Date.now() })
  },

  reset: () => set({ ...INITIAL }),

  elapsedSeconds: () => {
    const s = get()
    const liveSeconds =
      s.status === 'tracking' && s.startedAtMs > 0 ? (Date.now() - s.startedAtMs) / 1000 : 0
    return s.accumulatedSeconds + liveSeconds
  },

  ingest: (locations) => {
    const s = get()
    // Drop everything unless we're actively tracking — paused/idle fixes must not move the route.
    if (s.status !== 'tracking' || locations.length === 0) return

    // Normalise device fixes into the raw shape the filter understands.
    const incoming: RawPoint[] = locations
      .filter((l) => l && l.coords && Number.isFinite(l.coords.latitude))
      .map((l) => ({
        lat: l.coords.latitude,
        lng: l.coords.longitude,
        accuracy: l.coords.accuracy ?? undefined,
        timestamp: l.timestamp ?? Date.now(),
      }))
    if (incoming.length === 0) return

    // Filter the NEW batch together with the last accepted point so accuracy + the <1m de-dupe are
    // evaluated against the real previous fix (filterGpsPoints only looks back within its argument).
    const tail = s.rawPoints[s.rawPoints.length - 1]
    const filtered = filterGpsPoints(tail ? [tail, ...incoming] : incoming)
    // If we seeded with the tail, the first filtered point IS the tail — skip it.
    const accepted = tail ? filtered.slice(1) : filtered
    if (accepted.length === 0) return

    // Accumulate distance from the previous accepted point through the new ones.
    let added = 0
    let prev: LatLng | undefined = tail
    const acceptedRaw: RawPoint[] = []
    for (let i = 0; i < accepted.length; i++) {
      const p = accepted[i]
      if (prev) added += haversineMeters(prev, p)
      // Carry the timestamp/accuracy from the matching incoming fix where possible.
      const match = incoming.find((r) => r.lat === p.lat && r.lng === p.lng)
      acceptedRaw.push({
        lat: p.lat,
        lng: p.lng,
        accuracy: match?.accuracy,
        timestamp: match?.timestamp ?? Date.now(),
      })
      prev = p
    }

    set({
      rawPoints: [...s.rawPoints, ...acceptedRaw],
      distanceMeters: s.distanceMeters + added,
    })
  },
}))

/**
 * Selector hook for the tracking screen — returns the reactive slice plus the actions. Uses a
 * shallow compare so the screen only re-renders when one of these fields actually changes (the
 * per-second ticking of elapsed time is driven by the screen's own interval, not the store).
 */
export function useLiveTrack() {
  return useLiveTrackStore(
    useShallow((s) => ({
      status: s.status,
      rawPoints: s.rawPoints,
      distanceMeters: s.distanceMeters,
      trackStartedAtMs: s.trackStartedAtMs,
      pauseCount: s.pauseCount,
      start: s.start,
      pause: s.pause,
      resume: s.resume,
      reset: s.reset,
      elapsedSeconds: s.elapsedSeconds,
    })),
  )
}
