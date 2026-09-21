import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DURATION_UNIT,
  durationFromSeconds,
  epochFromLocalInput,
  localInputFromEpoch,
  secondsFromDuration,
} from './scheduleInput'

/** Unix seconds for a local wall-clock moment, computed the way the browser would. */
function localEpoch(y: number, mo: number, d: number, h: number, mi: number): number {
  return Math.floor(new Date(y, mo - 1, d, h, mi, 0, 0).getTime() / 1000)
}

describe('epochFromLocalInput', () => {
  it('reads a picker value as LOCAL wall clock, not UTC', () => {
    expect(epochFromLocalInput('2026-09-22T18:30')).toBe(localEpoch(2026, 9, 22, 18, 30))
  })

  it('accepts the seconds-bearing form some browsers emit', () => {
    expect(epochFromLocalInput('2026-09-22T18:30:45')).toBe(
      Math.floor(new Date(2026, 8, 22, 18, 30, 45).getTime() / 1000),
    )
  })

  it('is null for a blank field — that is "no time set", not an error', () => {
    expect(epochFromLocalInput('')).toBeNull()
    expect(epochFromLocalInput('   ')).toBeNull()
  })

  it('refuses a date with no time rather than silently meaning UTC midnight', () => {
    // `Date.parse` reads a date-only string as UTC and a date-and-time string as local, so accepting
    // this would put the close time up to a day out for a creator west of Greenwich.
    expect(epochFromLocalInput('2026-09-22')).toBeNull()
  })

  it('is null for anything that is not the picker shape', () => {
    expect(epochFromLocalInput('1790000000')).toBeNull()
    expect(epochFromLocalInput('next tuesday')).toBeNull()
    expect(epochFromLocalInput('2026-09-22T18:30Z')).toBeNull()
  })
})

describe('localInputFromEpoch', () => {
  it('round-trips a moment through the picker shape', () => {
    const secs = localEpoch(2026, 12, 1, 9, 5)
    expect(localInputFromEpoch(secs)).toBe('2026-12-01T09:05')
    expect(epochFromLocalInput(localInputFromEpoch(secs))).toBe(secs)
  })

  it('renders 0 as an empty picker — 0 is "no time set" on chain, never 1970', () => {
    expect(localInputFromEpoch(0)).toBe('')
    expect(localInputFromEpoch(0n)).toBe('')
  })

  it('takes the bigint the contracts return', () => {
    const secs = localEpoch(2027, 1, 31, 23, 59)
    expect(localInputFromEpoch(BigInt(secs))).toBe('2027-01-31T23:59')
  })
})

describe('secondsFromDuration', () => {
  it('scales each span', () => {
    expect(secondsFromDuration('90', 'seconds')).toBe(90)
    expect(secondsFromDuration('15', 'minutes')).toBe(900)
    expect(secondsFromDuration('24', 'hours')).toBe(86_400)
    expect(secondsFromDuration('7', 'days')).toBe(604_800)
  })

  it('is null for a blank amount', () => {
    expect(secondsFromDuration('', 'hours')).toBeNull()
  })

  it('refuses a fraction rather than truncating a creator into a shorter window', () => {
    expect(secondsFromDuration('1.5', 'days')).toBeNull()
    expect(secondsFromDuration('-1', 'hours')).toBeNull()
    expect(secondsFromDuration('lots', 'hours')).toBeNull()
  })

  it('allows 0 — a caller that treats 0 as "unset" decides that, not this', () => {
    expect(secondsFromDuration('0', 'hours')).toBe(0)
  })
})

describe('durationFromSeconds', () => {
  it('opens the control in the coarsest span that divides exactly', () => {
    expect(durationFromSeconds(86_400)).toEqual({ amount: '1', unit: 'days' })
    expect(durationFromSeconds(7_200)).toEqual({ amount: '2', unit: 'hours' })
    expect(durationFromSeconds(900)).toEqual({ amount: '15', unit: 'minutes' })
    expect(durationFromSeconds(90)).toEqual({ amount: '90', unit: 'seconds' })
  })

  it('round-trips through secondsFromDuration', () => {
    for (const secs of [1, 59, 60, 3_600, 5_400, 86_400, 604_800]) {
      const { amount, unit } = durationFromSeconds(secs)
      expect(secondsFromDuration(amount, unit)).toBe(secs)
    }
  })

  it('is the empty state for zero and below', () => {
    expect(durationFromSeconds(0)).toEqual({ amount: '', unit: DEFAULT_DURATION_UNIT })
    expect(durationFromSeconds(-5)).toEqual({ amount: '', unit: DEFAULT_DURATION_UNIT })
    expect(durationFromSeconds(0n)).toEqual({ amount: '', unit: DEFAULT_DURATION_UNIT })
  })
})
