/**
 * Measurement units — the imperial/metric system, conversion helpers, and formatters.
 *
 * WHY canonical storage: a measurement entered by the user is stored as a single SI-canonical
 * number (centimetres for length, kilograms for mass, metres for distance) regardless of the
 * unit system they're viewing in. The active `UnitSystem` is purely a DISPLAY concern — flip it
 * and every stored value re-renders in the new units with no data migration. So persist the
 * canonical value (see MeasurementInput), and call these formatters at render time.
 *
 * Everything here is pure and synchronous — safe at module scope, in tests, and during static
 * web export. No platform APIs, no React.
 *
 * ── TWO STORAGE PATTERNS (pick one per field) ────────────────────────────────────────────────────
 * (a) STORE CANONICAL SI, convert on display — this file + MeasurementInput/MeasurementValue.
 *     Persist one SI number (cm/kg/m); the active UnitSystem is a pure display choice, so flipping
 *     it re-renders every value with no migration. Simplest, and correct WHEN you never need to know
 *     the unit a value was originally entered in. The chassis default for derived/aggregate numbers.
 *
 * (b) STORE THE NATIVE value+unit PER ROW, convert via `measurement-storage` — for user-entered
 *     measurements where the original unit is data ("32 in" must read back "32 in", and two rows of
 *     the same kind may carry different units). Faithful to the user's input, and it avoids float
 *     DRIFT: editing a value without changing it is a no-op (no SI round-trip), whereas pattern (a)
 *     re-converts on every open/save and visibly drifts over repeated edits. Use `toCanonical` /
 *     `fromCanonical` from `measurement-storage.ts` to chart/compare/display ONLY — never to mutate
 *     the stored value+unit. This is the default for fields the user types a measurement into.
 *
 * Rule of thumb: storing a single global measurement you only ever show → (a). Storing a list of
 * measurements the user enters in mixed units → (b).
 */

export type UnitSystem = 'imperial' | 'metric'

/** Fleet default. Apps override via APP_CONFIG.units.default (read by the prefs store). */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'imperial'

/**
 * The three measurement KINDS the chassis handles. Each has its own canonical SI unit:
 * - `length`  → centimetres (cm)  — for heights, item dimensions
 * - `weight`  → kilograms  (kg)  — for body weight, package mass
 * - `distance`→ metres     (m)   — for travel/route distances
 */
export type MeasurementKind = 'length' | 'weight' | 'distance'

/** Exact conversion factors against the canonical SI unit. International (1959) definitions. */
const CM_PER_INCH = 2.54
const INCHES_PER_FOOT = 12
const KG_PER_LB = 0.45359237
const METERS_PER_MILE = 1609.344

// ── Length: canonical = centimetres ───────────────────────────────────────────
export const cmToInches = (cm: number): number => cm / CM_PER_INCH
export const inchesToCm = (inches: number): number => inches * CM_PER_INCH
export const cmToFeet = (cm: number): number => cmToInches(cm) / INCHES_PER_FOOT
export const feetToCm = (feet: number): number => feet * INCHES_PER_FOOT * CM_PER_INCH

// ── Weight: canonical = kilograms ─────────────────────────────────────────────
export const kgToLbs = (kg: number): number => kg / KG_PER_LB
export const lbsToKg = (lbs: number): number => lbs * KG_PER_LB

// ── Distance: canonical = metres ──────────────────────────────────────────────
export const metersToMiles = (m: number): number => m / METERS_PER_MILE
export const milesToMeters = (mi: number): number => mi * METERS_PER_MILE
export const metersToKm = (m: number): number => m / 1000
export const kmToMeters = (km: number): number => km * 1000

/**
 * Per-kind unit metadata for a given system: the user-facing unit symbol, plus the canonical↔
 * display converters. `toDisplay` takes a canonical SI value and returns the number shown in the
 * field; `fromDisplay` is the inverse (what to store when the user types). Length uses inches in
 * imperial (not feet) so a single numeric field stays simple — feet/inches is a formatting choice,
 * see `formatMeasurement`.
 */
type UnitSpec = {
  /** Short unit label shown next to the input / value (e.g. "in", "kg", "mi"). */
  symbol: string
  /** Canonical SI value → the number displayed in the active system. */
  toDisplay: (canonical: number) => number
  /** A number the user typed (in the active system) → canonical SI value to store. */
  fromDisplay: (display: number) => number
}

const UNIT_SPECS: Record<UnitSystem, Record<MeasurementKind, UnitSpec>> = {
  imperial: {
    length: { symbol: 'in', toDisplay: cmToInches, fromDisplay: inchesToCm },
    weight: { symbol: 'lbs', toDisplay: kgToLbs, fromDisplay: lbsToKg },
    distance: { symbol: 'mi', toDisplay: metersToMiles, fromDisplay: milesToMeters },
  },
  metric: {
    length: { symbol: 'cm', toDisplay: (cm) => cm, fromDisplay: (cm) => cm },
    weight: { symbol: 'kg', toDisplay: (kg) => kg, fromDisplay: (kg) => kg },
    distance: { symbol: 'km', toDisplay: metersToKm, fromDisplay: kmToMeters },
  },
}

/** The unit spec (symbol + converters) for a kind in the active system. */
export function unitSpec(kind: MeasurementKind, system: UnitSystem): UnitSpec {
  return UNIT_SPECS[system][kind]
}

/** The display unit symbol for a kind in the active system (e.g. `'lbs'`, `'kg'`). */
export function unitSymbol(kind: MeasurementKind, system: UnitSystem): string {
  return UNIT_SPECS[system][kind].symbol
}

/** Canonical SI value → the number shown in the active system (e.g. 1.8288 m-as-cm → 72 in). */
export function toDisplayValue(canonical: number, kind: MeasurementKind, system: UnitSystem): number {
  return UNIT_SPECS[system][kind].toDisplay(canonical)
}

/** A number entered in the active system → canonical SI value to store. */
export function fromDisplayValue(display: number, kind: MeasurementKind, system: UnitSystem): number {
  return UNIT_SPECS[system][kind].fromDisplay(display)
}

/** Round to `digits` decimal places without floating-point cruft (e.g. 72.0000001 → 72). */
function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/**
 * Format a canonical SI measurement for display in the active system, with its unit label.
 *
 * @example
 * formatMeasurement(182.88, 'length', 'imperial')           // "72 in"
 * formatMeasurement(182.88, 'length', 'imperial', { feetInches: true }) // "6 ft 0 in"
 * formatMeasurement(182.88, 'length', 'metric')             // "182.9 cm"
 * formatMeasurement(70, 'weight', 'imperial')               // "154.3 lbs"
 * formatMeasurement(5000, 'distance', 'metric')             // "5 km"
 */
export function formatMeasurement(
  canonical: number,
  kind: MeasurementKind,
  system: UnitSystem,
  opts?: {
    /** Decimal places for the value (default 1; trailing zeros trimmed). */
    digits?: number
    /** Length only + imperial only: render as `6 ft 0 in` instead of `72 in`. */
    feetInches?: boolean
  },
): string {
  const digits = opts?.digits ?? 1

  // Special case: imperial height as feet + inches reads far more naturally than "72 in".
  if (kind === 'length' && system === 'imperial' && opts?.feetInches) {
    const totalInches = cmToInches(canonical)
    const feet = Math.floor(totalInches / INCHES_PER_FOOT)
    const inches = round(totalInches - feet * INCHES_PER_FOOT, 0)
    return `${feet} ft ${inches} in`
  }

  // `round` already drops trailing zeros (5.0 → 5), so String() gives a clean "5" / "154.3".
  const value = round(toDisplayValue(canonical, kind, system), digits)
  return `${value} ${unitSymbol(kind, system)}`
}

// ── Duration & pace (2026-07-05 harvest — projectgains pace.ts, generalized) ──────────────────
// Time formatters for anything the GPS/tracking tier measures. Pure + synchronous like the rest
// of this file; distance stays SI-canonical (meters) everywhere else, so these are the ONLY
// helpers that speak "per km / per mile" directly.

/**
 * Format a duration in seconds as `H:MM:SS`, or `M:SS` when under an hour. Returns an em-dash
 * for zero/invalid input (an unstarted timer reads as "—", not "0:00").
 *
 * @example
 * formatDuration(5025)  // "1:23:45"
 * formatDuration(303)   // "5:03"
 * formatDuration(0)     // "—"
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '—'
  const total = Math.round(seconds) // round once up front so ":60" never appears at a boundary
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Format a pace (stored SI-canonical as seconds per KILOMETER) for display in the requested
 * distance unit, in the conventional minutes'seconds" notation. Returns an em-dash for
 * zero/invalid pace (a track with no distance yet has no pace).
 *
 * @example
 * formatPace(330, 'km') // "5'30\" /km"
 * formatPace(330, 'mi') // "8'51\" /mi"
 */
export function formatPace(secondsPerKm: number, unit: 'km' | 'mi'): string {
  if (!secondsPerKm || secondsPerKm <= 0 || !Number.isFinite(secondsPerKm)) return '—'
  // Convert via the exact factor above (m/mi ÷ m/km), then round to whole seconds BEFORE
  // splitting so a value like 359.6s renders 6'00", not 5'60".
  const perUnit = unit === 'mi' ? secondsPerKm * (METERS_PER_MILE / 1000) : secondsPerKm
  const total = Math.round(perUnit)
  const min = Math.floor(total / 60)
  const sec = total % 60
  return `${min}'${sec.toString().padStart(2, '0')}" /${unit}`
}
