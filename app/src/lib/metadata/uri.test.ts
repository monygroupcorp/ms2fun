import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  contentKey,
  fetchJson,
  gatewayUrl,
  getIpfsGateways,
  IPFS_GATEWAYS,
  isImmutableUri,
  isResolvableUri,
  isSubdomainSafeCid,
  resolveUri,
  resolveUriCandidates,
  type IpfsGateway,
} from './uri'

// A base32 CIDv1 is case-insensitive, so it survives a DNS label; a CIDv0 is base58btc and does not.
const CID_V1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const CID_V0 = 'QmFoo'

/** The URLs the public roster can actually serve a path from (subdomain entries drop CIDv0). */
const publicUrls = (path: string): string[] =>
  IPFS_GATEWAYS.map((g) => gatewayUrl(g, path)).filter((u): u is string => u !== null)

// ── the roster ────────────────────────────────────────────────────────────────

describe('IPFS_GATEWAYS roster', () => {
  it('spans at least two distinct operators', () => {
    const operators = new Set(IPFS_GATEWAYS.map((g) => g.operator))
    expect(operators.size).toBeGreaterThanOrEqual(2)
  })

  it('never lists the same operator twice (two hostnames, one failure domain)', () => {
    const operators = IPFS_GATEWAYS.map((g) => g.operator)
    expect(new Set(operators).size).toBe(operators.length)
  })

  it('declares an operator and a form for every entry', () => {
    for (const gateway of IPFS_GATEWAYS) {
      expect(gateway.operator.trim()).not.toBe('')
      expect(['path', 'subdomain']).toContain(gateway.form)
    }
  })

  it('serves every entry over https', () => {
    for (const gateway of IPFS_GATEWAYS) {
      const url = gatewayUrl(gateway, CID_V1)
      expect(url).not.toBeNull()
      expect(url).toMatch(/^https:\/\//)
    }
  })
})

// ── gatewayUrl / URL form ─────────────────────────────────────────────────────

describe('gatewayUrl', () => {
  const pathGw: IpfsGateway = { operator: 'test-path', form: 'path', base: 'https://gw.test/ipfs/' }
  const subGw: IpfsGateway = { operator: 'test-sub', form: 'subdomain', base: 'gw.test' }

  it('builds path form as https://<host>/ipfs/<cid>', () => {
    expect(gatewayUrl(pathGw, CID_V1)).toBe(`https://gw.test/ipfs/${CID_V1}`)
  })

  it('builds subdomain form as https://<cid>.ipfs.<host>/', () => {
    expect(gatewayUrl(subGw, CID_V1)).toBe(`https://${CID_V1}.ipfs.gw.test/`)
  })

  it('keeps the sub-path after the CID in both forms', () => {
    expect(gatewayUrl(pathGw, `${CID_V1}/a.png`)).toBe(`https://gw.test/ipfs/${CID_V1}/a.png`)
    expect(gatewayUrl(subGw, `${CID_V1}/a.png`)).toBe(`https://${CID_V1}.ipfs.gw.test/a.png`)
  })

  it('returns null rather than emitting a CIDv0 into subdomain form', () => {
    expect(gatewayUrl(subGw, CID_V0)).toBeNull()
    expect(gatewayUrl(subGw, `${CID_V0}/a.png`)).toBeNull()
  })

  it('still serves a CIDv0 over path form', () => {
    expect(gatewayUrl(pathGw, CID_V0)).toBe(`https://gw.test/ipfs/${CID_V0}`)
  })
})

describe('isSubdomainSafeCid', () => {
  it('accepts a base32 CIDv1', () => {
    expect(isSubdomainSafeCid(CID_V1)).toBe(true)
  })

  it('accepts a base36 CIDv1', () => {
    expect(isSubdomainSafeCid('k2jmtxx8tc9pv6b9sj3hyeuvxvwog1lppr8xfsyhagj9m0ni9pmxj0dg')).toBe(
      true,
    )
  })

  it('rejects a CIDv0 (case-sensitive base58btc)', () => {
    expect(isSubdomainSafeCid(CID_V0)).toBe(false)
    expect(isSubdomainSafeCid('QmXnnyufdzAWL5CqZ2RnSNgPbvCc1ALT73s6epPrRnZ1Xy')).toBe(false)
  })

  it('rejects an upper-cased base32 CID (a DNS label would fold it)', () => {
    expect(isSubdomainSafeCid(CID_V1.toUpperCase())).toBe(false)
  })
})

// ── resolveUriCandidates ──────────────────────────────────────────────────────

describe('resolveUriCandidates', () => {
  it('ipfs:// → every gateway that can address the CID, in order', () => {
    expect(resolveUriCandidates(`ipfs://${CID_V1}/a.png`)).toEqual(publicUrls(`${CID_V1}/a.png`))
  })

  it('strips the redundant ipfs/ prefix across all gateways', () => {
    expect(resolveUriCandidates(`ipfs://ipfs/${CID_V1}`)).toEqual(publicUrls(CID_V1))
  })

  it('never emits a CIDv0 in subdomain form', () => {
    const candidates = resolveUriCandidates(`ipfs://${CID_V0}/a.png`)
    expect(candidates.length).toBeGreaterThan(0)
    for (const url of candidates) {
      expect(url).toContain(`/ipfs/${CID_V0}/a.png`)
      expect(url).not.toContain(`${CID_V0.toLowerCase()}.ipfs.`)
    }
  })

  it('uses subdomain form for a CIDv1 wherever an operator supports it', () => {
    const subdomainOperators = IPFS_GATEWAYS.filter((g) => g.form === 'subdomain')
    const candidates = resolveUriCandidates(`ipfs://${CID_V1}`)
    for (const gateway of subdomainOperators) {
      expect(candidates).toContain(`https://${CID_V1}.ipfs.${gateway.base}/`)
    }
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
      expect(resolveUri(`ipfs://${CID_V0}`)).toBe(publicUrls(CID_V0)[0])
    })

    it('resolves ipfs://CID/path to gateway 0', () => {
      expect(resolveUri(`ipfs://${CID_V0}/metadata.json`)).toBe(
        publicUrls(`${CID_V0}/metadata.json`)[0],
      )
    })

    it('selects gateway 1 when gatewayIndex is 1', () => {
      expect(resolveUri(`ipfs://${CID_V0}`, 1)).toBe(publicUrls(CID_V0)[1])
    })

    it('wraps around via modulo when gatewayIndex >= the usable gateway count', () => {
      const urls = publicUrls(CID_V0)
      expect(resolveUri(`ipfs://${CID_V0}`, urls.length)).toBe(urls[0])
    })

    it('walks every usable gateway across increasing indices', () => {
      const urls = publicUrls(CID_V1)
      expect(urls.map((_, i) => resolveUri(`ipfs://${CID_V1}`, i))).toEqual(urls)
    })

    it('strips redundant ipfs/ prefix from ipfs://ipfs/CID', () => {
      expect(resolveUri(`ipfs://ipfs/${CID_V0}`)).toBe(publicUrls(CID_V0)[0])
    })

    it('strips redundant ipfs/ prefix with a sub-path', () => {
      expect(resolveUri(`ipfs://ipfs/${CID_V0}/file.json`)).toBe(
        publicUrls(`${CID_V0}/file.json`)[0],
      )
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
      expect(resolveUri(`  ipfs://${CID_V0}`)).toBe(publicUrls(CID_V0)[0])
    })

    it('trims trailing whitespace', () => {
      expect(resolveUri(`ipfs://${CID_V0}   `)).toBe(publicUrls(CID_V0)[0])
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
  it('returns the public roster when there is no custom gateway', () => {
    expect(getIpfsGateways(null)).toEqual([...IPFS_GATEWAYS])
  })

  it('prepends a normalized custom gateway (bare host)', () => {
    expect(getIpfsGateways('https://my.gw')[0]).toEqual({
      operator: 'custom',
      form: 'path',
      base: 'https://my.gw/ipfs/',
    })
    expect(getIpfsGateways('https://my.gw').slice(1)).toEqual([...IPFS_GATEWAYS])
  })

  it('normalizes a custom gateway that already ends in /ipfs', () => {
    expect(getIpfsGateways('https://my.gw/ipfs')[0]?.base).toBe('https://my.gw/ipfs/')
  })

  it('strips trailing slashes before normalizing', () => {
    expect(getIpfsGateways('https://my.gw/ipfs/')[0]?.base).toBe('https://my.gw/ipfs/')
  })

  it('keeps a custom gateway in path form (subdomain support cannot be assumed)', () => {
    expect(getIpfsGateways('https://my.gw')[0]?.form).toBe('path')
    expect(gatewayUrl(getIpfsGateways('https://my.gw')[0]!, CID_V0)).toBe(
      `https://my.gw/ipfs/${CID_V0}`,
    )
  })

  it('ignores a blank custom gateway', () => {
    expect(getIpfsGateways('   ')).toEqual([...IPFS_GATEWAYS])
  })
})

// ── fetchJson ─────────────────────────────────────────────────────────────────

type MockFetch = ReturnType<typeof vi.fn>

function makeMockResponse(ok: boolean, json: unknown, contentType = 'application/json'): Response {
  const body = JSON.stringify(json)
  return {
    ok,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? contentType
          : name.toLowerCase() === 'content-length'
            ? String(body.length)
            : null,
    },
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(body),
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
      // gateway 0 ok; the others get the default undefined mock and reject
      mockFetch.mockResolvedValueOnce(makeMockResponse(true, data))
      const result = await fetchJson(`ipfs://${CID_V1}`)
      expect(result).toEqual(data)
      expect(mockFetch).toHaveBeenCalledTimes(publicUrls(CID_V1).length)
    })

    it('still wins when an earlier gateway rejects', async () => {
      const data = { schema: 1 }
      mockFetch
        .mockRejectedValueOnce(new Error('gw0 down'))
        .mockResolvedValueOnce(makeMockResponse(true, data))
      const result = await fetchJson(`ipfs://${CID_V1}`)
      expect(result).toEqual(data)
      expect(mockFetch).toHaveBeenCalledTimes(publicUrls(CID_V1).length)
    })

    it('hits each gateway at its CID-resolved URL', async () => {
      mockFetch.mockResolvedValue(makeMockResponse(true, { ok: 1 }))
      await fetchJson(`ipfs://${CID_V1}/meta.json`)
      const calledUrls = mockFetch.mock.calls.map((c) => c[0])
      expect(calledUrls).toEqual(publicUrls(`${CID_V1}/meta.json`))
    })

    it('skips subdomain-only gateways for a CIDv0 pointer', async () => {
      mockFetch.mockResolvedValue(makeMockResponse(true, { ok: 1 }))
      await fetchJson(`ipfs://${CID_V0}`)
      const calledUrls = mockFetch.mock.calls.map((c) => c[0]) as string[]
      expect(calledUrls).toEqual(publicUrls(CID_V0))
      for (const url of calledUrls) expect(url).toContain(`/ipfs/${CID_V0}`)
    })

    it('returns null when all gateways reject', async () => {
      mockFetch.mockRejectedValue(new Error('all down'))
      expect(await fetchJson(`ipfs://${CID_V1}`)).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(publicUrls(CID_V1).length)
    })

    it('returns null when all gateways return !ok', async () => {
      mockFetch.mockResolvedValue(makeMockResponse(false, null))
      expect(await fetchJson(`ipfs://${CID_V1}`)).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(publicUrls(CID_V1).length)
    })
  })

  describe('AbortSignal handling', () => {
    it('throws and fires no requests when the signal is already aborted (ipfs)', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(fetchJson(`ipfs://${CID_V1}`, controller.signal)).rejects.toThrow()
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

// ── isImmutableUri / contentKey ───────────────────────────────────────────────

describe('isImmutableUri', () => {
  it('is true for content-addressed and inline pointers', () => {
    expect(isImmutableUri('ipfs://QmFoo')).toBe(true)
    expect(isImmutableUri('  ipfs://QmFoo/a.png  ')).toBe(true)
    expect(isImmutableUri('ar://tx1')).toBe(true)
    expect(isImmutableUri('data:application/json,{}')).toBe(true)
  })

  it('is false for http(s), which a server may re-point at different bytes', () => {
    expect(isImmutableUri('https://example.test/a.json')).toBe(false)
    expect(isImmutableUri('http://example.test/a.json')).toBe(false)
  })

  it('is false for pointers we cannot resolve at all', () => {
    expect(isImmutableUri('')).toBe(false)
    expect(isImmutableUri(undefined)).toBe(false)
    expect(isImmutableUri('QmFoo')).toBe(false)
  })
})

describe('contentKey', () => {
  it('collapses the two ipfs spellings of one CID onto one key', () => {
    expect(contentKey('ipfs://QmFoo/a.png')).toBe('ipfs://QmFoo/a.png')
    expect(contentKey('ipfs://ipfs/QmFoo/a.png')).toBe('ipfs://QmFoo/a.png')
    expect(contentKey('  ipfs://QmFoo  ')).toBe('ipfs://QmFoo')
  })

  it('passes other schemes through, trimmed', () => {
    expect(contentKey(' ar://tx1 ')).toBe('ar://tx1')
    expect(contentKey('https://example.test/a.png')).toBe('https://example.test/a.png')
  })
})

// ── hostile gateway responses ─────────────────────────────────────────────────

describe('fetchJson against a gateway that answers with a document', () => {
  let mockFetch: MockFetch

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects an HTML interstitial served for an ipfs:// CID and lets another gateway win', async () => {
    const data = { name: 'real' }
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith(IPFS_GATEWAYS[0])
          ? makeMockResponse(true, { title: 'Just a moment' }, 'text/html')
          : makeMockResponse(true, data),
      ),
    )
    await expect(fetchJson('ipfs://QmFoo')).resolves.toEqual(data)
  })

  it('returns null when every gateway answers with a document', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(true, { title: 'Just a moment' }, 'text/html'))
    expect(await fetchJson('ipfs://QmFoo')).toBeNull()
  })

  it('returns null for a document served on a single-URL (non-ipfs) pointer', async () => {
    mockFetch.mockResolvedValueOnce(makeMockResponse(true, { a: 1 }, 'text/html'))
    expect(await fetchJson('ar://tx1')).toBeNull()
  })
})
