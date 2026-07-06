import { describe, it, expect } from 'vitest'
import { dollarsToCents, centsToDollars, roundCents, formatCents, formatCurrency } from './index'

describe('dollarsToCents', () => {
  it('converts dollars to integer cents, rounding to the nearest cent', () => {
    expect(dollarsToCents(9.99)).toBe(999)
    expect(dollarsToCents(0)).toBe(0)
    expect(dollarsToCents(1234.5)).toBe(123450)
    // Float artifact (19.99 * 100 === 1998.9999…) must still land on a whole cent.
    expect(dollarsToCents(19.99)).toBe(1999)
  })

  it('rounds half-up for positive sub-cent inputs', () => {
    expect(dollarsToCents(0.005)).toBe(1)
  })
})

describe('centsToDollars', () => {
  it('converts integer cents back to a dollar number', () => {
    expect(centsToDollars(999)).toBe(9.99)
    expect(centsToDollars(0)).toBe(0)
    expect(centsToDollars(123450)).toBe(1234.5)
  })
})

describe('roundCents', () => {
  it('rounds a fractional cents value to the nearest whole cent', () => {
    expect(roundCents(99.6)).toBe(100)
    expect(roundCents(99.4)).toBe(99)
    expect(roundCents(100)).toBe(100)
  })
})

describe('re-exported display helpers', () => {
  it('exposes formatCents and formatCurrency from the format layer', () => {
    expect(formatCents(123456)).toBe('$1,234.56')
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
  })
})
