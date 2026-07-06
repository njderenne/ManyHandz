/**
 * Google's encoded polyline algorithm — the same one Strava, Mapbox,
 * Apple Maps, and most fitness apps use. Round-trippable, ~10x smaller
 * than raw lat/lng arrays.
 *
 * Reference:
 *   https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * Pure TS, no deps (projectgains donor, verbatim). Used by:
 *   • the live tracker (src/lib/gps/live-track-store.ts) to accumulate + filter fixes
 *   • whatever domain save an app adds (encode the trace into a `route_polyline` column)
 *   • the route-map renderer (src/components/native/route-map.tsx) to draw the trace
 *   • provider syncs (incoming polylines are already encoded — apps just store them)
 */

export interface LatLng {
  lat: number
  lng: number
}

/**
 * Encode an array of lat/lng points into a polyline string. Default
 * precision of 5 matches Google / Strava / Mapbox; 6 is used by some
 * other services (Mapbox Directions API specifically).
 */
export function encodePolyline(points: LatLng[], precision = 5): string {
  if (points.length === 0) return ''
  const factor = Math.pow(10, precision)
  let lastLat = 0
  let lastLng = 0
  let out = ''
  for (const p of points) {
    const lat = Math.round(p.lat * factor)
    const lng = Math.round(p.lng * factor)
    out += encodeValue(lat - lastLat) + encodeValue(lng - lastLng)
    lastLat = lat
    lastLng = lng
  }
  return out
}

/** Decode a polyline string back into lat/lng points. */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = Math.pow(10, precision)
  const len = encoded.length
  const out: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < len) {
    const dLat = decodeValue(encoded, index)
    index = dLat.next
    lat += dLat.value
    const dLng = decodeValue(encoded, index)
    index = dLng.next
    lng += dLng.value
    out.push({ lat: lat / factor, lng: lng / factor })
  }
  return out
}

/**
 * Filter low-accuracy GPS points before encoding. Drops anything with
 * an accuracy field above `maxMeters`. Pass the raw points the device
 * watcher delivers; get back the points worth encoding.
 *
 * Also collapses near-duplicate consecutive points (< 1m apart) to keep
 * the polyline tight without losing meaningful turns.
 */
export function filterGpsPoints(
  raw: Array<LatLng & { accuracy?: number }>,
  maxAccuracyMeters = 25,
): LatLng[] {
  const out: LatLng[] = []
  for (const p of raw) {
    if (p.accuracy != null && p.accuracy > maxAccuracyMeters) continue
    if (out.length === 0) {
      out.push({ lat: p.lat, lng: p.lng })
      continue
    }
    const prev = out[out.length - 1]
    const d = haversineMeters(prev, p)
    if (d >= 1) {
      out.push({ lat: p.lat, lng: p.lng })
    }
  }
  return out
}

/** Great-circle distance between two lat/lng points in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000 // earth radius, m
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Total path length in meters by haversine-summing consecutive points. */
export function totalDistanceMeters(points: LatLng[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i])
  }
  return total
}

// =============================================
// Screen-space projection — for the tile-free route renderer
// =============================================

/** A projected screen-space point (pixels, y grows downward). */
export interface XY {
  x: number
  y: number
}

/**
 * Project a route into a width×height box for the tile-free renderer (route-map / route-map.web).
 *
 * Equirectangular projection with longitude scaled by cos(midLatitude) — over route-sized extents
 * (a run, a walk, a delivery loop) this keeps shapes visually true without dragging in a mapping
 * library; a full Mercator would be indistinguishable at these scales. The route is uniformly
 * scaled (aspect preserved — a loop stays a loop) and centered inside the box minus `padding` on
 * every side.
 *
 * Degenerate inputs are total, never NaN: an empty route returns `[]`, and a single point / a
 * zero-extent route (standing still) pins to the box center.
 */
export function fitPointsToBox(
  points: LatLng[],
  width: number,
  height: number,
  padding = 12,
): XY[] {
  if (points.length === 0) return []

  const innerW = Math.max(1, width - padding * 2)
  const innerH = Math.max(1, height - padding * 2)

  // Longitude compression at this latitude band — one factor for the whole route.
  const midLat = (Math.min(...points.map((p) => p.lat)) + Math.max(...points.map((p) => p.lat))) / 2
  const lngScale = Math.cos((midLat * Math.PI) / 180)

  // Planar coordinates: x east, y north (flipped to screen-y below).
  const planar = points.map((p) => ({ x: p.lng * lngScale, y: p.lat }))
  const minX = Math.min(...planar.map((p) => p.x))
  const maxX = Math.max(...planar.map((p) => p.x))
  const minY = Math.min(...planar.map((p) => p.y))
  const maxY = Math.max(...planar.map((p) => p.y))
  const spanX = maxX - minX
  const spanY = maxY - minY

  // Zero-extent route (single fix, or standing still) — everything sits at the center.
  if (spanX === 0 && spanY === 0) {
    return planar.map(() => ({ x: width / 2, y: height / 2 }))
  }

  // Uniform scale (aspect preserved), then center the leftover axis.
  const scale = Math.min(innerW / (spanX || Number.EPSILON), innerH / (spanY || Number.EPSILON))
  const offsetX = padding + (innerW - spanX * scale) / 2
  const offsetY = padding + (innerH - spanY * scale) / 2

  return planar.map((p) => ({
    x: offsetX + (p.x - minX) * scale,
    // Screen y grows DOWN; latitude grows UP — flip so north is at the top.
    y: offsetY + (maxY - p.y) * scale,
  }))
}

// =============================================
// Internal helpers — the core of Google's encoding
// =============================================

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  out += String.fromCharCode(v + 63)
  return out
}

function decodeValue(
  encoded: string,
  index: number,
): { value: number; next: number } {
  let shift = 0
  let result = 0
  let byte: number
  let i = index
  do {
    byte = encoded.charCodeAt(i++) - 63
    result |= (byte & 0x1f) << shift
    shift += 5
  } while (byte >= 0x20)
  const value = result & 1 ? ~(result >> 1) : result >> 1
  return { value, next: i }
}
