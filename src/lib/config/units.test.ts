import { describe, it, expect } from 'vitest'
import {
  cmToInches,
  inchesToCm,
  cmToFeet,
  feetToCm,
  kgToLbs,
  lbsToKg,
  metersToMiles,
  milesToMeters,
  metersToKm,
  kmToMeters,
  unitSymbol,
  toDisplayValue,
  fromDisplayValue,
  formatMeasurement,
  formatDuration,
  formatPace,
} from './units'

/**
 * Units — characterization tests for the EXISTING canonical-SI converters/formatters (they had no
 * coverage before the 2026-07-05 harvest) plus the harvest additions (formatDuration/formatPace).
 * Expected values pin the international (1959) definitions so a factor typo fails loudly.
 */

describe('length converters (canonical = cm)', () => {
  it('converts by the exact 2.54 cm/inch definition', () => {
    expect(inchesToCm(1)).toBe(2.54)
    expect(cmToInches(2.54)).toBe(1)
    expect(cmToInches(182.88)).toBeCloseTo(72, 10)
  })

  it('round-trips cm → in → cm without drift', () => {
    for (const cm of [0, 1, 63.5, 182.88, 250.7]) {
      expect(inchesToCm(cmToInches(cm))).toBeCloseTo(cm, 10)
    }
  })

  it('feet converters are 12-inch consistent', () => {
    expect(feetToCm(6)).toBeCloseTo(182.88, 10)
    expect(cmToFeet(182.88)).toBeCloseTo(6, 10)
  })
})

describe('weight converters (canonical = kg)', () => {
  it('converts by the exact 0.45359237 kg/lb definition', () => {
    expect(lbsToKg(1)).toBe(0.45359237)
    expect(kgToLbs(0.45359237)).toBeCloseTo(1, 10)
    expect(kgToLbs(70)).toBeCloseTo(154.3236, 4)
  })

  it('round-trips kg → lb → kg without drift', () => {
    for (const kg of [0, 2.5, 70, 120.4]) {
      expect(lbsToKg(kgToLbs(kg))).toBeCloseTo(kg, 10)
    }
  })
})

describe('distance converters (canonical = m)', () => {
  it('converts by the exact 1609.344 m/mile definition', () => {
    expect(milesToMeters(1)).toBe(1609.344)
    expect(metersToMiles(1609.344)).toBe(1)
    expect(metersToKm(5000)).toBe(5)
    expect(kmToMeters(5)).toBe(5000)
  })

  it('round-trips m → mi → m without drift', () => {
    for (const m of [0, 400, 1609.344, 42195]) {
      expect(milesToMeters(metersToMiles(m))).toBeCloseTo(m, 8)
    }
  })
})

describe('unit specs + display conversion', () => {
  it('exposes the right symbols per system', () => {
    expect(unitSymbol('length', 'imperial')).toBe('in')
    expect(unitSymbol('weight', 'imperial')).toBe('lbs')
    expect(unitSymbol('distance', 'imperial')).toBe('mi')
    expect(unitSymbol('length', 'metric')).toBe('cm')
    expect(unitSymbol('weight', 'metric')).toBe('kg')
    expect(unitSymbol('distance', 'metric')).toBe('km')
  })

  it('toDisplayValue/fromDisplayValue are inverses in both systems', () => {
    const canonical = 182.88 // cm
    const shown = toDisplayValue(canonical, 'length', 'imperial')
    expect(shown).toBeCloseTo(72, 10)
    expect(fromDisplayValue(shown, 'length', 'imperial')).toBeCloseTo(canonical, 10)
    // Metric is the identity for length/weight.
    expect(toDisplayValue(canonical, 'length', 'metric')).toBe(canonical)
  })
})

describe('formatMeasurement', () => {
  it('formats the documented examples', () => {
    expect(formatMeasurement(182.88, 'length', 'imperial')).toBe('72 in')
    expect(formatMeasurement(182.88, 'length', 'metric')).toBe('182.9 cm')
    expect(formatMeasurement(70, 'weight', 'imperial')).toBe('154.3 lbs')
    expect(formatMeasurement(5000, 'distance', 'metric')).toBe('5 km')
  })

  it('renders imperial height as feet + inches on request', () => {
    expect(formatMeasurement(182.88, 'length', 'imperial', { feetInches: true })).toBe('6 ft 0 in')
    expect(formatMeasurement(175.26, 'length', 'imperial', { feetInches: true })).toBe('5 ft 9 in')
  })

  it('honours the digits option and trims trailing zeros', () => {
    expect(formatMeasurement(70, 'weight', 'imperial', { digits: 0 })).toBe('154 lbs')
    expect(formatMeasurement(5000, 'distance', 'imperial', { digits: 2 })).toBe('3.11 mi')
  })
})

describe('formatDuration (harvest addition)', () => {
  it('formats hours as H:MM:SS', () => {
    expect(formatDuration(5025)).toBe('1:23:45')
    expect(formatDuration(3600)).toBe('1:00:00')
  })

  it('formats sub-hour durations as M:SS', () => {
    expect(formatDuration(303)).toBe('5:03')
    expect(formatDuration(59)).toBe('0:59')
  })

  it('rounds once up front so :60 never appears at a boundary', () => {
    expect(formatDuration(359.6)).toBe('6:00')
    expect(formatDuration(3599.7)).toBe('1:00:00')
  })

  it('returns an em-dash for zero/invalid input', () => {
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(-5)).toBe('—')
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('formatPace (harvest addition)', () => {
  it("formats seconds-per-km in minutes'seconds\" notation", () => {
    expect(formatPace(330, 'km')).toBe('5\'30" /km')
  })

  it('converts to per-mile via the exact 1.609344 factor', () => {
    // 330 s/km * 1.609344 = 531.08 s/mi → 8'51"
    expect(formatPace(330, 'mi')).toBe('8\'51" /mi')
  })

  it("rounds before splitting so a boundary value renders 6'00\", not 5'60\"", () => {
    expect(formatPace(359.6, 'km')).toBe('6\'00" /km')
  })

  it('returns an em-dash for zero/invalid pace', () => {
    expect(formatPace(0, 'km')).toBe('—')
    expect(formatPace(-10, 'mi')).toBe('—')
    expect(formatPace(Number.NaN, 'km')).toBe('—')
  })
})
