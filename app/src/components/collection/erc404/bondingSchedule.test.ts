/**
 * bondingSchedule — the bounds the bonding open/maturity pickers enforce must be exactly the ones
 * `setBondingOpenTime` / `setBondingMaturityTime` enforce (plus the send margin), measured from the
 * chain's clock, and every refusal must name a time to pick in the creator's zone, never an ISO
 * string or a chain timestamp.
 */
import { describe, expect, test } from 'vitest'
import {
  MAX_BONDING_DURATION_SEC,
  SEND_MARGIN_SEC,
  clockSkewNote,
  formatMoment,
  maturityQuickPicks,
  maturityWindow,
  openQuickPicks,
  openWindow,
  pickProblem,
  refusedSendCopy,
} from './bondingSchedule'
import storage from '../../../../../contracts/src/factories/erc404/ERC404BondingStorage.sol?raw'

const DAY = 86_400
const TZ = 'America/New_York'
// 2026-11-17 15:37:20 in New York (EST, UTC-5) — deliberately not on a minute boundary.
const WALL = Date.UTC(2026, 10, 17, 20, 37, 20) / 1000
const clock = { wallNow: WALL, timeZone: TZ }

describe('the contract bound it mirrors', () => {
  test('MAX_BONDING_DURATION matches the contract constant', () => {
    const m = /uint256 constant MAX_BONDING_DURATION = (\d+) days;/.exec(storage)
    expect(m).not.toBeNull()
    expect(MAX_BONDING_DURATION_SEC).toBe(Number(m![1]) * DAY)
  })
})

describe('openWindow', () => {
  test('with no maturity set: from chain time plus the send margin, rounded up to a minute; no end', () => {
    const w = openWindow(WALL, 0)
    expect(w.earliest).toBe(Math.ceil((WALL + SEND_MARGIN_SEC) / 60) * 60)
    expect(w.earliest % 60).toBe(0)
    expect(w.earliest).toBeGreaterThan(WALL) // TimeMustBeInFuture
    expect(w.latest).toBeNull()
    expect(w.blocked).toBeUndefined()
  })

  test('follows the CHAIN clock, not the wall clock, when the chain runs ahead', () => {
    const chainAhead = WALL + 2 * 3600
    expect(openWindow(chainAhead, 0).earliest).toBeGreaterThan(chainAhead)
  })

  test('with maturity set: stays before maturity and within the cap of it', () => {
    const maturity = WALL + 300 * DAY
    const w = openWindow(WALL, maturity)
    expect(w.latest).toBeLessThan(maturity) // MaturityMustBeAfterOpenTime, from the open side
    expect(maturity - w.earliest).toBeLessThanOrEqual(MAX_BONDING_DURATION_SEC) // MaturityTooFar
    expect(w.blocked).toBeUndefined()
  })

  test('blocked, with what to do first, when maturity is too soon for any open time', () => {
    const w = openWindow(WALL, WALL + 60)
    expect(w.blocked).toMatch(/move the maturity time later first/i)
  })
})

describe('maturityWindow', () => {
  test('blocked until an open time is set (OpenTimeMustBeSetFirst)', () => {
    expect(maturityWindow(WALL, 0).blocked).toBe('Set the open time first.')
  })

  test('after the open time, at most 210 days after it, and in the future', () => {
    const open = WALL + DAY
    const w = maturityWindow(WALL, open)
    expect(w.earliest).toBeGreaterThan(open)
    expect(w.latest).toBe(Math.floor((open + MAX_BONDING_DURATION_SEC) / 60) * 60)
    expect(w.latest! - open).toBeLessThanOrEqual(MAX_BONDING_DURATION_SEC)
  })

  test('when the open time has passed, the floor is chain time, not the open time', () => {
    const open = WALL - DAY
    expect(maturityWindow(WALL, open).earliest).toBeGreaterThan(WALL)
  })

  test('blocked when the 210-day span after an old open time is already over', () => {
    const w = maturityWindow(WALL, WALL - 211 * DAY)
    expect(w.blocked).toMatch(/within 210 days of the open time/)
  })
})

describe('pickProblem names the time to pick, in the creator’s zone', () => {
  test('too early → "Pick <local time> today or later."', () => {
    const w = openWindow(WALL, 0)
    // earliest = 15:42:20 + rounded up → 3:43 PM New York time
    expect(pickProblem(WALL, w, clock)).toBe('Pick 3:43 PM today or later.')
  })

  test('too late → "Pick <local date and time> or earlier."', () => {
    const open = WALL + DAY
    const w = maturityWindow(WALL, open)
    const msg = pickProblem(open + 300 * DAY, w, clock)
    expect(msg).toMatch(/^Pick .* or earlier\.$/)
    expect(msg).toContain('2027') // a date in another year carries its year
  })

  test('never an ISO or UTC string', () => {
    const w = openWindow(WALL, 0)
    expect(pickProblem(WALL, w, clock)).not.toMatch(/\d{4}-\d{2}-\d{2}T|Z\b|UTC/)
  })

  test('a valid pick has no problem; a blocked window always does', () => {
    const w = openWindow(WALL, 0)
    expect(pickProblem(w.earliest, w, clock)).toBeUndefined()
    expect(pickProblem(WALL + DAY, maturityWindow(WALL, 0), clock)).toBe('Set the open time first.')
  })
})

describe('formatMoment', () => {
  test('today / tomorrow / a weekday date, by the creator’s calendar', () => {
    expect(formatMoment(WALL, clock)).toBe('3:37 PM today')
    expect(formatMoment(WALL + DAY, clock)).toBe('3:37 PM tomorrow')
    expect(formatMoment(WALL + 4 * DAY, clock)).toBe('Sat, Nov 21 at 3:37 PM')
  })

  test('the same instant reads in whichever zone the creator is in', () => {
    expect(formatMoment(WALL, { wallNow: WALL, timeZone: 'Europe/Berlin' })).toBe('9:37 PM today')
  })
})

describe('quick picks', () => {
  test('open: 1 hour / 1 day / 1 week from chain time, all allowed with no maturity set', () => {
    const picks = openQuickPicks(WALL, openWindow(WALL, 0))
    expect(picks.map((p) => p.label)).toEqual(['in 1 hour', 'in 1 day', 'in 1 week'])
    expect(picks.every((p) => p.allowed)).toBe(true)
    expect(picks[0]!.at).toBeGreaterThanOrEqual(WALL + 3600)
  })

  test('open: a choice past an already-set maturity is offered but not allowed', () => {
    const maturity = WALL + 3 * DAY
    const picks = openQuickPicks(WALL, openWindow(WALL, maturity))
    expect(picks.find((p) => p.label === 'in 1 day')!.allowed).toBe(true)
    expect(picks.find((p) => p.label === 'in 1 week')!.allowed).toBe(false)
  })

  test('maturity: counted from the open time, the longest exactly at the cap', () => {
    const open = WALL + DAY
    const picks = maturityQuickPicks(open, maturityWindow(WALL, open))
    expect(picks.map((p) => p.label)).toContain('30 days after open')
    expect(picks.find((p) => p.label === '30 days after open')!.at).toBe(open + 30 * DAY - 20)
    const longest = picks.at(-1)!
    expect(longest.at - open).toBeLessThanOrEqual(MAX_BONDING_DURATION_SEC)
    expect(picks.every((p) => p.allowed)).toBe(true)
  })

  test('every choice fits one short line, so the buttons can share one cell size', () => {
    const open = WALL + DAY
    const picks = [
      ...openQuickPicks(WALL, openWindow(WALL, 0)),
      ...maturityQuickPicks(open, maturityWindow(WALL, open)),
    ]
    expect(picks.map((p) => p.short)).toEqual([
      '1 hour',
      '1 day',
      '1 week',
      '7 days',
      '30 days',
      '90 days',
      '210 days',
    ])
    expect(picks.every((p) => p.short.length <= 8 && !p.short.includes('('))).toBe(true)
  })

  test('maturity: none offered before an open time exists', () => {
    expect(maturityQuickPicks(0, maturityWindow(WALL, 0))).toEqual([])
  })
})

describe('clockSkewNote', () => {
  test('silent when the chain agrees with the creator’s clock', () => {
    expect(clockSkewNote({ chainNow: WALL + 30, wallNow: WALL, timeZone: TZ })).toBeUndefined()
  })

  test('says how far ahead, in the creator’s time, when the chain runs ahead', () => {
    const note = clockSkewNote({ chainNow: WALL + 2 * 3600, wallNow: WALL, timeZone: TZ })
    expect(note).toContain("network's clock reads 5:37 PM today")
    expect(note).toContain('2 hours ahead of your clock')
  })

  test('and when it runs behind', () => {
    expect(clockSkewNote({ chainNow: WALL - 600, wallNow: WALL, timeZone: TZ })).toContain(
      '10 minutes behind',
    )
  })
})

test('a refused send says what to do next', () => {
  expect(refusedSendCopy('open')).toMatch(/pick again/i)
  expect(refusedSendCopy('maturity')).toContain('maturity')
})
