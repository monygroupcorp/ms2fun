/**
 * ArtPointerNotice (noesis-384) — the creator is told when their collection's art reaches nobody,
 * on their own admin view and nowhere else.
 *
 * Two failures look identical from outside the app (every viewer gets the fallback tile) and need
 * different words: a pointer the scheme allowlist refuses, and a good pointer nothing serves any
 * more. A cooling gateway is neither — it is about the viewer, and must not send a creator off to
 * fix something that is not broken.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ArtUnavailableError, parseCollection } from '../../lib/metadata'
import { ArtPointerNotice } from './ArtPointerNotice'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

const mockMetadata = vi.hoisted(() => vi.fn())
const mockLoadArt = vi.hoisted(() => vi.fn<(uri: string) => Promise<string>>())

vi.mock('./useCollectionChain', () => ({
  useCollectionChainId: () => 1,
  useCollectionAddresses: () => ({ QueryAggregator: INSTANCE }),
}))
vi.mock('../useCollection', () => ({
  useCollection: () => ({ data: { metadataURI: 'ipfs://meta' } }),
}))
vi.mock('../useCollectionMetadata', () => ({ useCollectionMetadata: () => mockMetadata() }))

vi.mock('../../lib/metadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/metadata')>()),
  loadArt: (uri: string) => mockLoadArt(uri),
}))

// Each test gets a fresh cache: the probe is keyed on the pointer, and two tests use the same CID.
let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** The metadata a collection with this authored `image` actually parses to. */
function collectionWithImage(image: string) {
  return parseCollection({ name: 'c', image })
}

test('a refused pointer is named as a refusal, not as a missing file', async () => {
  mockMetadata.mockReturnValue(collectionWithImage('javascript:alert(1)'))

  render(<ArtPointerNotice instance={INSTANCE} />, { wrapper })

  const notice = await screen.findByTestId('art-pointer-notice')
  expect(notice.textContent).toMatch(/every viewer sees the fallback tile/)
  expect(screen.getByText('this pointer is not a scheme the app will render')).toBeTruthy()
  expect(mockLoadArt).not.toHaveBeenCalled()
})

test('a good pointer nothing serves is named as unserved, and says to re-pin', async () => {
  mockMetadata.mockReturnValue(collectionWithImage(`ipfs://${CID}`))
  mockLoadArt.mockRejectedValue(new ArtUnavailableError('missing'))

  render(<ArtPointerNotice instance={INSTANCE} />, { wrapper })

  const notice = await screen.findByTestId('art-pointer-notice')
  expect(notice.textContent).toMatch(/re-pin the content/)
  expect(screen.getByText('no gateway served this pointer')).toBeTruthy()
})

test('a throttled gateway is about the viewer and raises nothing', async () => {
  mockMetadata.mockReturnValue(collectionWithImage(`ipfs://${CID}`))
  mockLoadArt.mockRejectedValue(new ArtUnavailableError('throttled', Date.now() + 60_000))

  const { container } = render(<ArtPointerNotice instance={INSTANCE} />, { wrapper })

  await waitFor(() => expect(mockLoadArt).toHaveBeenCalled())
  expect(screen.queryByTestId('art-pointer-notice')).toBeNull()
  expect(container.textContent).toBe('')
})

test('a pointer that resolves, and a collection with no art at all, both stay silent', async () => {
  mockMetadata.mockReturnValue(collectionWithImage(`ipfs://${CID}`))
  mockLoadArt.mockResolvedValue('blob:art')

  const resolved = render(<ArtPointerNotice instance={INSTANCE} />, { wrapper })
  await waitFor(() => expect(mockLoadArt).toHaveBeenCalled())
  expect(screen.queryByTestId('art-pointer-notice')).toBeNull()
  resolved.unmount()

  // Art is optional (noesis: `artOptional`); authoring none is not a defect to report.
  mockMetadata.mockReturnValue(collectionWithImage(''))
  const bare = render(<ArtPointerNotice instance={INSTANCE} />, { wrapper })
  expect(screen.queryByTestId('art-pointer-notice')).toBeNull()
  expect(bare.container.textContent).toBe('')
})
