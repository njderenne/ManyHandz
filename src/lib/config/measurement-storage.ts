/**
 * measurement-storage — the value+unit-PER-ROW adapter that sits on top of `units.ts`.
 *
 * `units.ts` (and `MeasurementInput`) speak ONE language: canonical SI. Store the canonical number,
 * pick a `UnitSystem` at render time, done. That's the right model when the unit a value was entered
 * in doesn't matter — flip Imperial↔Metric and every value re-renders with no migration.
 *
 * But a *measurement* app often needs the opposite: store exactly what the user typed AND the unit
 * they typed it in — "32 in", "81 cm", "12.5 lb" — one named unit PER ROW, freely mixed. Two rows of
 * the same kind can carry different units. That faithfulness is the point (a tailor's "32 in" should
 * read back "32 in" forever, not "81.28 cm" because a global toggle moved), and it dodges a subtle
 * correctness trap — see CORRECTNESS below.
 *
 * This module is the adapter for that pattern: convert a stored {value, unit} to canonical SI ONLY
 * when you need to chart / compare / display across units, and convert canonical back into a target
 * named unit. It never decides what to store — the caller owns the stored value+unit and this module
 * never mutates it.
 *
 * Canonical bases match `units.ts` exactly — length→cm, weight→kg, distance→m — so a canonical value
 * produced here is interchangeable with one produced by `fromDisplayValue` / consumed by
 * `formatMeasurement`. All conversion factors are single-sourced from `units.ts`; this file adds no
 * new constants.
 *
 * ── CORRECTNESS: why store the native value+unit, not canonical ──────────────────────────────────
 * If you store canonical SI and let the user edit in their own unit, every edit round-trips through a
 * lossy pair of float conversions: displayed = toDisplay(stored); stored' = fromDisplay(displayed).
 * For an irrational-ish factor like 2.54 (and worse, 0.45359237) those two steps don't compose to the
 * identity in IEEE-754 — repeated open/save/open/save sessions visibly drift the number (32 in →
 * 31.999999996 in → …). Storing the user's NATIVE {value, unit} makes an edit that doesn't change the
 * number a true no-op: nothing is converted, so nothing drifts. Conversion happens ONLY on the
 * read path (charts, comparison, cross-unit display) and never writes back. That invariant — the
 * stored value+unit is immutable across pure-display reads — is what this adapter buys you.
 *
 * Pure, synchronous, no React, no platform APIs — safe at module scope, in tests, and during web
 * export. See the "TWO STORAGE PATTERNS" doc block in `units.ts` for which pattern to reach for.
 */

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
  type MeasurementKind,
  type UnitSystem,
} from './units'

/**
 * The named units this adapter understands, grouped by kind. Each is the unit a value can be STORED
 * in (what the user typed), as opposed to the system-level display symbol in `units.ts`. The first
 * unit of each kind is its canonical SI base (cm / kg / m), so `toCanonical(v, base, kind) === v`.
 */
export const UNITS_BY_KIND = {
  length: ['cm', 'in', 'ft'],
  weight: ['kg', 'lb'],
  distance: ['m', 'km', 'mi'],
} as const

/** A storage unit for a given kind, e.g. `MeasurementUnit<'length'>` is `'cm' | 'in' | 'ft'`. */
export type MeasurementUnit<K extends MeasurementKind = MeasurementKind> =
  (typeof UNITS_BY_KIND)[K][number]

/** Every named storage unit across all kinds: `'cm' | 'in' | 'ft' | 'kg' | 'lb' | 'm' | 'km' | 'mi'`. */
export type AnyMeasurementUnit = MeasurementUnit

/**
 * A stored measurement in the value+unit-per-row pattern: the exact number the user typed plus the
 * unit they typed it in. `unit` is constrained to the row's kind so a `length` row can't hold `'kg'`.
 */
export type StoredMeasurement<K extends MeasurementKind = MeasurementKind> = {
  value: number
  unit: MeasurementUnit<K>
  kind: K
}

/** The canonical SI base unit for a kind (matches `units.ts`: length→cm, weight→kg, distance→m). */
export const canonicalUnit = <K extends MeasurementKind>(kind: K): MeasurementUnit<K> =>
  UNITS_BY_KIND[kind][0] as MeasurementUnit<K>

// ── Conversion tables: each named unit ↔ its kind's canonical SI base ─────────────────────────────
// Built entirely from `units.ts` converters so the factors live in exactly one place. `toCanonical`
// turns a value in the named unit into the SI base; `fromCanonical` is the inverse.
type Conv = { toCanonical: (v: number) => number; fromCanonical: (si: number) => number }

const IDENTITY: Conv = { toCanonical: (v) => v, fromCanonical: (si) => si }

const CONVERTERS: Record<MeasurementKind, Record<string, Conv>> = {
  length: {
    cm: IDENTITY,
    in: { toCanonical: inchesToCm, fromCanonical: cmToInches },
    ft: { toCanonical: feetToCm, fromCanonical: cmToFeet },
  },
  weight: {
    kg: IDENTITY,
    lb: { toCanonical: lbsToKg, fromCanonical: kgToLbs },
  },
  distance: {
    m: IDENTITY,
    km: { toCanonical: kmToMeters, fromCanonical: metersToKm },
    mi: { toCanonical: milesToMeters, fromCanonical: metersToMiles },
  },
}

/** Validated converter lookup. `unit` is asserted against `kind` first, so the entry always exists. */
function converterFor(unit: string, kind: MeasurementKind): Conv {
  return CONVERTERS[kind][assertUnitForKind(unit, kind)]
}

// ── Validation: a row's unit must belong to its kind ──────────────────────────────────────────────

/** Is `unit` a valid storage unit for `kind`? Narrows `unit` to `MeasurementUnit<K>` when true. */
export function isUnitForKind<K extends MeasurementKind>(
  unit: string,
  kind: K,
): unit is MeasurementUnit<K> {
  return (UNITS_BY_KIND[kind] as readonly string[]).includes(unit)
}

/**
 * Throw if `unit` isn't a storage unit for `kind`. Use on the write path so an edit can't silently
 * re-unit a point (e.g. saving a `length` row with `'kg'`). Returns the narrowed unit on success.
 */
export function assertUnitForKind<K extends MeasurementKind>(
  unit: string,
  kind: K,
): MeasurementUnit<K> {
  if (!isUnitForKind(unit, kind)) {
    const allowed = UNITS_BY_KIND[kind].join(', ')
    throw new RangeError(`"${unit}" is not a valid ${kind} unit (expected one of: ${allowed})`)
  }
  return unit
}

/**
 * Resolve the storage unit for a kind: validates `unit` if given, otherwise falls back to the kind's
 * canonical SI base. Use when persisting a row — guarantees the stored unit matches the kind.
 *
 * @example storageUnit('length', 'in')  // 'in'
 * @example storageUnit('weight')        // 'kg'  (canonical fallback)
 */
export function storageUnit<K extends MeasurementKind>(
  kind: K,
  unit?: string,
): MeasurementUnit<K> {
  return unit === undefined ? canonicalUnit(kind) : assertUnitForKind(unit, kind)
}

// ── Conversion: stored named value ↔ canonical SI ─────────────────────────────────────────────────

/**
 * A value in a named `unit` → its canonical SI value (length→cm, weight→kg, distance→m). Validates
 * that `unit` belongs to `kind`. This is the READ path — call it to chart / compare / display a
 * stored row against others; it never touches the stored value+unit.
 *
 * @example toCanonical(32, 'in', 'length')  // 81.28  (cm)
 * @example toCanonical(12, 'lb', 'weight')  // 5.443… (kg)
 */
export function toCanonical<K extends MeasurementKind>(
  value: number,
  unit: string,
  kind: K,
): number {
  return converterFor(unit, kind).toCanonical(value)
}

/**
 * A canonical SI value → the equivalent value in the named `unit` (the inverse of `toCanonical`).
 * Use to render a canonical number (a chart axis, an aggregate) in a chosen display unit. Validates
 * that `unit` belongs to `kind`.
 *
 * @example fromCanonical(81.28, 'in', 'length')  // 32
 * @example fromCanonical(1000, 'km', 'distance') // 1
 */
export function fromCanonical<K extends MeasurementKind>(
  siValue: number,
  unit: string,
  kind: K,
): number {
  return converterFor(unit, kind).fromCanonical(siValue)
}

/**
 * Convert a stored value directly from its native `unit` into another named unit of the same kind,
 * via canonical SI. Convenience for cross-unit display/comparison without hand-threading the base.
 *
 * @example convert(32, 'in', 'cm', 'length')  // 81.28
 */
export function convert<K extends MeasurementKind>(
  value: number,
  fromUnit: string,
  toUnit: string,
  kind: K,
): number {
  return fromCanonical(toCanonical(value, fromUnit, kind), toUnit, kind)
}

/** A `StoredMeasurement` → its canonical SI value. Sugar over `toCanonical` for the row shape. */
export function storedToCanonical<K extends MeasurementKind>(m: StoredMeasurement<K>): number {
  return toCanonical(m.value, m.unit, m.kind)
}

// ── Bridging to units.ts's system-level display units ─────────────────────────────────────────────

/**
 * The named storage unit a `UnitSystem` displays a kind in — the bridge between this per-row model
 * and `units.ts`'s system-level model. Length-imperial maps to `'in'` (matching `units.ts`, which
 * keeps a single numeric field in inches; `formatMeasurement`'s `feetInches` is a display-only
 * concern). Lets a new row default its stored unit to whatever the user is currently viewing.
 *
 * @example systemUnit('length', 'imperial')  // 'in'
 * @example systemUnit('weight', 'metric')    // 'kg'
 */
const SYSTEM_UNIT: Record<MeasurementKind, Record<UnitSystem, string>> = {
  length: { imperial: 'in', metric: 'cm' },
  weight: { imperial: 'lb', metric: 'kg' },
  distance: { imperial: 'mi', metric: 'km' },
}

export function systemUnit<K extends MeasurementKind>(
  kind: K,
  system: UnitSystem,
): MeasurementUnit<K> {
  // The table only ever holds in-kind units; assert to narrow back to `MeasurementUnit<K>`.
  return assertUnitForKind(SYSTEM_UNIT[kind][system], kind)
}
