/**
 * The money entrypoint — the single place to convert, round, and format money.
 *
 * **Discipline: money is integer cents.** Floating-point dollars drift (`0.1 + 0.2 !== 0.3`), so the
 * moment a dollar value crosses into the app it becomes integer cents and stays that way through all
 * arithmetic and storage. The format layer (`@/lib/format/currency`) treats cents as `bigint | number`
 * and is the one place cents become a display string.
 *
 * **The dollars ⇄ cents boundary.** Dollars are floats and appear ONLY at the edges — form inputs,
 * OCR/scan results, third-party amounts (e.g. Stripe). `dollarsToCents` is the inbound boundary;
 * `centsToDollars` the outbound one (a chart axis, an external API that wants a dollar number).
 * Everything in between is integer cents. Keep app-specific money math (splits, balances, rates) in
 * the app, not here — this module is the generic primitive layer only.
 *
 *   dollarsToCents(9.99)  // → 999
 *   centsToDollars(999)   // → 9.99
 *   roundCents(99.6)      // → 100
 *   formatCents(123456)   // → "$1,234.56"
 */

/** Parse a dollar amount (form input, OCR, external API) to integer cents. `dollarsToCents(9.99)` → `999`. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/** Integer cents to a dollar number (chart axis, external API). `centsToDollars(999)` → `9.99`. */
export function centsToDollars(cents: number): number {
  return cents / 100
}

/** Round a possibly-fractional cents value to the nearest whole cent (JS half-up for positives). */
export function roundCents(cents: number): number {
  return Math.round(cents)
}

// Re-export the display layer so this module is the single money entrypoint.
export { formatCents, formatCurrency } from '@/lib/format/currency'
