import { describe, expect, it } from 'vitest'
import {
  closesAt,
  isClosed,
  remainingForWallet,
  timeRemaining,
  type EditionSchedule,
} from './editionSchedule'

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0)
/** Unix seconds `n` milliseconds after NOW. */
const at = (ms: number): bigint => BigInt(Math.floor((NOW + ms) / 1000))
const sched = (closeTime: bigint, maxPerWallet = 0n): EditionSchedule => ({
  closeTime,
  maxPerWallet,
})

describe('closesAt', () => {
  it('is null for an edition that never closes', () => {
    expect(closesAt(sched(0n))).toBeNull()
  })

  it('is the close timestamp in milliseconds', () => {
    expect(closesAt(sched(1_700_000_000n))?.getTime()).toBe(1_700_000_000_000)
  })
})

describe('isClosed', () => {
  it('is false while the window is open', () => {
    expect(isClosed(sched(at(60_000)), NOW)).toBe(false)
  })

  // The contract reverts EditionClosed() AT the close time, so the surface must agree.
  it('is true exactly at the close time', () => {
    expect(isClosed(sched(at(0)), NOW)).toBe(true)
  })

  it('is true after it', () => {
    expect(isClosed(sched(at(-1000)), NOW)).toBe(true)
  })

  it('is false for an edition that never closes, however late', () => {
    expect(isClosed(sched(0n), NOW)).toBe(false)
  })
})

describe('timeRemaining', () => {
  it('is null when the edition never closes', () => {
    expect(timeRemaining(sched(0n), NOW)).toBeNull()
  })

  it('is null once the edition is over — that is a different sentence', () => {
    expect(timeRemaining(sched(at(-1)), NOW)).toBeNull()
    expect(timeRemaining(sched(at(0)), NOW)).toBeNull()
  })

  it('counts whole days down', () => {
    expect(timeRemaining(sched(at(3 * 86_400_000 + 5000)), NOW)).toBe('3 days left')
  })

  it('says one day in the singular', () => {
    expect(timeRemaining(sched(at(86_400_000 + 1000)), NOW)).toBe('1 day left')
  })

  it('falls to hours under a day', () => {
    expect(timeRemaining(sched(at(5 * 3_600_000)), NOW)).toBe('5 hours left')
    expect(timeRemaining(sched(at(3_600_000)), NOW)).toBe('1 hour left')
  })

  it('falls to minutes under an hour', () => {
    expect(timeRemaining(sched(at(12 * 60_000)), NOW)).toBe('12 minutes left')
    expect(timeRemaining(sched(at(60_000)), NOW)).toBe('1 minute left')
  })

  it('says under a minute rather than counting seconds', () => {
    expect(timeRemaining(sched(at(30_000)), NOW)).toBe('under a minute left')
    // One second is the smallest gap these timestamps can express — `at` is in unix seconds.
    expect(timeRemaining(sched(at(1000)), NOW)).toBe('under a minute left')
  })
})

describe('remainingForWallet', () => {
  it('is null when the edition sets no ceiling', () => {
    expect(remainingForWallet(sched(0n, 0n), 5n)).toBeNull()
  })

  it('is the whole ceiling for a wallet that has minted nothing', () => {
    expect(remainingForWallet(sched(0n, 3n), 0n)).toBe(3n)
  })

  it('treats an unread count as nothing minted', () => {
    expect(remainingForWallet(sched(0n, 3n), undefined)).toBe(3n)
  })

  it('subtracts what the wallet already took', () => {
    expect(remainingForWallet(sched(0n, 3n), 2n)).toBe(1n)
  })

  it('is zero at the ceiling', () => {
    expect(remainingForWallet(sched(0n, 3n), 3n)).toBe(0n)
  })

  // The ceiling can be lowered below what a wallet already minted; the answer is zero, not negative.
  it('clamps at zero when the wallet is over the ceiling', () => {
    expect(remainingForWallet(sched(0n, 2n), 5n)).toBe(0n)
  })
})
