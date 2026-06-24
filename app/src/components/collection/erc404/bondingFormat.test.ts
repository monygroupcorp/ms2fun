import { describe, expect, it } from 'vitest'
import { applyBuySlippage, applySellSlippage, formatBps, formatCountdown } from './bondingFormat'

describe('applyBuySlippage', () => {
  it('adds the tolerance and rounds up (cap never below cost)', () => {
    // 1000 * (10000 + 50) / 10000 = 1005
    expect(applyBuySlippage(1000n, 50)).toBe(1005n)
  })
  it('rounds the cap UP on a remainder', () => {
    // 333 * 10050 / 10000 = 334.665 → ceil 335
    expect(applyBuySlippage(333n, 50)).toBe(335n)
  })
  it('zero slippage is the identity', () => {
    expect(applyBuySlippage(1000n, 0)).toBe(1000n)
  })
  it('negative/NaN slippage clamps to zero', () => {
    expect(applyBuySlippage(1000n, -5)).toBe(1000n)
    expect(applyBuySlippage(1000n, Number.NaN)).toBe(1000n)
  })
})

describe('applySellSlippage', () => {
  it('subtracts the tolerance and rounds down (floor never above refund)', () => {
    // 1000 * (10000 - 50) / 10000 = 995
    expect(applySellSlippage(1000n, 50)).toBe(995n)
  })
  it('rounds the floor DOWN on a remainder', () => {
    // 333 * 9950 / 10000 = 331.3 → floor 331
    expect(applySellSlippage(333n, 50)).toBe(331n)
  })
  it('>=100% slippage floors to zero', () => {
    expect(applySellSlippage(1000n, 10_000)).toBe(0n)
    expect(applySellSlippage(1000n, 20_000)).toBe(0n)
  })
})

describe('formatBps', () => {
  it('whole percent', () => {
    expect(formatBps(1900n)).toBe('19%')
    expect(formatBps(0n)).toBe('0%')
    expect(formatBps(10_000n)).toBe('100%')
  })
  it('fractional percent, trimmed', () => {
    expect(formatBps(1950n)).toBe('19.5%')
    expect(formatBps(1955n)).toBe('19.55%')
    expect(formatBps(5n)).toBe('0.05%')
  })
})

describe('formatCountdown', () => {
  it('non-positive → now', () => {
    expect(formatCountdown(0)).toBe('now')
    expect(formatCountdown(-10)).toBe('now')
  })
  it('minutes and seconds only under an hour', () => {
    expect(formatCountdown(90)).toBe('1m 30s')
  })
  it('includes hours when present', () => {
    expect(formatCountdown(3_661)).toBe('1h 1m 1s')
  })
  it('includes days when present', () => {
    expect(formatCountdown(90_061)).toBe('1d 1h 1m 1s')
  })
})
