import { beforeEach, describe, expect, it } from 'vitest'
import { gatewayHealthStore } from '../storage/keys'
import { installLocalStorageMock } from '../storage/testLocalStorage'
import {
  anyThrottled,
  classifyStatus,
  cooldownEndsAt,
  gatewayHealth,
  gatewayOfUrl,
  isCooling,
  noteGatewayFault,
  noteGatewaySuccess,
  parseRetryAfter,
  readyGateways,
  resetGatewayHealth,
} from './gatewayHealth'

const A = 'https://a.example/ipfs/'
const B = 'https://b.example/ipfs/'
const C = 'https://c.example/ipfs/'

beforeEach(() => {
  installLocalStorageMock()
  resetGatewayHealth()
})

describe('classifyStatus', () => {
  it('treats 429 and 503 as the gateway refusing us', () => {
    expect(classifyStatus(429)).toBe('throttled')
    expect(classifyStatus(503)).toBe('throttled')
  })

  it('treats 404 and 410 as the content being absent, not the gateway failing', () => {
    expect(classifyStatus(404)).toBe('missing')
    expect(classifyStatus(410)).toBe('missing')
  })

  it('treats any other non-2xx as a soft gateway fault', () => {
    expect(classifyStatus(500)).toBe('network')
    expect(classifyStatus(403)).toBe('network')
  })
})

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('120')).toBe(120_000)
  })

  it('reads an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:02:00 GMT', now)).toBe(120_000)
  })

  it('clamps a date already in the past to zero rather than going negative', () => {
    const now = Date.parse('2026-01-01T00:05:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now)).toBe(0)
  })

  it('returns null when absent or unparseable', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
  })

  it('caps an absurd window so the roster stays recoverable', () => {
    expect(parseRetryAfter('999999999')).toBe(60 * 60_000)
  })
})

describe('fault recording', () => {
  it('a missing CID changes nothing about the gateway', () => {
    noteGatewayFault(A, 'missing')
    expect(gatewayHealth(A).failures).toBe(0)
    expect(isCooling(A)).toBe(false)
  })

  it('a refusal cools the gateway and records why', () => {
    const now = Date.now()
    noteGatewayFault(A, 'throttled', null, now)
    expect(isCooling(A, now)).toBe(true)
    expect(gatewayHealth(A).reason).toBe('throttled')
    expect(gatewayHealth(A).cooldownUntil).toBe(now + 60_000)
  })

  it('backs off exponentially on consecutive refusals, capped', () => {
    const now = Date.now()
    noteGatewayFault(A, 'throttled', null, now)
    noteGatewayFault(A, 'throttled', null, now)
    expect(gatewayHealth(A).cooldownUntil).toBe(now + 120_000)
    for (let i = 0; i < 10; i += 1) noteGatewayFault(A, 'throttled', null, now)
    expect(gatewayHealth(A).cooldownUntil).toBe(now + 15 * 60_000)
  })

  it('an explicit Retry-After wins over the backoff schedule', () => {
    const now = Date.now()
    noteGatewayFault(A, 'throttled', 5_000, now)
    expect(gatewayHealth(A).cooldownUntil).toBe(now + 5_000)
  })

  it('a transport fault is a shorter, differently-labelled cooldown', () => {
    const now = Date.now()
    noteGatewayFault(A, 'network', null, now)
    expect(gatewayHealth(A).cooldownUntil).toBe(now + 5_000)
    expect(gatewayHealth(A).reason).toBe('network')
    expect(anyThrottled([A], now)).toBe(false)
  })

  it('a success clears the cooldown and stamps last-known-good', () => {
    const now = Date.now()
    noteGatewayFault(A, 'throttled', null, now)
    noteGatewaySuccess(A, now)
    expect(isCooling(A, now)).toBe(false)
    expect(gatewayHealth(A).lastGood).toBe(now)
    expect(gatewayHealth(A).failures).toBe(0)
  })
})

describe('ordering', () => {
  it('skips cooling gateways', () => {
    const now = Date.now()
    noteGatewayFault(B, 'throttled', null, now)
    expect(readyGateways([A, B, C], now)).toEqual([A, C])
  })

  it('puts the most recently good gateway first, roster order breaking ties', () => {
    const now = Date.now()
    noteGatewaySuccess(C, now)
    expect(readyGateways([A, B, C], now)).toEqual([C, A, B])
  })

  it('walks the roster as authored when nothing is known', () => {
    expect(readyGateways([A, B, C])).toEqual([A, B, C])
  })
})

describe('cooldownEndsAt', () => {
  it('is null while any gateway is askable', () => {
    const now = Date.now()
    noteGatewayFault(A, 'throttled', null, now)
    expect(cooldownEndsAt([A, B], now)).toBeNull()
  })

  it('is the earliest window end once every gateway is cooling', () => {
    const now = Date.now()
    noteGatewayFault(A, 'throttled', 300_000, now)
    noteGatewayFault(B, 'throttled', 30_000, now)
    expect(cooldownEndsAt([A, B], now)).toBe(now + 30_000)
  })
})

describe('persistence', () => {
  it('survives a reload — a throttle window outlives the page', () => {
    const now = Date.now()
    noteGatewayFault(A, 'throttled', 300_000, now)
    // A reload is a fresh module with the same localStorage: read the persisted surface directly.
    expect(gatewayHealthStore.get()[A]?.cooldownUntil).toBe(now + 300_000)
  })

  it('discards a corrupt entry without taking the rest of the record with it', () => {
    const now = Date.now()
    noteGatewayFault(A, 'throttled', 300_000, now)
    localStorage.setItem(
      'ms2fun:v1:gatewayHealth',
      JSON.stringify({ [A]: { nonsense: true }, [B]: gatewayHealthStore.get()[A] }),
    )
    const reloaded = gatewayHealthStore.get()
    expect(reloaded[A]).toBeUndefined()
    expect(reloaded[B]?.cooldownUntil).toBe(now + 300_000)
  })
})

describe('gatewayOfUrl', () => {
  it('attributes a URL to the gateway that served it', () => {
    expect(gatewayOfUrl(`${A}QmFoo/a.png`, [A, B])).toBe(A)
  })

  it('returns null for a URL from no known gateway', () => {
    expect(gatewayOfUrl('https://elsewhere.example/x.png', [A, B])).toBeNull()
  })
})
