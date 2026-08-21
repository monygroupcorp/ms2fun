import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { customGatewayStore } from '../storage/keys'
import { installLocalStorageMock } from '../storage/testLocalStorage'
import {
  gatewayHealth,
  noteGatewayFault,
  noteGatewaySuccess,
  resetGatewayHealth,
} from './gatewayHealth'
import {
  fetchJson,
  getIpfsGateways,
  IPFS_GATEWAYS,
  isResolvableUri,
  rankedUriCandidates,
  resolveUri,
  resolveUriCandidates,
} from './uri'

describe('resolveUriCandidates', () => {
  it('ipfs:// → every public gateway, in order', () => {
    expect(resolveUriCandidates('ipfs://QmFoo/a.png')).toEqual(
      IPFS_GATEWAYS.map((g) => `${g}QmFoo/a.png`),
    )
  })
  it('strips the redundant ipfs/ prefix across all gateways', () => {
    expect(resolveUriCandidates('ipfs://ipfs/QmBar')).toEqual(IPFS_GATEWAYS.map((g) => `${g}QmBar`))
  })
  it('non-ipfs resolves to a single URL', () => {
    expect(resolveUriCandidates('https://x.com/a.png')).toEqual(['https://x.com/a.png'])
    expect(resolveUriCandidates('ar://tx1')).toEqual(['https://arweave.net/tx1'])
  })
})

// ── resolveUri ────────────────────────────────────────────────────────────────

describe('resolveUri', () => {
  describe('ipfs:// URIs', () => {
    it('resolves ipfs://CID to gateway 0 by default', () => {
      expect(resolveUri('ipfs://QmFoo')).toBe(`${IPFS_GATEWAYS[0]}QmFoo`)
    })

    it('resolves ipfs://CID/path to gateway 0', () => {
      expect(resolveUri('ipfs://QmFoo/metadata.json')).toBe(
        `${IPFS_GATEWAYS[0]}QmFoo/metadata.json`,
      )
    })

    it('selects gateway 1 when gatewayIndex is 1', () => {
      expect(resolveUri('ipfs://QmFoo', 1)).toBe(`${IPFS_GATEWAYS[1]}QmFoo`)
    })

    it('selects gateway 2 when gatewayIndex is 2', () => {
      expect(resolveUri('ipfs://QmFoo', 2)).toBe(`${IPFS_GATEWAYS[2]}QmFoo`)
    })

    it('wraps around via modulo when gatewayIndex >= gateways length', () => {
      expect(resolveUri('ipfs://QmFoo', IPFS_GATEWAYS.length)).toBe(`${IPFS_GATEWAYS[0]}QmFoo`)
    })

    it('strips redundant ipfs/ prefix from ipfs://ipfs/CID', () => {
      expect(resolveUri('ipfs://ipfs/QmBar')).toBe(`${IPFS_GATEWAYS[0]}QmBar`)
    })

    it('strips redundant ipfs/ prefix with a sub-path', () => {
      expect(resolveUri('ipfs://ipfs/QmBar/file.json')).toBe(`${IPFS_GATEWAYS[0]}QmBar/file.json`)
    })
  })

  describe('ar:// URIs', () => {
    it('resolves ar://ID to arweave.net', () => {
      expect(resolveUri('ar://txId123')).toBe('https://arweave.net/txId123')
    })
  })

  describe('pass-through URIs', () => {
    it('passes https:// URIs through unchanged', () => {
      const url = 'https://example.com/meta.json'
      expect(resolveUri(url)).toBe(url)
    })

    it('passes http:// URIs through unchanged', () => {
      const url = 'http://example.com/meta.json'
      expect(resolveUri(url)).toBe(url)
    })

    it('passes data: URIs through unchanged', () => {
      const url = 'data:application/json;base64,e30='
      expect(resolveUri(url)).toBe(url)
    })
  })

  describe('whitespace trimming', () => {
    it('trims leading whitespace', () => {
      expect(resolveUri('  ipfs://QmFoo')).toBe(`${IPFS_GATEWAYS[0]}QmFoo`)
    })

    it('trims trailing whitespace', () => {
      expect(resolveUri('ipfs://QmFoo   ')).toBe(`${IPFS_GATEWAYS[0]}QmFoo`)
    })

    it('trims both leading and trailing whitespace from https URIs', () => {
      expect(resolveUri('  https://example.com  ')).toBe('https://example.com')
    })
  })
})

// ── isResolvableUri ───────────────────────────────────────────────────────────

describe('isResolvableUri', () => {
  it('returns true for ipfs:// URIs', () => {
    expect(isResolvableUri('ipfs://QmFoo')).toBe(true)
  })

  it('returns true for ar:// URIs', () => {
    expect(isResolvableUri('ar://txId')).toBe(true)
  })

  it('returns true for https:// URIs', () => {
    expect(isResolvableUri('https://example.com')).toBe(true)
  })

  it('returns true for http:// URIs', () => {
    expect(isResolvableUri('http://example.com')).toBe(true)
  })

  it('returns true for data: URIs', () => {
    expect(isResolvableUri('data:application/json,{}')).toBe(true)
  })

  it('returns false for undefined', () => {
    expect(isResolvableUri(undefined)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isResolvableUri(null)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isResolvableUri('')).toBe(false)
  })

  it('returns false for a bare non-scheme string', () => {
    expect(isResolvableUri('hello')).toBe(false)
  })

  it('returns false for a whitespace-only string', () => {
    expect(isResolvableUri('   ')).toBe(false)
  })
})

// ── getIpfsGateways ───────────────────────────────────────────────────────────

describe('getIpfsGateways', () => {
  it('returns the public gateways when there is no custom gateway', () => {
    expect(getIpfsGateways(null)).toEqual([...IPFS_GATEWAYS])
  })

  it('prepends a normalized custom gateway (bare host)', () => {
    expect(getIpfsGateways('https://my.gw')).toEqual(['https://my.gw/ipfs/', ...IPFS_GATEWAYS])
  })

  it('normalizes a custom gateway that already ends in /ipfs', () => {
    expect(getIpfsGateways('https://my.gw/ipfs')).toEqual(['https://my.gw/ipfs/', ...IPFS_GATEWAYS])
  })

  it('strips trailing slashes before normalizing', () => {
    expect(getIpfsGateways('https://my.gw/ipfs/')).toEqual([
      'https://my.gw/ipfs/',
      ...IPFS_GATEWAYS,
    ])
  })

  it('ignores a blank custom gateway', () => {
    expect(getIpfsGateways('   ')).toEqual([...IPFS_GATEWAYS])
  })
})

// ── fetchJson ─────────────────────────────────────────────────────────────────

type MockFetch = ReturnType<typeof vi.fn>

function makeMockResponse(
  ok: boolean,
  json: unknown,
  status = ok ? 200 : 500,
  headers: Record<string, string> = {},
): Response {
  return {
    ok,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(json),
  } as unknown as Response
}

const OK = (json: unknown) => makeMockResponse(true, json)
const STATUS = (status: number, headers: Record<string, string> = {}) =>
  makeMockResponse(false, null, status, headers)

/** Every URL fetch was called with, in call order. */
function calledUrls(mock: MockFetch): string[] {
  return mock.mock.calls.map((c) => String(c[0]))
}

describe('fetchJson', () => {
  let mockFetch: MockFetch

  beforeEach(() => {
    installLocalStorageMock()
    resetGatewayHealth()
    customGatewayStore.remove()
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetGatewayHealth()
    customGatewayStore.remove()
  })

  // Non-ipfs: a single resolve + fetch.
  it('returns the parsed JSON for a resolvable http URI that responds ok', async () => {
    const data = { name: 'test' }
    mockFetch.mockResolvedValueOnce(OK(data))
    expect(await fetchJson('https://example.com/meta.json')).toEqual({ status: 'found', data })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/meta.json', { signal: undefined })
  })

  it('returns not-found for a non-resolvable URI without calling fetch', async () => {
    expect(await fetchJson('hello')).toEqual({ status: 'not-found' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns not-found for an empty string without calling fetch', async () => {
    expect(await fetchJson('')).toEqual({ status: 'not-found' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns not-found when a non-ipfs fetch 404s', async () => {
    mockFetch.mockResolvedValueOnce(STATUS(404))
    expect(await fetchJson('https://example.com/meta.json')).toEqual({ status: 'not-found' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns offline when a non-ipfs fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('down'))
    expect(await fetchJson('https://example.com/meta.json')).toEqual({ status: 'offline' })
  })

  // ipfs: ONE gateway at a time, best-first. This is the quota behaviour the layer exists for.
  describe('ipfs:// sequential rotation', () => {
    it('spends ONE request when the first gateway answers', async () => {
      const data = { schema: 1 }
      mockFetch.mockResolvedValueOnce(OK(data))
      expect(await fetchJson('ipfs://QmFoo')).toEqual({ status: 'found', data })
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(calledUrls(mockFetch)).toEqual([`${IPFS_GATEWAYS[0]}QmFoo`])
    })

    it('N sequential fetches on a healthy list issue N requests, not N × gateways', async () => {
      mockFetch.mockResolvedValue(OK({ ok: 1 }))
      for (let i = 0; i < 8; i += 1) await fetchJson(`ipfs://QmFoo/${i}.json`)
      expect(mockFetch).toHaveBeenCalledTimes(8)
    })

    it('rotates to the next gateway only after the first one fails', async () => {
      const data = { schema: 1 }
      mockFetch.mockRejectedValueOnce(new Error('gw0 down')).mockResolvedValueOnce(OK(data))
      expect(await fetchJson('ipfs://QmFoo')).toEqual({ status: 'found', data })
      expect(calledUrls(mockFetch)).toEqual([
        `${IPFS_GATEWAYS[0]}QmFoo`,
        `${IPFS_GATEWAYS[1]}QmFoo`,
      ])
    })

    it('returns offline when every gateway fails at the transport', async () => {
      mockFetch.mockRejectedValue(new Error('all down'))
      expect(await fetchJson('ipfs://QmFoo')).toEqual({ status: 'offline' })
      expect(mockFetch).toHaveBeenCalledTimes(IPFS_GATEWAYS.length)
    })

    it('returns not-found when every gateway says the CID is absent', async () => {
      mockFetch.mockResolvedValue(STATUS(404))
      expect(await fetchJson('ipfs://QmFoo')).toEqual({ status: 'not-found' })
      expect(mockFetch).toHaveBeenCalledTimes(IPFS_GATEWAYS.length)
    })
  })

  describe('rate-limit awareness', () => {
    it('a 429 cools that gateway — the next item makes no request to it at all', async () => {
      mockFetch.mockResolvedValueOnce(STATUS(429)).mockResolvedValueOnce(OK({ a: 1 }))
      await fetchJson('ipfs://QmFoo')
      mockFetch.mockClear()

      mockFetch.mockResolvedValue(OK({ b: 2 }))
      await fetchJson('ipfs://QmBar')
      expect(calledUrls(mockFetch).some((u) => u.startsWith(IPFS_GATEWAYS[0]))).toBe(false)
    })

    it('honours Retry-After when the header is present', async () => {
      mockFetch
        .mockResolvedValueOnce(STATUS(429, { 'retry-after': '300' }))
        .mockResolvedValue(OK({ a: 1 }))
      const before = Date.now()
      await fetchJson('ipfs://QmFoo')
      const wait = gatewayHealth(IPFS_GATEWAYS[0]).cooldownUntil - before
      expect(wait).toBeGreaterThanOrEqual(299_000)
      expect(wait).toBeLessThanOrEqual(305_000)
    })

    it('falls back to backoff when Retry-After is absent', async () => {
      mockFetch.mockResolvedValueOnce(STATUS(429)).mockResolvedValue(OK({ a: 1 }))
      const before = Date.now()
      await fetchJson('ipfs://QmFoo')
      const wait = gatewayHealth(IPFS_GATEWAYS[0]).cooldownUntil - before
      expect(wait).toBeGreaterThanOrEqual(59_000)
      expect(wait).toBeLessThanOrEqual(65_000)
    })

    it('a 404 does NOT cool the gateway — the next item still tries it first', async () => {
      mockFetch.mockResolvedValue(STATUS(404))
      await fetchJson('ipfs://QmDead')
      mockFetch.mockClear()

      mockFetch.mockResolvedValue(OK({ a: 1 }))
      await fetchJson('ipfs://QmAlive')
      expect(calledUrls(mockFetch)).toEqual([`${IPFS_GATEWAYS[0]}QmAlive`])
    })

    it('returns throttled — and fires nothing — once every gateway is cooling', async () => {
      mockFetch.mockResolvedValue(STATUS(429))
      await fetchJson('ipfs://QmFoo')
      expect(mockFetch).toHaveBeenCalledTimes(IPFS_GATEWAYS.length)
      mockFetch.mockClear()

      const result = await fetchJson('ipfs://QmBar')
      expect(result.status).toBe('throttled')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('a 503 is treated as a refusal, not as missing content', async () => {
      mockFetch.mockResolvedValue(STATUS(503))
      expect((await fetchJson('ipfs://QmFoo')).status).toBe('throttled')
    })

    it('the gateway that answered is tried first next time', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('gw0 down'))
        .mockRejectedValueOnce(new Error('gw1 down'))
        .mockResolvedValueOnce(OK({ a: 1 }))
      await fetchJson('ipfs://QmFoo')
      mockFetch.mockClear()

      mockFetch.mockResolvedValue(OK({ b: 2 }))
      await fetchJson('ipfs://QmBar')
      expect(calledUrls(mockFetch)).toEqual([`${IPFS_GATEWAYS[2]}QmBar`])
    })
  })

  describe('custom gateway', () => {
    it('is attempted before the public set', async () => {
      customGatewayStore.set('https://my.gw')
      mockFetch.mockResolvedValueOnce(OK({ a: 1 }))
      await fetchJson('ipfs://QmFoo')
      expect(calledUrls(mockFetch)).toEqual(['https://my.gw/ipfs/QmFoo'])
    })

    it('keeps the head of the list even when a public gateway is more recently good', async () => {
      mockFetch.mockResolvedValueOnce(OK({ a: 1 }))
      await fetchJson('ipfs://QmFoo') // public gateway 0 becomes last-known-good
      customGatewayStore.set('https://my.gw')
      mockFetch.mockClear()

      mockFetch.mockResolvedValueOnce(OK({ b: 2 }))
      await fetchJson('ipfs://QmBar')
      expect(calledUrls(mockFetch)).toEqual(['https://my.gw/ipfs/QmBar'])
    })
  })

  describe('AbortSignal handling', () => {
    it('throws and fires no requests when the signal is already aborted (ipfs)', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(fetchJson('ipfs://QmFoo', controller.signal)).rejects.toThrow()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('passes the signal to fetch for a non-ipfs URI', async () => {
      const controller = new AbortController()
      mockFetch.mockResolvedValueOnce(OK({ ok: true }))
      await fetchJson('https://example.com/meta.json', controller.signal)
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/meta.json', {
        signal: controller.signal,
      })
    })

    it('a caller abort mid-walk rejects and is not recorded as a gateway fault', async () => {
      const controller = new AbortController()
      mockFetch.mockImplementation(() => {
        controller.abort()
        return Promise.reject(new DOMException('Aborted', 'AbortError'))
      })
      await expect(fetchJson('ipfs://QmFoo', controller.signal)).rejects.toThrow()
      expect(gatewayHealth(IPFS_GATEWAYS[0]).failures).toBe(0)
    })
  })
})

// ── rankedUriCandidates ───────────────────────────────────────────────────────

describe('rankedUriCandidates', () => {
  beforeEach(() => {
    installLocalStorageMock()
    resetGatewayHealth()
    customGatewayStore.remove()
  })

  it('returns the roster in order when nothing is known about any gateway', () => {
    expect(rankedUriCandidates('ipfs://QmFoo/a.png')).toEqual({
      urls: IPFS_GATEWAYS.map((g) => `${g}QmFoo/a.png`),
      readyAt: null,
    })
  })

  it('drops a cooling gateway from the candidates', () => {
    noteGatewayFault(IPFS_GATEWAYS[0], 'throttled')
    const { urls } = rankedUriCandidates('ipfs://QmFoo/a.png')
    expect(urls.some((u) => u.startsWith(IPFS_GATEWAYS[0]))).toBe(false)
    expect(urls).toHaveLength(IPFS_GATEWAYS.length - 1)
  })

  it('yields no candidates and a readyAt once every gateway is cooling', () => {
    for (const gateway of IPFS_GATEWAYS) noteGatewayFault(gateway, 'throttled')
    const ranked = rankedUriCandidates('ipfs://QmFoo/a.png')
    expect(ranked.urls).toEqual([])
    expect(ranked.readyAt).not.toBeNull()
  })

  it('puts the most recently good gateway first', () => {
    noteGatewaySuccess(IPFS_GATEWAYS[2])
    expect(rankedUriCandidates('ipfs://QmFoo')?.urls[0]).toBe(`${IPFS_GATEWAYS[2]}QmFoo`)
  })

  it('non-ipfs resolves to its single URL', () => {
    expect(rankedUriCandidates('https://x.com/a.png')).toEqual({
      urls: ['https://x.com/a.png'],
      readyAt: null,
    })
  })
})
