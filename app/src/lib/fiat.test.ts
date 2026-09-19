import { describe, expect, it } from 'vitest'
import {
  MAX_RATE_AGE_SEC,
  describeRate,
  deriveEthUsdRate,
  ethUsdFeedFor,
  formatUsdFromWei,
  formatUsdMicros,
  usdMicrosFromWei,
  type EthUsdRound,
} from './fiat'

const ONE_ETH = 10n ** 18n
/** $4,200.00 at the 8 decimals every ETH/USD aggregator shipped to date reports. */
const RATE = { answer: 420_000_000_000n, decimals: 8 }

/** A round stamped `ageSec` behind the chain clock. */
function roundAged(ageSec: number, answer = RATE.answer): { round: EthUsdRound; now: bigint } {
  const now = 1_800_000_000n
  return { round: { answer, decimals: 8, updatedAt: now - BigInt(ageSec) }, now }
}

describe('ethUsdFeedFor', () => {
  it('names a feed on mainnet, the mainnet fork, and Sepolia', () => {
    expect(ethUsdFeedFor(1)).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(ethUsdFeedFor(1337)).toBe(ethUsdFeedFor(1))
    expect(ethUsdFeedFor(11155111)).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
  it('names none on a chain nobody has sourced a rate for', () => {
    expect(ethUsdFeedFor(8453)).toBeUndefined()
  })
})

describe('deriveEthUsdRate', () => {
  it('takes a fresh, positive round', () => {
    const { round, now } = roundAged(120)
    expect(deriveEthUsdRate(round, now)).toEqual({
      status: 'live',
      answer: RATE.answer,
      decimals: 8,
      ageSec: 120,
    })
  })

  it('refuses a round past the age ceiling rather than pricing off it', () => {
    const { round, now } = roundAged(MAX_RATE_AGE_SEC + 1)
    expect(deriveEthUsdRate(round, now)).toEqual({ status: 'unavailable', reason: 'stale' })
  })

  it('keeps a round exactly at the ceiling — one missed heartbeat is not a dead feed', () => {
    const { round, now } = roundAged(MAX_RATE_AGE_SEC)
    expect(deriveEthUsdRate(round, now).status).toBe('live')
  })

  it('refuses a round stamped far AHEAD of chain time', () => {
    const { round, now } = roundAged(-(MAX_RATE_AGE_SEC + 1))
    expect(deriveEthUsdRate(round, now)).toEqual({ status: 'unavailable', reason: 'stale' })
  })

  it('refuses a zero or negative answer', () => {
    const zero = roundAged(0, 0n)
    expect(deriveEthUsdRate(zero.round, zero.now)).toEqual({
      status: 'unavailable',
      reason: 'nonpositive',
    })
    const neg = roundAged(0, -1n)
    expect(deriveEthUsdRate(neg.round, neg.now)).toEqual({
      status: 'unavailable',
      reason: 'nonpositive',
    })
  })

  it('refuses when the round did not read', () => {
    expect(deriveEthUsdRate(undefined, 1_800_000_000n)).toEqual({
      status: 'unavailable',
      reason: 'unread',
    })
  })

  it('refuses when the chain clock did not read — an unjudgeable age is not a fresh one', () => {
    const { round } = roundAged(0)
    expect(deriveEthUsdRate(round, undefined)).toEqual({ status: 'unavailable', reason: 'unread' })
  })
})

describe('usdMicrosFromWei', () => {
  it('converts a whole ETH at the quoted rate', () => {
    expect(usdMicrosFromWei(ONE_ETH, RATE)).toBe(4_200_000_000n) // $4,200.000000
  })
  it('keeps a sub-cent mint price rather than collapsing it to zero', () => {
    // 1 gwei at $4,200 ≈ $0.0000042 → 4 micro-dollars, not 0.
    expect(usdMicrosFromWei(10n ** 9n, RATE)).toBe(4n)
  })
  it('scales by the feed-reported decimals, not an assumed 8', () => {
    expect(usdMicrosFromWei(ONE_ETH, { answer: 4_200n * 10n ** 18n, decimals: 18 })).toBe(
      4_200_000_000n,
    )
  })
  it('truncates toward zero — never rounds a quote up', () => {
    expect(usdMicrosFromWei(1n, RATE)).toBe(0n)
  })
})

describe('formatUsdMicros', () => {
  it('prints cents at the scale a drop is priced in', () => {
    expect(formatUsdMicros(540_000n)).toBe('$0.54')
    expect(formatUsdMicros(32_100_000n)).toBe('$32.10')
  })
  it('groups thousands and drops cents once they are noise', () => {
    expect(formatUsdMicros(9_999_990_000n)).toBe('$9,999.99')
    expect(formatUsdMicros(18_204_000_000n)).toBe('$18,204')
  })
  it('says "<$0.01" for a real amount under half a cent, never "$0.00"', () => {
    expect(formatUsdMicros(4n)).toBe('<$0.01')
    expect(formatUsdMicros(4_999n)).toBe('<$0.01')
  })
  it('prints a genuine zero as $0.00', () => {
    expect(formatUsdMicros(0n)).toBe('$0.00')
  })
  it('carries a sign through, for a refund leg quoted negative', () => {
    expect(formatUsdMicros(-540_000n)).toBe('-$0.54')
  })
})

describe('formatUsdFromWei', () => {
  it('is the composition the surfaces call', () => {
    expect(formatUsdFromWei(ONE_ETH / 100n, RATE)).toBe('$42.00')
  })
})

describe('describeRate', () => {
  it('names the source, the rate per ETH, and the round’s age', () => {
    const { round, now } = roundAged(245)
    const rate = deriveEthUsdRate(round, now)
    expect(rate.status).toBe('live')
    if (rate.status !== 'live') return
    expect(describeRate(rate)).toBe('Chainlink ETH/USD — $4,200.00 per ETH, updated 4 minutes ago')
  })
  it('reads a sub-minute round as such rather than as "0 minutes"', () => {
    const { round, now } = roundAged(12)
    const rate = deriveEthUsdRate(round, now)
    if (rate.status !== 'live') throw new Error('expected a live rate')
    expect(describeRate(rate)).toContain('updated less than a minute ago')
  })
})
