import { describe, expect, it } from 'vitest'
import {
  formatPrice,
  formatSupplyCount,
  formatTokenAmount,
  formatTokenCount,
  truncateAddress,
} from './format'

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
  it('caps a large whole-number amount the same way (no unbounded fraction tail)', () => {
    // 12,000,000.667600000000000001 tokens — a large supply with a long fractional remainder.
    expect(formatTokenAmount(12_000_000_667600000000000001n, 18, 4)).toBe('12000000.6676')
  })

  it('bounds display width across dust, mid-curve, and large magnitudes', () => {
    // maxFrac caps the FRACTION only — the assertion is on frac-digit count, which is what makes
    // formatEther/formatGwei's raw output (e.g. "0.667600000000000001") overflow a fixed-width cell.
    const cases: bigint[] = [
      1n, // dust: 1 wei
      1234_500_000_000_000n, // sub-unit
      999_990_000_000_000_000n, // mid-curve, just under 1
      1234_567890123456789012n, // mid-curve, multi-digit whole part
      12_000_000_667600000000000001n, // large supply
    ]
    for (const v of cases) {
      const [, frac] = formatTokenAmount(v, 18, 4).split('.')
      expect((frac ?? '').length).toBeLessThanOrEqual(4)
    }
  })
})

describe('formatPrice', () => {
  const ETH_FLOOR = 10n ** 14n // ~1e-4 ETH: the gwei/ETH unit switchover

  it('renders a small bonding-curve price in gwei, just under the floor', () => {
    expect(formatPrice(ETH_FLOOR - 1n)).toBe('99999.9999 gwei')
  })
  it('renders the floor value itself in ETH', () => {
    expect(formatPrice(ETH_FLOOR)).toBe('0.0001 ETH')
  })
  it('renders a graduated market price in ETH, never as an eight-digit gwei figure', () => {
    // The Shrimpster overflow value: ~36273898.1304 gwei, unreadable as a price at that scale.
    expect(formatPrice(36_273_898_130_400_000n)).toBe('0.0362 ETH')
  })
  it('renders dust as gwei, not a near-zero ETH string', () => {
    expect(formatPrice(1n)).toBe('0 gwei')
  })
})

describe('formatTokenCount', () => {
  it('compacts a billion-scale supply the way the origin report expects', () => {
    expect(formatTokenCount(3_000_000_000n * 10n ** 18n)).toBe('3B')
    expect(formatTokenCount(50_000_000_000n * 10n ** 18n)).toBe('50B')
  })
  it('renders zero supply as a bare 0, not "0B"', () => {
    expect(formatTokenCount(0n)).toBe('0')
  })
  it('compacts a partial, sub-thousand supply without a suffix', () => {
    expect(formatTokenCount(42n * 10n ** 18n)).toBe('42')
  })
  it('compacts a thousands-scale supply with a K suffix', () => {
    expect(formatTokenCount(2500n * 10n ** 18n)).toBe('2.5K')
  })
})

describe('formatSupplyCount', () => {
  it('compact-formats an ERC404 (fungible-scaled) supply', () => {
    expect(formatSupplyCount(3_000_000_000n * 10n ** 18n, 'ERC404')).toBe('3B')
  })
  it('passes an ERC721 count through unscaled — it is already a plain NFT count', () => {
    expect(formatSupplyCount(9999n, 'ERC721')).toBe('9999')
  })
  it('passes an ERC1155 count through unscaled — it is already a plain edition count', () => {
    expect(formatSupplyCount(250n, 'ERC1155')).toBe('250')
  })
})
