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
