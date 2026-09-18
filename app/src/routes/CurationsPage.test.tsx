/**
 * The Curations wall — the clause this whole surface exists for: a visitor who has deployed
 * nothing and bought nothing can assemble and publish a named set, and that set lands on a
 * discovery surface whose order no payment can move.
 *
 * The chain is mocked at the generated-hook boundary. What is under test is what a wallet is
 * offered and what the wall shows — not that wagmi works.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { CurationsPage } from './CurationsPage'

const CURATOR = '0x1111111111111111111111111111111111111111' as const
const VISITOR = '0x2222222222222222222222222222222222222222' as const

const mockAccount = vi.hoisted(() => vi.fn())
const mockLatest = vi.hoisted(() => vi.fn())
const mockCount = vi.hoisted(() => vi.fn())
const mockSend = vi.hoisted(() => vi.fn())

vi.mock('wagmi', () => ({
  useAccount: mockAccount,
  usePublicClient: () => undefined,
  useWriteContract: () => ({
    writeContract: mockSend,
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
    data: undefined,
  }),
}))

vi.mock('../components/curation/useCurations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  curationsAvailable: true,
  useLatestCurations: mockLatest,
  useCurationCount: mockCount,
  useCurationMetadata: () => ({
    schemaVersion: 1,
    name: 'Blues',
    description: '',
    image: '',
    items: [],
  }),
}))

// The pick-suggestion scan is not the subject here.
vi.mock('../lib/discovery', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAllCollections: () => ({ data: [], isPending: false, isError: false, total: 0 }),
}))

function row(id: bigint, updatedAt: bigint) {
  return {
    id,
    curation: { curator: CURATOR, updatedAt, retired: false, uri: 'ipfs://QmSet' },
  }
}

function mount() {
  const { hook } = memoryLocation({ path: '/curations' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <CurationsPage />
      </Router>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockAccount.mockReturnValue({ address: undefined })
  mockLatest.mockReturnValue({ data: [], isPending: false, isError: false })
  mockCount.mockReturnValue(undefined)
  mockSend.mockReset()
})
afterEach(cleanup)

describe('CurationsPage', () => {
  it('names the wall and says nobody paid to be on it', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Curations' })).toBeInTheDocument()
    expect(screen.getByText(/nobody pays to be here/i)).toBeInTheDocument()
  })

  it('offers no composer to a disconnected visitor, and says why', () => {
    mount()
    expect(screen.queryByRole('button', { name: 'Create a curation' })).toBeNull()
    expect(screen.getByText(/connect a wallet to create one/i)).toBeInTheDocument()
  })

  /**
   * The clause. `VISITOR` has deployed nothing and holds no badge — the mocked chain state says so
   * by carrying neither — and the door is open anyway.
   */
  it('offers the composer to any connected wallet, creator or not', () => {
    mockAccount.mockReturnValue({ address: VISITOR })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Create a curation' }))
    expect(screen.getByRole('heading', { name: 'New curation' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
  })

  it('publishes through the registry with no value attached', () => {
    mockAccount.mockReturnValue({ address: VISITOR })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Create a curation' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Blues' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish curation' }))

    expect(mockSend).toHaveBeenCalledTimes(1)
    const call = mockSend.mock.calls[0]?.[0] as {
      functionName: string
      value?: bigint
      args: unknown[]
    }
    expect(call.functionName).toBe('createCuration')
    expect(call.value).toBeUndefined()
    expect(String(call.args[0])).toContain('data:application/json,')
  })

  it('hangs the wall in the order the discovery read gives it', () => {
    mockLatest.mockReturnValue({
      data: [row(3n, 300n), row(2n, 200n), row(1n, 100n)],
      isPending: false,
      isError: false,
    })
    mount()
    const grid = screen.getByTestId('curations-grid')
    const ids = [...grid.querySelectorAll('[data-testid^="curation-card-"]')].map((el) =>
      el.getAttribute('data-testid'),
    )
    expect(ids).toEqual(['curation-card-3', 'curation-card-2', 'curation-card-1'])
  })

  it('says the wall is empty rather than showing a bare grid', () => {
    mount()
    expect(screen.getByTestId('curations-empty')).toHaveTextContent('No curations yet')
  })

  it('reports a read failure as a network fault, not as an empty wall', () => {
    mockLatest.mockReturnValue({ data: undefined, isPending: false, isError: true })
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent('discovery unreachable')
    expect(screen.queryByTestId('curations-empty')).toBeNull()
  })

  /**
   * `totalCurations` counts everything ever published, retired included — so the label says
   * "published", not a count of what is hung. A wall of one with three retired beside it must not
   * read as a wall of four.
   */
  it('reports the published count as published, not as the length of the wall', () => {
    mockCount.mockReturnValue(4n)
    mockLatest.mockReturnValue({ data: [row(4n, 400n)], isPending: false, isError: false })
    mount()

    expect(screen.getByText(/4 published/)).toBeInTheDocument()
  })

  it('says nothing about a count it has not read yet', () => {
    mount()
    expect(screen.queryByText(/published/)).toBeNull()
  })
})
