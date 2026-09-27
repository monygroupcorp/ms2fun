/**
 * IpfsImage (noesis-371) — request budget and the lazy default.
 *
 * Three properties, each of which a grid of a thousand thumbnails depends on:
 *  - many components sharing one CID cost ONE request, and a re-mount costs none;
 *  - an inline `data:` pointer costs no request at all;
 *  - `loading` defaults to `lazy`. That default is the reason a large grid is survivable — the
 *    viewer scrolls past a thousand items and looks at a few dozen — so it is asserted here rather
 *    than left to a comment. Prefetching a screen ahead is intended; prefetching the grid is not.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ART_BOX,
  gatewayKey,
  IPFS_GATEWAYS,
  noteThrottled,
  resetArtMemoryCache,
  resetGatewayHealth,
} from '../../lib/metadata'
import { IpfsImage } from './IpfsImage'

const CID = 'ipfs://QmArtOne'
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const fetchMock = vi.fn()

/** Observer stub that reports every observed element as visible, synchronously. */
class ImmediateIntersectionObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {}
  observe(el: Element) {
    this.cb(
      [{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver)
  URL.createObjectURL = vi.fn(() => 'blob:art')
  URL.revokeObjectURL = vi.fn()
  resetArtMemoryCache()
  resetGatewayHealth()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['art']) })
})

afterEach(() => {
  cleanup()
  resetGatewayHealth()
  vi.unstubAllGlobals()
})

/** Park every public gateway, i.e. the state a rate-limited viewer is in. */
function coolEveryGateway(): void {
  for (const gateway of IPFS_GATEWAYS) noteThrottled(gatewayKey(gateway))
}

describe('IpfsImage', () => {
  it('issues one request when N components share one CID', async () => {
    render(
      <>
        {Array.from({ length: 14 }, (_, i) => (
          <IpfsImage key={i} uri={CID} alt="art" testId={`art-${i}`} />
        ))}
      </>,
    )

    await waitFor(() => expect(screen.getByTestId('art-0')).toHaveAttribute('src', 'blob:art'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('issues no request on a second mount of resolved content', async () => {
    const first = render(<IpfsImage uri={CID} alt="art" testId="art" />)
    await waitFor(() => expect(screen.getByTestId('art')).toHaveAttribute('src', 'blob:art'))
    first.unmount()
    fetchMock.mockClear()

    render(<IpfsImage uri={CID} alt="art" testId="art" />)

    expect(screen.getByTestId('art')).toHaveAttribute('src', 'blob:art')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders a data: pointer with no network request', () => {
    render(<IpfsImage uri={PIXEL} alt="art" testId="art" />)

    expect(screen.getByTestId('art')).toHaveAttribute('src', PIXEL)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defaults to lazy loading', () => {
    render(<IpfsImage uri={PIXEL} alt="art" testId="immutable" />)
    render(<IpfsImage uri="https://example.test/art.png" alt="art" testId="mutable" />)

    expect(screen.getByTestId('immutable')).toHaveAttribute('loading', 'lazy')
    expect(screen.getByTestId('mutable')).toHaveAttribute('loading', 'lazy')
  })

  it('honours an explicit eager caller', () => {
    render(<IpfsImage uri={PIXEL} alt="art" loading="eager" testId="art" />)

    expect(screen.getByTestId('art')).toHaveAttribute('loading', 'eager')
  })

  it('loads a mutable http(s) pointer natively, without the immutable cache', () => {
    render(<IpfsImage uri="https://example.test/art.png" alt="art" testId="art" />)

    expect(screen.getByTestId('art')).toHaveAttribute('src', 'https://example.test/art.png')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the fallback when every gateway fails', async () => {
    fetchMock.mockRejectedValue(new Error('gateway down'))

    render(<IpfsImage uri={CID} alt="art" testId="art" fallback={<span>no art</span>} />)

    await waitFor(() => expect(screen.getByText('no art')).toBeInTheDocument())
    expect(screen.queryByTestId('art')).not.toBeInTheDocument()
  })

  it('renders the fallback for an unusable pointer', () => {
    render(<IpfsImage uri="" alt="art" testId="art" fallback={<span>no art</span>} />)

    expect(screen.getByText('no art')).toBeInTheDocument()
  })

  it('shows a throttled state — NOT the missing-art fallback — while gateways are cooling', () => {
    coolEveryGateway()

    render(<IpfsImage uri={CID} alt="art" testId="art" fallback={<span>no art</span>} />)

    expect(screen.getByTestId('art')).toHaveAttribute('data-state', 'throttled')
    expect(screen.queryByText('no art')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('distinguishes throttled from missing when the load itself is refused', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
      blob: async () => new Blob([]),
    })

    render(<IpfsImage uri={CID} alt="art" testId="art" fallback={<span>no art</span>} />)

    await waitFor(() =>
      expect(screen.getByTestId('art')).toHaveAttribute('data-state', 'throttled'),
    )
    expect(screen.queryByText('no art')).not.toBeInTheDocument()
  })

  it('still shows the plain fallback when the content is genuinely absent', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      blob: async () => new Blob([]),
    })

    render(<IpfsImage uri={CID} alt="art" testId="art" fallback={<span>no art</span>} />)

    await waitFor(() => expect(screen.getByText('no art')).toBeInTheDocument())
  })
})

/**
 * The `width` prop is the ONLY thing that puts the art service in front of the roster, and for a
 * while nothing passed it: the service, its worker, its cache and its width ladder all shipped while
 * every render site asked for an original off a public gateway. The defect was invisible because
 * everything still worked — just on the viewer's quota, at full size. So these assert the wiring
 * itself rather than the plumbing underneath it.
 */
describe('IpfsImage width → the art service', () => {
  const ART = 'https://art.example'

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** The URL of the first request the loader actually spent. */
  function firstRequestedUrl(): string {
    expect(fetchMock).toHaveBeenCalled()
    return String(fetchMock.mock.calls[0]?.[0])
  }

  it('asks the service for a rung when a width is given', async () => {
    vi.stubEnv('VITE_ART_SERVICE', ART)
    vi.stubGlobal('devicePixelRatio', 1)

    render(<IpfsImage uri={CID} alt="art" testId="art" width={ART_BOX.card} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(firstRequestedUrl()).toBe(`${ART}/art/QmArtOne?w=320`)
  })

  it('asks a PUBLIC GATEWAY when no width is given, service or not', async () => {
    vi.stubEnv('VITE_ART_SERVICE', ART)

    render(<IpfsImage uri={CID} alt="art" testId="art" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(firstRequestedUrl()).not.toContain(ART)
  })

  it('climbs a rung for a 2x screen, so a card is not soft on a phone', async () => {
    vi.stubEnv('VITE_ART_SERVICE', ART)
    vi.stubGlobal('devicePixelRatio', 2)

    render(<IpfsImage uri={CID} alt="art" testId="art" width={ART_BOX.card} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(firstRequestedUrl()).toBe(`${ART}/art/QmArtOne?w=640`)
  })

  it('does NOT climb past 2x — a 3x screen mints no third variant nobody can see', async () => {
    vi.stubEnv('VITE_ART_SERVICE', ART)
    vi.stubGlobal('devicePixelRatio', 3)

    render(<IpfsImage uri={CID} alt="art" testId="art" width={ART_BOX.card} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(firstRequestedUrl()).toBe(`${ART}/art/QmArtOne?w=640`)
  })

  it('keeps the roster behind it: a service that fails falls through to a gateway', async () => {
    vi.stubEnv('VITE_ART_SERVICE', ART)
    vi.stubGlobal('devicePixelRatio', 1)
    fetchMock.mockImplementation((url: unknown) =>
      String(url).startsWith(ART)
        ? Promise.resolve({ ok: false, status: 502, headers: { get: () => null } })
        : Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['art']) }),
    )

    render(<IpfsImage uri={CID} alt="art" testId="art" width={ART_BOX.card} />)

    await waitFor(() => expect(screen.getByTestId('art')).toHaveAttribute('src', 'blob:art'))
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toContain(ART)
    expect(urls.some((u) => !u.startsWith(ART))).toBe(true)
  })

  it('spends ONE request for N cards sharing a CID at the same rung', async () => {
    vi.stubEnv('VITE_ART_SERVICE', ART)
    vi.stubGlobal('devicePixelRatio', 1)

    render(
      <>
        {Array.from({ length: 9 }, (_, i) => (
          <IpfsImage key={i} uri={CID} alt="art" testId={`art-${i}`} width={ART_BOX.card} />
        ))}
      </>,
    )

    await waitFor(() => expect(screen.getByTestId('art-8')).toHaveAttribute('src', 'blob:art'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a card and a detail view of one CID are DIFFERENT bytes, so both are fetched', async () => {
    vi.stubEnv('VITE_ART_SERVICE', ART)
    vi.stubGlobal('devicePixelRatio', 1)

    render(
      <>
        <IpfsImage uri={CID} alt="card" testId="card" width={ART_BOX.card} />
        <IpfsImage uri={CID} alt="full" testId="full" width={ART_BOX.full} />
      </>,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).sort()
    expect(urls).toEqual([`${ART}/art/QmArtOne?w=320`, `${ART}/art/QmArtOne?w=1024`].sort())
  })

  it('with NO service the two roles share one request — widths cost nothing when unset', async () => {
    render(
      <>
        <IpfsImage uri={CID} alt="card" testId="card" width={ART_BOX.card} />
        <IpfsImage uri={CID} alt="full" testId="full" width={ART_BOX.full} />
      </>,
    )

    await waitFor(() => expect(screen.getByTestId('full')).toHaveAttribute('src', 'blob:art'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
