import { describe, it, expect } from 'vitest'
import {
  encodePolyline,
  decodePolyline,
  filterGpsPoints,
  fitPointsToBox,
  haversineMeters,
  totalDistanceMeters,
  type LatLng,
} from './polyline'

/**
 * Characterization tests for the GPS polyline engine (projectgains donor, verbatim port).
 * Expected values are derived by hand from Google's polyline algorithm and the haversine
 * formula so a porting regression would surface. `fitPointsToBox` is the template addition
 * (the tile-free route renderer's projection) — covered at the bottom.
 */
describe('encodePolyline / decodePolyline', () => {
  const classic: LatLng[] = [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]
  const classicEncoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'

  it('encodes the canonical Google example to the documented string', () => {
    expect(encodePolyline(classic)).toBe(classicEncoded)
  })

  it('decodes the canonical Google example back to the original coords', () => {
    const decoded = decodePolyline(classicEncoded)
    expect(decoded).toHaveLength(3)
    expect(decoded[0].lat).toBeCloseTo(38.5, 5)
    expect(decoded[0].lng).toBeCloseTo(-120.2, 5)
    expect(decoded[1].lat).toBeCloseTo(40.7, 5)
    expect(decoded[1].lng).toBeCloseTo(-120.95, 5)
    expect(decoded[2].lat).toBeCloseTo(43.252, 5)
    expect(decoded[2].lng).toBeCloseTo(-126.453, 5)
  })

  it('round-trips arbitrary coords within precision-5 tolerance (1e-5)', () => {
    const pts: LatLng[] = [
      { lat: 37.42359, lng: -122.0855 },
      { lat: 37.42374, lng: -122.08583 },
      { lat: 37.42301, lng: -122.0866 },
    ]
    const out = decodePolyline(encodePolyline(pts))
    expect(out).toHaveLength(pts.length)
    out.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(pts[i].lat, 5)
      expect(p.lng).toBeCloseTo(pts[i].lng, 5)
    })
  })

  it('encodes an empty array to an empty string, and decode is its inverse', () => {
    expect(encodePolyline([])).toBe('')
    expect(decodePolyline('')).toEqual([])
  })

  it('precision 6 yields a different (longer-resolution) encoding that still round-trips', () => {
    const pts: LatLng[] = [{ lat: 38.5, lng: -120.2 }]
    const enc6 = encodePolyline(pts, 6)
    expect(enc6).not.toBe(encodePolyline(pts, 5))
    const dec6 = decodePolyline(enc6, 6)
    expect(dec6[0].lat).toBeCloseTo(38.5, 6)
    expect(dec6[0].lng).toBeCloseTo(-120.2, 6)
  })
})

describe('haversineMeters', () => {
  it('measures ~111.19 km for one degree of latitude', () => {
    // 1 deg lat = (pi/180) * 6371000 = 111194.9 m
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(
      111194.9266,
      1,
    )
  })

  it('scales linearly for small latitude deltas (0.001 deg ~ 111.19 m)', () => {
    expect(
      haversineMeters({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }),
    ).toBeCloseTo(111.1949, 3)
  })

  it('returns 0 for identical points', () => {
    expect(haversineMeters({ lat: 40, lng: -120 }, { lat: 40, lng: -120 })).toBe(
      0,
    )
  })
})

describe('totalDistanceMeters', () => {
  it('sums consecutive haversine legs', () => {
    const pts: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0 },
      { lat: 0.002, lng: 0 },
    ]
    // two legs of ~111.1949 m each
    expect(totalDistanceMeters(pts)).toBeCloseTo(2 * 111.1949, 2)
  })

  it('is 0 for an empty or single-point path', () => {
    expect(totalDistanceMeters([])).toBe(0)
    expect(totalDistanceMeters([{ lat: 1, lng: 2 }])).toBe(0)
  })
})

describe('filterGpsPoints', () => {
  it('drops points whose accuracy exceeds the threshold', () => {
    const raw = [
      { lat: 0, lng: 0, accuracy: 5 },
      { lat: 1, lng: 0, accuracy: 50 }, // > default 25 -> dropped
      { lat: 2, lng: 0, accuracy: 10 },
    ]
    const out = filterGpsPoints(raw)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ lat: 0, lng: 0 })
    expect(out[1]).toEqual({ lat: 2, lng: 0 })
  })

  it('honours a custom maxAccuracyMeters boundary (strictly greater drops)', () => {
    const raw = [
      { lat: 0, lng: 0, accuracy: 10 }, // == 10, kept (not > 10)
      { lat: 1, lng: 0, accuracy: 11 }, // > 10, dropped
    ]
    const out = filterGpsPoints(raw, 10)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ lat: 0, lng: 0 })
  })

  it('keeps points missing the optional accuracy field', () => {
    const raw = [{ lat: 0, lng: 0 }, { lat: 5, lng: 0 }]
    expect(filterGpsPoints(raw)).toHaveLength(2)
  })

  it('collapses near-duplicate consecutive points (< 1 m apart)', () => {
    const raw = [
      { lat: 40, lng: -120 },
      { lat: 40.000005, lng: -120 }, // ~0.56 m -> dropped
      { lat: 40.00001, lng: -120 }, // ~1.11 m from first -> kept
    ]
    const out = filterGpsPoints(raw)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ lat: 40, lng: -120 })
    expect(out[1]).toEqual({ lat: 40.00001, lng: -120 })
  })

  it('returns an empty array for empty input', () => {
    expect(filterGpsPoints([])).toEqual([])
  })

  it('strips the accuracy field from emitted points', () => {
    const out = filterGpsPoints([{ lat: 1, lng: 2, accuracy: 3 }])
    expect(out[0]).toEqual({ lat: 1, lng: 2 })
    expect('accuracy' in out[0]).toBe(false)
  })
})

describe('fitPointsToBox', () => {
  it('returns [] for an empty route', () => {
    expect(fitPointsToBox([], 300, 200)).toEqual([])
  })

  it('pins a single point (zero-extent route) to the box center', () => {
    const out = fitPointsToBox([{ lat: 43, lng: -89 }], 300, 200)
    expect(out).toEqual([{ x: 150, y: 100 }])
  })

  it('pins a stationary multi-fix route to the center without NaN', () => {
    const out = fitPointsToBox(
      [{ lat: 43, lng: -89 }, { lat: 43, lng: -89 }],
      300,
      200,
    )
    expect(out).toHaveLength(2)
    for (const p of out) {
      expect(p).toEqual({ x: 150, y: 100 })
    }
  })

  it('keeps every projected point inside the padded box', () => {
    const route: LatLng[] = [
      { lat: 43.07, lng: -89.4 },
      { lat: 43.08, lng: -89.42 },
      { lat: 43.075, lng: -89.39 },
      { lat: 43.065, lng: -89.41 },
    ]
    const out = fitPointsToBox(route, 320, 180, 12)
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(12)
      expect(p.x).toBeLessThanOrEqual(320 - 12)
      expect(p.y).toBeGreaterThanOrEqual(12)
      expect(p.y).toBeLessThanOrEqual(180 - 12)
    }
  })

  it('flips latitude so north renders at the top (screen y grows down)', () => {
    const south = { lat: 43.0, lng: -89.4 }
    const north = { lat: 43.1, lng: -89.4 }
    const [southXY, northXY] = fitPointsToBox([south, north], 200, 200)
    expect(northXY.y).toBeLessThan(southXY.y)
  })

  it('preserves aspect: a tall thin route is not stretched to fill the width', () => {
    // 0.1 deg of latitude, 0.001 deg of longitude — the route is ~100x taller than wide.
    const route: LatLng[] = [
      { lat: 43.0, lng: -89.4 },
      { lat: 43.1, lng: -89.399 },
    ]
    const out = fitPointsToBox(route, 400, 400, 0)
    const spanX = Math.abs(out[1].x - out[0].x)
    const spanY = Math.abs(out[1].y - out[0].y)
    // Height fills the box; width stays proportionally tiny (uniform scale).
    expect(spanY).toBeCloseTo(400, 0)
    expect(spanX).toBeLessThan(10)
  })

  it('scales longitude by cos(latitude) so east-west distance is not exaggerated', () => {
    // At 60°N, 1 deg of longitude is ~half as long as 1 deg of latitude. A route spanning
    // 1 deg in each direction should therefore project ~2x taller than wide.
    const route: LatLng[] = [
      { lat: 60.0, lng: 10.0 },
      { lat: 61.0, lng: 11.0 },
    ]
    const out = fitPointsToBox(route, 1000, 1000, 0)
    const spanX = Math.abs(out[1].x - out[0].x)
    const spanY = Math.abs(out[1].y - out[0].y)
    expect(spanY / spanX).toBeCloseTo(1 / Math.cos((60.5 * Math.PI) / 180), 1)
  })
})
