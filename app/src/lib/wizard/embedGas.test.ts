import { describe, expect, test } from 'vitest'
import { humanEth } from './embedGas'

describe('humanEth', () => {
  test('a cost of a thousandth of an ETH or more reads to three places', () => {
    expect(humanEth(14_000_000, 15)).toBe('~0.210 ETH')
    expect(humanEth(1_000_000, 1)).toBe('~0.001 ETH')
  })

  test('a cheap network still shows the figure, to two significant digits', () => {
    // 14M gas at 0.022 gwei, the kind of fee a quiet testnet charges.
    expect(humanEth(14_000_000, 0.022)).toBe('~0.00031 ETH')
    expect(humanEth(2_900_000, 0.001)).toBe('~0.0000029 ETH')
  })

  test('a cost just under a thousandth rounds up to ~0.001, not ~0.00100', () => {
    expect(humanEth(999_600, 1)).toBe('~0.001 ETH')
  })

  test('no fee reads as zero, not as a bound', () => {
    expect(humanEth(14_000_000, 0)).toBe('0 ETH')
  })
})
