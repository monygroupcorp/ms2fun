import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  attemptTimeoutMs,
  classifyStatus,
  FAULT_BASE_MS,
  FAULT_STARVATION_THRESHOLD,
  gatewayKey,
  healthOf,
  isCooling,
  isRosterStarved,
  nextAvailableAt,
  noteFault,
  noteOutcome,
  noteRosterFault,
  noteRosterRecovered,
  noteSuccess,
  noteThrottled,
  orderGateways,
  parseRetryAfter,
  PROBATION_TIMEOUT_MS,
  resetGatewayHealth,
  THROTTLE_BASE_MS,
  THROTTLE_MAX_MS,
  throttleSnapshot,
  UNMEASURED_PRIOR_MS,
} from './gatewayHealth'
import type { IpfsGateway } from './uri'

const A: IpfsGateway = { operator: 'A', form: 'path', base: 'https://a.test/ipfs/' }
const B: IpfsGateway = { operator: 'B', form: 'path', base: 'https://b.test/ipfs/' }
const C: IpfsGateway = { operator: 'C', form: 'subdomain', base: 'c.test' }
const CUSTOM: IpfsGateway = { operator: 'custom', form: 'path', base: 'https://mine.test/ipfs/' }

const keyA = gatewayKey(A)
const keyB = gatewayKey(B)
const keyC = gatewayKey(C)

beforeEach(() => resetGatewayHealth())
afterEach(() => resetGatewayHealth())

describe('classifyStatus', () => {
  it('reads 2xx as success', () => {
    expect(classifyStatus(200)).toBe('ok')
    expect(classifyStatus(204)).toBe('ok')
  })

  it('reads 429 and 503 as a refusal to serve us', () => {
    expect(classifyStatus(429)).toBe('throttled')
    expect(classifyStatus(503)).toBe('throttled')
  })

  it('reads 404 and 410 as absent content, not a bad gateway', () => {
    expect(classifyStatus(404)).toBe('missing')
    expect(classifyStatus(410)).toBe('missing')
  })

  it('reads anything else as the gateway misbehaving', () => {
    expect(classifyStatus(500)).toBe('fault')
    expect(classifyStatus(403)).toBe('fault')
    expect(classifyStatus(0)).toBe('fault')
  })
})

describe('parseRetryAfter', () => {
  it('reads a delay in seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000)
  })

  it('reads an HTTP date as a delay from now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:02:00 GMT', now)).toBe(120_000)
  })

  it('never returns a negative delay for a date already past', () => {
    const now = Date.parse('2026-01-01T00:05:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now)).toBe(0)
  })

  it('returns null when the header is absent or unparseable', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
  })
})

describe('cooldowns', () => {
  it('honours Retry-After when the gateway supplies one', () => {
    const now = 1_000_000
    noteThrottled(keyA, 30_000, now)
    expect(healthOf(keyA).cooldownUntil).toBe(now + 30_000)
  })

  it('caps a Retry-After that would park a gateway beyond the ceiling', () => {
    const now = 1_000_000
    noteThrottled(keyA, 24 * 3600_000, now)
    expect(healthOf(keyA).cooldownUntil).toBe(now + THROTTLE_MAX_MS)
  })

  it('backs off exponentially when there is no Retry-After', () => {
    const now = 1_000_000
    noteThrottled(keyA, null, now)
    expect(healthOf(keyA).cooldownUntil).toBe(now + THROTTLE_BASE_MS)
    noteThrottled(keyA, null, now)
    expect(healthOf(keyA).cooldownUntil).toBe(now + THROTTLE_BASE_MS * 2)
    noteThrottled(keyA, null, now)
    expect(healthOf(keyA).cooldownUntil).toBe(now + THROTTLE_BASE_MS * 4)
  })

  it('never backs off past the ceiling', () => {
    const now = 1_000_000
    for (let i = 0; i < 20; i += 1) noteThrottled(keyA, null, now)
    expect(healthOf(keyA).cooldownUntil).toBe(now + THROTTLE_MAX_MS)
  })

  it('cools a network fault far more briefly than a refusal', () => {
    const now = 1_000_000
    noteFault(keyA, now)
    expect(healthOf(keyA).cooldownUntil).toBe(now + FAULT_BASE_MS)
    expect(FAULT_BASE_MS).toBeLessThan(THROTTLE_BASE_MS)
  })

  it('discharges the backoff on the next success', () => {
    const now = 1_000_000
    noteThrottled(keyA, null, now)
    noteThrottled(keyA, null, now)
    noteSuccess(keyA, now + 1)
    expect(healthOf(keyA)).toEqual({
      lastGoodAt: now + 1,
      failures: 0,
      cooldownUntil: 0,
      latencyMs: 0,
      silentFaults: 0,
    })
    expect(isCooling(keyA, now + 2)).toBe(false)
  })

  it('leaves a gateway untouched when the CONTENT is missing', () => {
    const now = 1_000_000
    noteSuccess(keyA, now)
    noteOutcome(keyA, 'missing', null, now + 1)
    expect(healthOf(keyA)).toEqual({
      lastGoodAt: now,
      failures: 0,
      cooldownUntil: 0,
      latencyMs: 0,
      silentFaults: 0,
    })
    expect(isCooling(keyA, now + 2)).toBe(false)
  })

  it('stops cooling once the window has passed', () => {
    const now = 1_000_000
    noteThrottled(keyA, 5_000, now)
    expect(isCooling(keyA, now + 4_999)).toBe(true)
    expect(isCooling(keyA, now + 5_001)).toBe(false)
  })
})

describe('orderGateways', () => {
  it('keeps roster order when nothing is known about any gateway', () => {
    expect(orderGateways([A, B, C])).toEqual([A, B, C])
  })

  it('orders by measured latency, so the fastest gateway a viewer can reach is tried first', () => {
    const now = 1_000_000
    noteSuccess(keyA, now, 5_000)
    noteSuccess(keyB, now, 20)
    noteSuccess(keyC, now, 800)
    expect(orderGateways([A, B, C], now + 1)).toEqual([B, C, A])
  })

  it('does NOT let a recent success jump the roster when nobody has timed it', () => {
    // Supersedes the old recency rule deliberately. The roster is itself ordered by a measurement
    // the latency harness re-runs and fails on, so an untimed gateway's POSITION is the better
    // evidence — "answered at some point" says nothing about how long it took.
    const now = 1_000_000
    noteSuccess(keyB, now)
    expect(orderGateways([A, B, C], now + 1)[0]).toEqual(A)
  })

  it('ranks a measured-fast gateway ahead of an untimed one, and an untimed one ahead of a dog', () => {
    const now = 1_000_000
    noteSuccess(keyC, now, 20)
    noteSuccess(keyA, now, 9_000)
    expect(orderGateways([A, B, C], now + 1)).toEqual([C, B, A])
  })

  it('drops a cooling gateway instead of demoting it', () => {
    const now = 1_000_000
    noteThrottled(keyA, null, now)
    expect(orderGateways([A, B, C], now + 1)).toEqual([B, C])
  })

  it('keeps a custom gateway first even while it is cooling — it is theirs, not a shared bucket', () => {
    const now = 1_000_000
    noteThrottled(gatewayKey(CUSTOM), null, now)
    noteSuccess(keyB, now)
    expect(orderGateways([CUSTOM, A, B, C], now + 1)[0]).toEqual(CUSTOM)
  })

  it('returns nothing when every public gateway is genuinely throttled — a real refusal closes every door', () => {
    const now = 1_000_000
    for (const key of [keyA, keyB, keyC]) noteThrottled(key, null, now)
    expect(orderGateways([A, B, C], now + 1)).toEqual([])
  })

  it('never parks the last living gateway when the roster is cooling from FAULTS: the soonest-to-clear entry survives', () => {
    const now = 1_000_000
    noteFault(keyA, now) // one fault: cooldownUntil = now + FAULT_BASE_MS
    noteFault(keyB, now)
    noteFault(keyB, now) // a second fault doubles B's backoff past A's — A clears first
    expect(orderGateways([A, B], now + 1)).toEqual([A])
  })

  it('keeps a custom gateway ahead of the fault survivor', () => {
    const now = 1_000_000
    noteFault(keyA, now)
    noteFault(keyB, now)
    expect(orderGateways([CUSTOM, A, B], now + 1)[0]).toEqual(CUSTOM)
  })

  it('does NOT keep a survivor when even one cooling entry is genuinely throttled, not merely faulted', () => {
    const now = 1_000_000
    noteThrottled(keyA, null, now)
    noteFault(keyB, now)
    noteFault(keyC, now)
    expect(orderGateways([A, B, C], now + 1)).toEqual([])
  })
})

describe('nextAvailableAt', () => {
  it('is 0 while at least one gateway can be asked', () => {
    const now = 1_000_000
    noteThrottled(keyA, null, now)
    expect(nextAvailableAt([A, B], now + 1)).toBe(0)
  })

  it('is the soonest cooldown deadline when all are cooling', () => {
    const now = 1_000_000
    noteThrottled(keyA, 60_000, now)
    noteThrottled(keyB, 10_000, now)
    expect(nextAvailableAt([A, B], now + 1)).toBe(now + 10_000)
  })
})

describe('throttleSnapshot', () => {
  it('reports not-cooling while a gateway is askable', () => {
    expect(throttleSnapshot([A, B])).toEqual({ cooling: false, retryAt: 0, reason: 'throttled' })
  })

  it('reports cooling with the earliest retry once everything is parked', () => {
    const now = Date.now()
    noteThrottled(keyA, 60_000, now)
    noteThrottled(keyB, 30_000, now)
    const snapshot = throttleSnapshot([A, B])
    expect(snapshot.cooling).toBe(true)
    expect(snapshot.retryAt).toBe(now + 30_000)
    expect(snapshot.reason).toBe('throttled')
  })

  it('returns the same object while nothing has changed (the store-subscription contract)', () => {
    const first = throttleSnapshot([A, B])
    expect(throttleSnapshot([A, B])).toBe(first)
  })

  it('reports starved once the roster has gone fault-only for the threshold, with no cooldown in force', () => {
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD; i += 1) noteRosterFault()
    const snapshot = throttleSnapshot([A, B])
    expect(snapshot.cooling).toBe(true)
    expect(snapshot.reason).toBe('starved')
  })

  it('does not report starved before the threshold is reached', () => {
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD - 1; i += 1) noteRosterFault()
    expect(throttleSnapshot([A, B])).toEqual({ cooling: false, retryAt: 0, reason: 'throttled' })
  })

  it('a real cooldown takes priority over a starved reading', () => {
    const now = Date.now()
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD; i += 1) noteRosterFault()
    noteThrottled(keyA, 60_000, now)
    noteThrottled(keyB, 30_000, now)
    const snapshot = throttleSnapshot([A, B], now + 1)
    expect(snapshot.reason).toBe('throttled')
  })

  it('clears on recovery', () => {
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD; i += 1) noteRosterFault()
    expect(isRosterStarved()).toBe(true)
    noteRosterRecovered()
    expect(isRosterStarved()).toBe(false)
    expect(throttleSnapshot([A, B])).toEqual({ cooling: false, retryAt: 0, reason: 'throttled' })
  })
})

describe('roster fault streak', () => {
  it('is not starved below the threshold', () => {
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD - 1; i += 1) noteRosterFault()
    expect(isRosterStarved()).toBe(false)
  })

  it('is starved at the threshold', () => {
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD; i += 1) noteRosterFault()
    expect(isRosterStarved()).toBe(true)
  })

  it('resets on recovery', () => {
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD; i += 1) noteRosterFault()
    noteRosterRecovered()
    expect(isRosterStarved()).toBe(false)
  })

  it('resetGatewayHealth clears the streak too', () => {
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD; i += 1) noteRosterFault()
    resetGatewayHealth()
    expect(isRosterStarved()).toBe(false)
  })
})

/**
 * Probation — what stops a retired gateway costing every load the full request budget.
 *
 * The case this exists for was measured on 2026-09-25: a roster entry that answered `410 Gone` for
 * a canonical object and, for real content, accepted the connection and then returned nothing on
 * every run past a 12 s timeout, in both addressing forms. Nothing in the health record could tell
 * that apart from a gateway that refuses quickly, so every later load handed it the whole budget
 * again.
 */
describe('probation', () => {
  const FULL = 12_000

  it('gives an untried gateway the full request budget', () => {
    expect(attemptTimeoutMs(keyA, FULL)).toBe(FULL)
  })

  it('a silent gateway is demoted before the timeout, so no later load spends the full budget', () => {
    noteFault(keyA, 1_000_000, 'silent')
    expect(attemptTimeoutMs(keyA, FULL)).toBe(PROBATION_TIMEOUT_MS)
    expect(PROBATION_TIMEOUT_MS).toBeLessThan(FULL)
  })

  it('leaves a gateway that refused QUICKLY on the full budget — it answered, it was just wrong', () => {
    noteFault(keyA, 1_000_000, 'error')
    expect(attemptTimeoutMs(keyA, FULL)).toBe(FULL)
  })

  it('does not put a gateway on probation for an explicit rate limit', () => {
    noteThrottled(keyA, null, 1_000_000)
    expect(attemptTimeoutMs(keyA, FULL)).toBe(FULL)
  })

  it('restores the full budget as soon as the gateway answers again', () => {
    noteFault(keyA, 1_000_000, 'silent')
    expect(attemptTimeoutMs(keyA, FULL)).toBe(PROBATION_TIMEOUT_MS)
    noteSuccess(keyA, 1_000_001, 30)
    expect(attemptTimeoutMs(keyA, FULL)).toBe(FULL)
  })

  it('never lengthens a budget that is already shorter than probation', () => {
    noteFault(keyA, 1_000_000, 'silent')
    expect(attemptTimeoutMs(keyA, 500)).toBe(500)
  })

  it('has no opinion about a candidate that is not a gateway', () => {
    expect(attemptTimeoutMs(null, FULL)).toBe(FULL)
  })
})

describe('latency recording', () => {
  it('records how long a success took, not merely that it succeeded', () => {
    noteSuccess(keyA, 1_000_000, 4_400)
    expect(healthOf(keyA).latencyMs).toBe(4_400)
  })

  it('smooths a later sample instead of letting one draw define the gateway', () => {
    noteSuccess(keyA, 1_000_000, 1_000)
    noteSuccess(keyA, 1_000_001, 2_000)
    const blended = healthOf(keyA).latencyMs
    expect(blended).toBeGreaterThan(1_000)
    expect(blended).toBeLessThan(2_000)
  })

  it('leaves the record alone when an outcome carries no timing', () => {
    noteSuccess(keyA, 1_000_000, 4_400)
    noteSuccess(keyA, 1_000_001)
    expect(healthOf(keyA).latencyMs).toBe(4_400)
  })

  it('places an untimed gateway by its roster position, which is itself a measurement', () => {
    // The roster is ordered by `pnpm ipfs:latency`, so position is evidence rather than a guess:
    // ahead of anything measurably slow, behind anything measurably fast.
    const now = 1_000_000
    noteSuccess(keyA, now, UNMEASURED_PRIOR_MS * 10)
    expect(orderGateways([A, B, C], now + 1)).toEqual([B, C, A])
  })
})
