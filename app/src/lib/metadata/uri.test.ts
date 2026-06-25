import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, getIpfsGateways, IPFS_GATEWAYS, isResolvableUri, resolveUri } from './uri'

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

function makeMockResponse(ok: boolean, json: unknown): Response {
  return {
    ok,
    json: () => Promise.resolve(json),
  } as unknown as Response
}

describe('fetchJson', () => {
  let mockFetch: MockFetch

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Non-ipfs: a single resolve + fetch.
  it('returns parsed JSON for a resolvable http URI that responds ok', async () => {
    const data = { name: 'test' }
    mockFetch.mockResolvedValueOnce(makeMockResponse(true, data))
    const result = await fetchJson('https://example.com/meta.json')
    expect(result).toEqual(data)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/meta.json', { signal: undefined })
  })

  it('returns null for a non-resolvable URI without calling fetch', async () => {
    expect(await fetchJson('hello')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null for an empty string without calling fetch', async () => {
    expect(await fetchJson('')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null when a non-ipfs fetch returns !ok', async () => {
    mockFetch.mockResolvedValueOnce(makeMockResponse(false, null))
    expect(await fetchJson('https://example.com/meta.json')).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // ipfs: race across all gateways, first healthy response wins.
  describe('ipfs:// gateway race', () => {
    it('fires all gateways in parallel and returns the first healthy response', async () => {
      const data = { schema: 1 }
      // gateway 0 ok; the other two get the default undefined mock and reject
      mockFetch.mockResolvedValueOnce(makeMockResponse(true, data))
      const result = await fetchJson('ipfs://QmFoo')
      expect(result).toEqual(data)
      expect(mockFetch).toHaveBeenCalledTimes(IPFS_GATEWAYS.length)
    })

    it('still wins when an earlier gateway rejects', async () => {
      const data = { schema: 1 }
      mockFetch
        .mockRejectedValueOnce(new Error('gw0 down'))
        .mockResolvedValueOnce(makeMockResponse(true, data))
      const result = await fetchJson('ipfs://QmFoo')
      expect(result).toEqual(data)
      expect(mockFetch).toHaveBeenCalledTimes(IPFS_GATEWAYS.length)
    })

    it('hits each gateway at its CID-resolved URL', async () => {
      mockFetch.mockResolvedValue(makeMockResponse(true, { ok: 1 }))
      await fetchJson('ipfs://QmFoo/meta.json')
      const calledUrls = mockFetch.mock.calls.map((c) => c[0])
      expect(calledUrls).toEqual(IPFS_GATEWAYS.map((g) => `${g}QmFoo/meta.json`))
    })

    it('returns null when all gateways reject', async () => {
      mockFetch.mockRejectedValue(new Error('all down'))
      expect(await fetchJson('ipfs://QmFoo')).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(IPFS_GATEWAYS.length)
    })

    it('returns null when all gateways return !ok', async () => {
      mockFetch.mockResolvedValue(makeMockResponse(false, null))
      expect(await fetchJson('ipfs://QmFoo')).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(IPFS_GATEWAYS.length)
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
      mockFetch.mockResolvedValueOnce(makeMockResponse(true, { ok: true }))
      await fetchJson('https://example.com/meta.json', controller.signal)
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/meta.json', {
        signal: controller.signal,
      })
    })
  })
})
