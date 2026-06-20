import { describe, it, expect } from 'vitest'
import { referralCode, referralLink } from './referrals'

describe('referralCode', () => {
  it('is deterministic for the same seed', () => {
    expect(referralCode('user-123')).toBe(referralCode('user-123'))
  })
  it('is exactly 6 uppercase alphanumerics', () => {
    expect(referralCode('user-123')).toMatch(/^[0-9A-Z]{6}$/)
  })
  it('differs across seeds', () => {
    expect(referralCode('a')).not.toBe(referralCode('b'))
  })
})

describe('referralLink', () => {
  it('embeds the code', () => {
    expect(referralLink('ABC123')).toContain('ABC123')
  })
})
