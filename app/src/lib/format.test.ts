import { describe, expect, it } from 'vitest'
import { formatTokenAmount, truncateAddress } from './format'

describe('truncateAddress', () => {
  it('shortens to head…tail', () => {
    expect(truncateAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678')
  })
})

describe('formatTokenAmount', () => {
  const one = 10n ** 18n

  it('caps the fraction and trims trailing zeros', () => {
    // 1234.567890123456789012 → 4 frac digits, truncated (not rounded)
    expect(formatTokenAmount(1234_567890123456789012n, 18, 4)).toBe('1234.5678')
  })
  it('trims all-zero fraction to a bare integer', () => {
    expect(formatTokenAmount(5n * one, 18, 4)).toBe('5')
  })
  it('keeps only the significant fraction digits', () => {
    expect(formatTokenAmount(one + one / 2n, 18, 4)).toBe('1.5')
  })
  it('truncates toward zero rather than rounding up', () => {
    // 0.99999 (5 nines) with maxFrac=4 → 0.9999, never 1.0
    expect(formatTokenAmount(999_990_000_000_000_000n, 18, 4)).toBe('0.9999')
  })
  it('handles sub-unit values', () => {
    expect(formatTokenAmount(1234_500_000_000_000n, 18, 4)).toBe('0.0012')
  })
  it('renders zero as "0"', () => {
    expect(formatTokenAmount(0n, 18, 4)).toBe('0')
  })
  it('supports non-18 decimals', () => {
    expect(formatTokenAmount(12_345_678n, 6, 4)).toBe('12.3456')
  })
  it('negatives keep the sign', () => {
    expect(formatTokenAmount(-(one + one / 4n), 18, 4)).toBe('-1.25')
  })
})
