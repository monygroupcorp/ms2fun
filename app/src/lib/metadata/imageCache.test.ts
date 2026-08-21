/**
 * imageCache (noesis-371) — one request per CID, and never for a mutable pointer.
 *
 * The property under test is request COUNT, not pixels: a grid where many cards share one
 * collection's art must spend one request, a re-mount must spend none, an inline `data:` must spend
 * none at all, and an `http(s)://` URL must never be admitted to a permanent cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveUriCandidates } from './uri'
import { loadArt, peekArt, resetArtMemoryCache } from './imageCache'

const CID = 'ipfs://QmArtOne'
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

let blobUrls = 0
const fetchMock = vi.fn()

function okResponse(bytes = 'art') {
  return { ok: true, status: 200, blob: async () => new Blob([bytes]) }
}

beforeEach(() => {
  blobUrls = 0
  vi.stubGlobal('fetch', fetchMock)
  URL.createObjectURL = vi.fn(() => `blob:art-${++blobUrls}`)
  URL.revokeObjectURL = vi.fn()
  resetArtMemoryCache()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(okResponse())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadArt', () => {
  it('issues exactly one request for N simultaneous callers on one CID', async () => {
    const urls = await Promise.all(Array.from({ length: 14 }, () => loadArt(CID)))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new Set(urls).size).toBe(1)
  })

  it('issues no request at all once the content is resolved', async () => {
    const first = await loadArt(CID)
    fetchMock.mockClear()

    const second = await loadArt(CID)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(second).toBe(first)
    expect(peekArt(CID)).toBe(first)
  })

  it('keys on content, so the same CID written two ways is one entry', async () => {
    await loadArt('ipfs://QmArtOne')
    fetchMock.mockClear()

    await loadArt('ipfs://ipfs/QmArtOne')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves a data: URI inline, with no network request', async () => {
    expect(await loadArt(PIXEL)).toBe(PIXEL)
    expect(peekArt(PIXEL)).toBe(PIXEL)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a mutable http(s) pointer rather than caching it permanently', async () => {
    await expect(loadArt('https://example.test/art.png')).rejects.toThrow(/content-addressed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('advances through the candidate gateways, in the order given, on failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('gateway down'))
    fetchMock.mockResolvedValueOnce(okResponse())

    await loadArt(CID)

    // The roster carries per-entry URL FORM (noesis-372), so a candidate URL is built by the
    // resolver, not by concatenating a base. A CIDv0 is also skipped by subdomain-form entries,
    // which is why the expected order comes from resolveUriCandidates rather than the roster.
    const candidates = resolveUriCandidates(CID)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(candidates[0])
    expect(fetchMock.mock.calls[1]?.[0]).toBe(candidates[1])
  })

  it('rejects only once every candidate has failed, and retries on a later call', async () => {
    fetchMock.mockRejectedValue(new Error('gateway down'))

    await expect(loadArt(CID)).rejects.toThrow()
    // Not the roster length: subdomain-form entries cannot serve this CIDv0 and are skipped.
    expect(fetchMock).toHaveBeenCalledTimes(resolveUriCandidates(CID).length)

    // A failure is not cached: the next caller is allowed to try again.
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(okResponse())
    await expect(loadArt(CID)).resolves.toMatch(/^blob:/)
  })
})
