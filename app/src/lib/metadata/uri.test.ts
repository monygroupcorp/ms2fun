import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  contentKey,
  fetchJson,
  jsonOrNull,
  resolveCandidates,
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
import { gatewayKey, noteThrottled, resetGatewayHealth } from './gatewayHealth'
import { customGatewayStore } from '../storage/keys'

// A base32 CIDv1 is case-insensitive, so it survives a DNS label; a CIDv0 is base58btc and does not.
const CID_V1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const CID_V0 = 'QmFoo'

/**
 * Vitest 4's jsdom environment exposes a Node-native `localStorage` that is not actually available,
 * so every persisted read/write silently no-ops. The same Map-backed stub `storage.test.ts` installs
 * is used here, since the gateway roster and the health map are both persisted surfaces.
 */
function makeLocalStorageMock(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

/** True when `url` is served by the FIRST roster entry, whatever sub-path is being asked for. */
const isFirstGateway = (url: string): boolean =>
  url.startsWith(String((IPFS_GATEWAYS[0] as IpfsGateway).base))

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

function makeMockResponse(
  ok: boolean,
  json: unknown,
  contentType = 'application/json',
  status = ok ? 200 : 500,
  extraHeaders: Record<string, string> = {},
): Response {
  const body = JSON.stringify(json)
  const headers: Record<string, string> = {
    'content-type': contentType,
    'content-length': String(body.length),
    ...extraHeaders,
  }
  return {
    ok,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(body),
  } as unknown as Response
}

/** A gateway response that means "you are asking too often". */
const throttledResponse = (retryAfter?: string): Response =>
  makeMockResponse(
    false,
    { error: 'rate limited' },
    'application/json',
    429,
    retryAfter === undefined ? {} : { 'retry-after': retryAfter },
  )

/** A gateway response that means "this CID is not here" — the gateway itself is healthy. */
const missingResponse = (): Response =>
  makeMockResponse(false, { error: 'not found' }, 'application/json', 404)

describe('fetchJson', () => {
  let mockFetch: MockFetch

  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageMock())
    resetGatewayHealth()
    customGatewayStore.remove()
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    resetGatewayHealth()
    customGatewayStore.remove()
    vi.unstubAllGlobals()
  })

  // Non-ipfs: a single resolve + fetch.
  it('returns the parsed document for a resolvable http URI that responds ok', async () => {
    const data = { name: 'test' }
    mockFetch.mockResolvedValueOnce(makeMockResponse(true, data))
    const result = await fetchJson('https://example.com/meta.json')
    expect(result).toEqual({ status: 'found', data })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/meta.json', { signal: undefined })
  })

  it('reports not-found for a non-resolvable URI without calling fetch', async () => {
    expect(await fetchJson('hello')).toEqual({ status: 'not-found' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reports not-found for an empty string without calling fetch', async () => {
    expect(await fetchJson('')).toEqual({ status: 'not-found' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reports offline when a non-ipfs fetch returns a server error', async () => {
    mockFetch.mockResolvedValueOnce(makeMockResponse(false, null))
    expect(await fetchJson('https://example.com/meta.json')).toEqual({ status: 'offline' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('reports not-found when a non-ipfs fetch 404s — the host answered, the content is gone', async () => {
    mockFetch.mockResolvedValueOnce(missingResponse())
    expect(await fetchJson('https://example.com/meta.json')).toEqual({ status: 'not-found' })
  })

  it('reports throttled when a non-ipfs fetch is rate limited', async () => {
    mockFetch.mockResolvedValueOnce(throttledResponse())
    const result = await fetchJson('https://example.com/meta.json')
    expect(result.status).toBe('throttled')
  })

  it('jsonOrNull collapses every non-success back to null for callers that only need the document', async () => {
    mockFetch.mockResolvedValueOnce(missingResponse())
    expect(jsonOrNull(await fetchJson('https://example.com/meta.json'))).toBeNull()
    mockFetch.mockResolvedValueOnce(makeMockResponse(true, { a: 1 }))
    expect(jsonOrNull(await fetchJson('https://example.com/meta.json'))).toEqual({ a: 1 })
  })

  // ipfs: sequential rotation over a health-ordered list.
  describe('ipfs:// sequential rotation', () => {
    it('spends ONE request when the first gateway answers', async () => {
      const data = { schema: 1 }
      mockFetch.mockResolvedValue(makeMockResponse(true, data))
      expect(await fetchJson(`ipfs://${CID_V1}`)).toEqual({ status: 'found', data })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('N metadata fetches on a healthy roster cost N requests, not N x roster', async () => {
      // The whole point of the item: public gateways meter per client IP, so a parallel race
      // multiplies the viewer's own spend by the roster length on every single item.
      mockFetch.mockResolvedValue(makeMockResponse(true, { schema: 1 }))
      const items = 8
      for (let i = 0; i < items; i += 1) {
        await fetchJson(`ipfs://${CID_V1}/${i}.json`)
      }
      expect(mockFetch).toHaveBeenCalledTimes(items)
      expect(publicUrls(CID_V1).length).toBeGreaterThan(1) // the race would have cost more
    })

    it('rotates to the next gateway only when one fails', async () => {
      const data = { schema: 1 }
      mockFetch
        .mockRejectedValueOnce(new Error('gw0 down'))
        .mockResolvedValueOnce(makeMockResponse(true, data))
      expect(await fetchJson(`ipfs://${CID_V1}`)).toEqual({ status: 'found', data })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('hits the first gateway at its CID-resolved URL', async () => {
      mockFetch.mockResolvedValue(makeMockResponse(true, { ok: 1 }))
      await fetchJson(`ipfs://${CID_V1}/meta.json`)
      expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([publicUrls(`${CID_V1}/meta.json`)[0]])
    })

    it('never emits a CIDv0 to a subdomain-only gateway while rotating', async () => {
      mockFetch.mockResolvedValue(makeMockResponse(false, null))
      await fetchJson(`ipfs://${CID_V0}`)
      const calledUrls = mockFetch.mock.calls.map((c) => c[0]) as string[]
      expect(calledUrls).toEqual(publicUrls(CID_V0))
      for (const url of calledUrls) expect(url).toContain(`/ipfs/${CID_V0}`)
    })

    it('walks every gateway before giving up, and reports offline when none answered', async () => {
      mockFetch.mockRejectedValue(new Error('all down'))
      expect(await fetchJson(`ipfs://${CID_V1}`)).toEqual({ status: 'offline' })
      expect(mockFetch).toHaveBeenCalledTimes(publicUrls(CID_V1).length)
    })

    it('reports not-found when a gateway says the CID is not there', async () => {
      mockFetch.mockResolvedValue(missingResponse())
      expect(await fetchJson(`ipfs://${CID_V1}`)).toEqual({ status: 'not-found' })
    })
  })

  // ── quota-aware rotation: what a refusal costs the NEXT item ────────────────
  describe('rate-limit awareness', () => {
    it('cools a gateway that returns 429 and does not ask it again on the next item', async () => {
      mockFetch.mockImplementation((url: string) =>
        Promise.resolve(
          isFirstGateway(url) ? throttledResponse() : makeMockResponse(true, { a: 1 }),
        ),
      )

      await fetchJson(`ipfs://${CID_V1}/one.json`)
      mockFetch.mockClear()
      await fetchJson(`ipfs://${CID_V1}/two.json`)

      const urls = mockFetch.mock.calls.map((c) => c[0]) as string[]
      expect(urls).not.toContain(publicUrls(`${CID_V1}/two.json`)[0])
      expect(urls).toHaveLength(1)
    })

    it('treats a 503 as a refusal too — the CDN shape of the same signal', async () => {
      mockFetch.mockImplementation((url: string) =>
        Promise.resolve(
          isFirstGateway(url)
            ? makeMockResponse(false, null, 'application/json', 503)
            : makeMockResponse(true, { a: 1 }),
        ),
      )
      await fetchJson(`ipfs://${CID_V1}/one.json`)
      mockFetch.mockClear()
      await fetchJson(`ipfs://${CID_V1}/two.json`)
      expect(mockFetch.mock.calls.map((c) => c[0])).not.toContain(
        publicUrls(`${CID_V1}/two.json`)[0],
      )
    })

    it('does NOT cool a gateway for a 404 — a dead CID must not cost every other item', async () => {
      mockFetch.mockResolvedValue(missingResponse())
      await fetchJson(`ipfs://${CID_V1}/gone.json`)
      mockFetch.mockClear()
      mockFetch.mockResolvedValue(makeMockResponse(true, { a: 1 }))

      await fetchJson(`ipfs://${CID_V1}/here.json`)
      expect(mockFetch.mock.calls[0]?.[0]).toBe(publicUrls(`${CID_V1}/here.json`)[0])
    })

    it('reports throttled — never not-found — when every gateway is cooling, and fires nothing', async () => {
      for (const gateway of IPFS_GATEWAYS) noteThrottled(gatewayKey(gateway))
      const result = await fetchJson(`ipfs://${CID_V1}`)
      expect(result.status).toBe('throttled')
      expect(result.status === 'throttled' && result.retryAt).toBeGreaterThan(Date.now())
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('starts the next item at the gateway that last worked', async () => {
      const urls = publicUrls(CID_V1)
      expect(urls.length).toBeGreaterThan(1)
      const second = urls[1] as string
      mockFetch.mockImplementation((url: string) =>
        Promise.resolve(url === second ? makeMockResponse(true, { a: 1 }) : throttledResponse()),
      )
      await fetchJson(`ipfs://${CID_V1}`)
      mockFetch.mockClear()

      mockFetch.mockResolvedValue(makeMockResponse(true, { a: 1 }))
      await fetchJson(`ipfs://${CID_V1}/next.json`)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0]?.[0]).toBe(publicUrls(`${CID_V1}/next.json`)[1])
    })

    it('always tries a custom gateway first, ahead of the whole public set', async () => {
      customGatewayStore.set('https://my.gw')
      mockFetch.mockResolvedValue(makeMockResponse(true, { a: 1 }))
      await fetchJson(`ipfs://${CID_V1}`)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0]?.[0]).toBe(`https://my.gw/ipfs/${CID_V1}`)
    })

    it('keeps trying a custom gateway even while every public gateway is cooling', async () => {
      for (const gateway of IPFS_GATEWAYS) noteThrottled(gatewayKey(gateway))
      customGatewayStore.set('https://my.gw')
      mockFetch.mockResolvedValue(makeMockResponse(true, { a: 1 }))
      expect(await fetchJson(`ipfs://${CID_V1}`)).toEqual({ status: 'found', data: { a: 1 } })
      expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([`https://my.gw/ipfs/${CID_V1}`])
    })
  })

  describe('resolveCandidates', () => {
    it('drops cooling gateways rather than appending them', () => {
      const firstKey = gatewayKey(IPFS_GATEWAYS[0] as IpfsGateway)
      noteThrottled(firstKey)
      const urls = resolveCandidates(`ipfs://${CID_V1}`).map((c) => c.url)
      expect(urls).not.toContain(publicUrls(CID_V1)[0])
      expect(urls).toHaveLength(publicUrls(CID_V1).length - 1)
    })

    it('is empty when every gateway is cooling — the caller must report that as throttled', () => {
      for (const gateway of IPFS_GATEWAYS) noteThrottled(gatewayKey(gateway))
      expect(resolveCandidates(`ipfs://${CID_V1}`)).toEqual([])
    })

    it('tags each ipfs candidate with the gateway it reports health to', () => {
      const candidates = resolveCandidates(`ipfs://${CID_V1}`)
      expect(candidates.every((c) => typeof c.gatewayKey === 'string')).toBe(true)
    })

    it('gives a non-ipfs pointer a single untagged candidate', () => {
      expect(resolveCandidates('ar://tx1')).toEqual([
        { url: 'https://arweave.net/tx1', gatewayKey: null },
      ])
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
    vi.stubGlobal('localStorage', makeLocalStorageMock())
    resetGatewayHealth()
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    resetGatewayHealth()
    vi.unstubAllGlobals()
  })

  it('rejects an HTML interstitial served for an ipfs:// CID and rotates to the next gateway', async () => {
    const data = { name: 'real' }
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url === publicUrls(CID_V0)[0]
          ? makeMockResponse(true, { title: 'Just a moment' }, 'text/html')
          : makeMockResponse(true, data),
      ),
    )
    await expect(fetchJson(`ipfs://${CID_V0}`)).resolves.toEqual({ status: 'found', data })
  })

  it('reports offline — not not-found — when every gateway answers with a document', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(true, { title: 'Just a moment' }, 'text/html'))
    expect(await fetchJson('ipfs://QmFoo')).toEqual({ status: 'offline' })
  })

  it('reports offline for a document served on a single-URL (non-ipfs) pointer', async () => {
    mockFetch.mockResolvedValueOnce(makeMockResponse(true, { a: 1 }, 'text/html'))
    expect(await fetchJson('ar://tx1')).toEqual({ status: 'offline' })
  })

  it('demotes a gateway that serves a document, so the next item skips it', async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        isFirstGateway(url)
          ? makeMockResponse(true, { title: 'Just a moment' }, 'text/html')
          : makeMockResponse(true, { a: 1 }),
      ),
    )
    await fetchJson(`ipfs://${CID_V1}/one.json`)
    mockFetch.mockClear()
    await fetchJson(`ipfs://${CID_V1}/two.json`)
    expect(mockFetch.mock.calls.map((c) => c[0])).not.toContain(publicUrls(`${CID_V1}/two.json`)[0])
  })
})
