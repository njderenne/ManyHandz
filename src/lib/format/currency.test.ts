import { describe, it, expect } from 'vitest'
import { formatCurrency, formatCents } from './currency'

describe('formatCurrency', () => {
  it('adds a $ sign, thousands commas, and exactly two decimals', () => {
    expect(formatCurrency(0)).toBe('$0.00')
    expect(formatCurrency(9.99)).toBe('$9.99')
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
    expect(formatCurrency(1000000)).toBe('$1,000,000.00')
  })

  it('formats negatives with the sign before the symbol', () => {
    expect(formatCurrency(-49.9)).toBe('-$49.90')
  })

  it('rounds to two decimals', () => {
    expect(formatCurrency(1.005)).toBe('$1.01')
    expect(formatCurrency(2.349)).toBe('$2.35')
  })
})

describe('formatCents', () => {
  it('treats the input as integer cents', () => {
    expect(formatCents(123456)).toBe('$1,234.56')
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(99)).toBe('$0.99')
  })

  it('accepts bigint cents and keeps full precision past MAX_SAFE_INTEGER', () => {
    expect(formatCents(123456n)).toBe('$1,234.56')
    // 2^53 = 9007199254740992 cents — one past Number.MAX_SAFE_INTEGER, exact only as bigint
    expect(formatCents(9007199254740993n)).toBe('$90,071,992,547,409.93')
  })

  it('formats negatives with the sign before the symbol', () => {
    expect(formatCents(-4990)).toBe('-$49.90')
    expect(formatCents(-5n)).toBe('-$0.05')
  })

  it('rounds fractional number input to the nearest cent', () => {
    expect(formatCents(99.6)).toBe('$1.00')
  })
})
