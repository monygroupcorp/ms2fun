import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, IPFS_GATEWAYS, isResolvableUri, resolveUri } from './uri'

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

  it('returns parsed JSON for a resolvable http URI that responds ok', async () => {
    const data = { name: 'test' }
    mockFetch.mockResolvedValueOnce(makeMockResponse(true, data))
    const result = await fetchJson('https://example.com/meta.json')
    expect(result).toEqual(data)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/meta.json', {
      signal: undefined,
    })
  })

  it('returns null for a non-resolvable URI without calling fetch', async () => {
    const result = await fetchJson('hello')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null for an empty string without calling fetch', async () => {
    const result = await fetchJson('')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null when http fetch returns !ok', async () => {
    mockFetch.mockResolvedValueOnce(makeMockResponse(false, null))
    const result = await fetchJson('https://example.com/meta.json')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  describe('ipfs:// gateway fallback', () => {
    it('succeeds on the first gateway if it returns ok', async () => {
      const data = { schema: 1 }
      mockFetch.mockResolvedValueOnce(makeMockResponse(true, data))
      const result = await fetchJson('ipfs://QmFoo')
      expect(result).toEqual(data)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(`${IPFS_GATEWAYS[0]}QmFoo`, { signal: undefined })
    })

    it('retries gateway 1 when gateway 0 fetch rejects, succeeds on gateway 1', async () => {
      const data = { schema: 1 }
      mockFetch
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(makeMockResponse(true, data))
      const result = await fetchJson('ipfs://QmFoo')
      expect(result).toEqual(data)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(1, `${IPFS_GATEWAYS[0]}QmFoo`, {
        signal: undefined,
      })
      expect(mockFetch).toHaveBeenNthCalledWith(2, `${IPFS_GATEWAYS[1]}QmFoo`, {
        signal: undefined,
      })
    })

    it('retries gateway 2 when gateways 0 and 1 return !ok, succeeds on gateway 2', async () => {
      const data = { schema: 1 }
      mockFetch
        .mockResolvedValueOnce(makeMockResponse(false, null))
        .mockResolvedValueOnce(makeMockResponse(false, null))
        .mockResolvedValueOnce(makeMockResponse(true, data))
      const result = await fetchJson('ipfs://QmFoo')
      expect(result).toEqual(data)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('returns null when all gateways fail', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('fail 0'))
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
      const result = await fetchJson('ipfs://QmFoo')
      expect(result).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(IPFS_GATEWAYS.length)
    })

    it('returns null when all gateways return !ok', async () => {
      mockFetch
        .mockResolvedValueOnce(makeMockResponse(false, null))
        .mockResolvedValueOnce(makeMockResponse(false, null))
        .mockResolvedValueOnce(makeMockResponse(false, null))
      const result = await fetchJson('ipfs://QmFoo')
      expect(result).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(IPFS_GATEWAYS.length)
    })
  })

  describe('AbortSignal handling', () => {
    it('rethrows the error when the AbortSignal is already aborted and fetch rejects', async () => {
      const controller = new AbortController()
      controller.abort()
      const abortError = new DOMException('Aborted', 'AbortError')
      mockFetch.mockRejectedValueOnce(abortError)
      await expect(fetchJson('ipfs://QmFoo', controller.signal)).rejects.toThrow('Aborted')
      // Should not have tried further gateways
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('passes the signal to fetch', async () => {
      const controller = new AbortController()
      const data = { ok: true }
      mockFetch.mockResolvedValueOnce(makeMockResponse(true, data))
      await fetchJson('https://example.com/meta.json', controller.signal)
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/meta.json', {
        signal: controller.signal,
      })
    })
  })
})
