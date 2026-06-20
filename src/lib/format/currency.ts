/**
 * Currency formatting — the one place money becomes a string.
 *
 * Always renders a `$` sign, thousands separators, and exactly two decimal places
 * (e.g. `1234.5` → `$1,234.50`). Backed by `Intl.NumberFormat` so rounding and grouping
 * are locale-correct. Use this everywhere money is displayed — never hand-format currency.
 */
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Format a dollar amount as USD, e.g. `formatCurrency(1234.5)` → `"$1,234.50"`. */
export function formatCurrency(amount: number): string {
  return usdFormatter.format(amount)
}

/**
 * Format an integer number of cents as USD, e.g. `formatCents(123456)` → `"$1,234.56"`.
 *
 * bigint-native: amounts are split with integer quotient/remainder — no float division — so
 * values beyond `Number.MAX_SAFE_INTEGER` cents format exactly. Apps following the
 * "money is bigint cents" discipline pass their bigints straight through; `number` is accepted
 * for convenience and rounded to the nearest cent first.
 */
export function formatCents(cents: bigint | number): string {
  const total = typeof cents === 'bigint' ? cents : BigInt(Math.round(cents))
  const sign = total < 0n ? '-' : ''
  const abs = total < 0n ? -total : total
  // Group thousands by hand — Hermes's Intl is partial for BigInt, so no toLocaleString here.
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const rem = abs % 100n
  return `${sign}$${dollars}.${rem.toString().padStart(2, '0')}`
}
