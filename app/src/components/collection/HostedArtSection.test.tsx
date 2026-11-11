/**
 * Hosted art on the collection page: every visitor sees where it stands, a graduated collection's
 * owner is recommended to move it, the move is only offered once public gateways serve it — and no
 * deadline is stated anywhere, because there is none.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { HostingStatus } from '../../lib/art/hostClient'
import { HostedArtSection } from './HostedArtSection'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const HOST = 'https://art.example'
const IMG = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const META = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
const MIGRATED = 'bafybeia3zy2dt2eoaokuvdp62xxaps37qdf52tgirrmquj4u66apwiprim'
const DAY = 24 * 3600_000

const mocks = vi.hoisted(() => ({
  host: 'https://art.example' as string | null,
  status: vi.fn<() => Promise<HostingStatus | null>>(),
  isOwner: false,
  onChain: '' as string,
  send: vi.fn(),
  check: vi.fn(),
  migrationOf: vi.fn(),
}))

vi.mock('../../lib/art/hostClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/art/hostClient')>()),
  artHostBase: () => mocks.host,
  fetchHostingStatus: () => mocks.status(),
}))
vi.mock('../../lib/art/migrate', () => ({
  migrationOf: async () => mocks.migrationOf(),
  checkRetrievable: (...args: unknown[]) => mocks.check(...args),
  buildMigrationCar: vi.fn(),
}))
vi.mock('../ui/useOwnerGate', () => ({ useOwnerGate: () => ({ isOwner: mocks.isOwner }) }))
vi.mock('./useCollectionChain', () => ({ useCollectionChainId: () => 1 }))
vi.mock('../../generated/contracts', () => ({
  erc404BondingInstanceAbi: [],
  useReadErc404BondingInstanceMetadataUri: () => ({ data: mocks.onChain, refetch: vi.fn() }),
}))
vi.mock('../ui/useTxAction', () => ({
  useTxAction: () => ({ state: 'idle', send: mocks.send, reset: vi.fn(), isBusy: false }),
}))

let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function status(over: Partial<HostingStatus> = {}): HostingStatus {
  const now = Date.now()
  return {
    instance: INSTANCE,
    state: 'hosted',
    imgCid: IMG,
    metaCid: META,
    migrationCid: MIGRATED,
    pieces: ['1.png', '2.png'],
    migrated: false,
    boundAt: now - DAY,
    graduatedAt: null,
    migratedAt: null,
    ...over,
  }
}

const PIECES = [1, 2].map((n) => ({
  name: String(n),
  json: `{"name":"#${n}","image":"ipfs://${IMG}/${n}.png"}`,
  image: `${n}.png`,
}))

beforeEach(() => {
  mocks.migrationOf.mockResolvedValue({ metaCid: MIGRATED, pieces: PIECES })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.host = HOST
  mocks.isOwner = false
  mocks.onChain = `${HOST}/ipfs/${META}/`
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('renders nothing for a collection the art host does not know', async () => {
  mocks.status.mockResolvedValue(null)
  const { container } = render(<HostedArtSection instance={INSTANCE} />, { wrapper })
  await waitFor(() => expect(mocks.status).toHaveBeenCalled())
  expect(container.innerHTML).toBe('')
})

test('renders nothing when the build names no art host', () => {
  mocks.host = null
  const { container } = render(<HostedArtSection instance={INSTANCE} />, { wrapper })
  expect(container.innerHTML).toBe('')
  expect(mocks.status).not.toHaveBeenCalled()
})

test('a visitor sees the policy, with no deadline and no steps', async () => {
  mocks.status.mockResolvedValue(status())
  render(<HostedArtSection instance={INSTANCE} />, { wrapper })
  const line = await screen.findByTestId('hosted-art-state')
  expect(line.textContent).toMatch(/Art belongs on IPFS/)
  expect(line.textContent).toMatch(/encouraged to move it there once the collection graduates/)
  expect(line.textContent).not.toMatch(/ends|days left|until/)
  expect(screen.queryByTestId('hosted-art-migrate')).toBeNull()
})

test('a visitor to a graduated collection sees the recommendation, not a threat', async () => {
  mocks.status.mockResolvedValue(status({ state: 'graduated', graduatedAt: Date.now() }))
  render(<HostedArtSection instance={INSTANCE} />, { wrapper })
  const line = await screen.findByTestId('hosted-art-state')
  expect(line.textContent).toMatch(/has graduated/)
  expect(line.textContent).toMatch(/recommended next step/)
  expect(line.textContent).not.toMatch(/ends|stops|days left/)
})

test('a graduated collection’s owner is recommended to move, and offered it once gateways serve the art', async () => {
  mocks.isOwner = true
  mocks.status.mockResolvedValue(status({ state: 'graduated', graduatedAt: Date.now() }))
  mocks.check.mockResolvedValue({ ok: true, operator: 'Filebase', problems: [] })
  render(<HostedArtSection instance={INSTANCE} />, { wrapper })

  const steps = await screen.findByTestId('hosted-art-migrate')
  const recommend = screen.getByTestId('hosted-art-recommend')
  expect(recommend.textContent).toMatch(/a good time to move its art to IPFS/)
  expect(recommend.textContent).toMatch(/keep serving it in the meantime/)
  expect(steps.textContent).not.toMatch(/before \d|days left|stops serving/)
  await waitFor(() => expect(steps.textContent).toContain(`ipfs://${MIGRATED}/`))

  const set = screen.getByTestId('hosted-art-set-base')
  expect(set).toHaveProperty('disabled', true)

  fireEvent.click(screen.getByTestId('hosted-art-check'))
  await screen.findByTestId('hosted-art-check-ok')
  expect(mocks.check).toHaveBeenCalledWith(IMG, MIGRATED, PIECES)

  await waitFor(() =>
    expect(screen.getByTestId('hosted-art-set-base')).toHaveProperty('disabled', false),
  )
  fireEvent.click(screen.getByTestId('hosted-art-set-base'))
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      address: INSTANCE,
      functionName: 'setMetadataURI',
      args: [`ipfs://${MIGRATED}/`],
    }),
  )
})

test('a failed check names what failed and keeps the move closed', async () => {
  mocks.isOwner = true
  mocks.status.mockResolvedValue(status())
  mocks.check.mockResolvedValue({
    ok: false,
    operator: null,
    problems: ['Filebase: metadata #1 answered 504'],
  })
  render(<HostedArtSection instance={INSTANCE} />, { wrapper })
  await waitFor(() =>
    expect(screen.getByTestId('hosted-art-check')).toHaveProperty('disabled', false),
  )
  fireEvent.click(screen.getByTestId('hosted-art-check'))
  expect(await screen.findByText('Filebase: metadata #1 answered 504')).toBeTruthy()
  expect(screen.getByTestId('hosted-art-set-base')).toHaveProperty('disabled', true)
})

test('shows "verified on IPFS" when the chain points at the regenerated root', async () => {
  mocks.isOwner = true
  mocks.onChain = `ipfs://${MIGRATED}/`
  mocks.status.mockResolvedValue(
    status({ state: 'migrated', migrated: true, migratedAt: Date.now() }),
  )
  render(<HostedArtSection instance={INSTANCE} />, { wrapper })
  expect(await screen.findByTestId('hosted-art-verified')).toBeTruthy()
  expect(screen.queryByTestId('hosted-art-migrate')).toBeNull()
})

test('does not call a different ipfs:// base verified', async () => {
  mocks.onChain = `ipfs://${META}/`
  mocks.status.mockResolvedValue(status({ state: 'graduated', graduatedAt: Date.now() }))
  render(<HostedArtSection instance={INSTANCE} />, { wrapper })
  await screen.findByTestId('hosted-art-state')
  expect(screen.queryByTestId('hosted-art-verified')).toBeNull()
})

test('a visitor downloads nothing to check while the collection still points at hosted art', async () => {
  mocks.status.mockResolvedValue(status())
  render(<HostedArtSection instance={INSTANCE} />, { wrapper })
  await screen.findByTestId('hosted-art-state')
  expect(mocks.migrationOf).not.toHaveBeenCalled()
})
