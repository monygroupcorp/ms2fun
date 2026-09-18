/**
 * One curation's page — what a visitor sees, and which controls each wallet is offered.
 *
 * The permission questions are the ones worth pinning: the controls a wallet gets are drawn from
 * the contract's own `canEdit`, so this suite is what stops the button set drifting wider than the
 * rules the registry would enforce.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { CurationPage } from './CurationPage'

const CURATOR = '0x1111111111111111111111111111111111111111' as const
const FRIEND = '0x2222222222222222222222222222222222222222' as const
const STRANGER = '0x3333333333333333333333333333333333333333' as const
const PICK = '0x4444444444444444444444444444444444444444' as const

const mockAccount = vi.hoisted(() => vi.fn())
const mockCuration = vi.hoisted(() => vi.fn())
const mockCanEdit = vi.hoisted(() => vi.fn())
const mockMetadata = vi.hoisted(() => vi.fn())
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
  useCuration: mockCuration,
  useCurationCanEdit: mockCanEdit,
  useCurationMetadata: mockMetadata,
}))

// The picks grid has its own read path; here it only has to not be the subject.
vi.mock('../components/curation/CurationPicks', () => ({
  CurationPicks: ({ items }: { items: readonly { instance: string }[] }) => (
    <div data-testid="picks">{items.length} picks</div>
  ),
}))
vi.mock('../lib/discovery', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAllCollections: () => ({ data: [], isPending: false, isError: false, total: 0 }),
}))

function mount(path = '/curation/7') {
  const { hook } = memoryLocation({ path })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Route path="/curation/:id" component={CurationPage} />
      </Router>
    </QueryClientProvider>,
  )
}

const record = (over: Partial<{ retired: boolean }> = {}) => ({
  data: {
    curator: CURATOR,
    updatedAt: 1_700_000_000n,
    retired: false,
    uri: 'ipfs://QmSet',
    ...over,
  },
  isPending: false,
  isError: false,
  queryKey: [],
})

beforeEach(() => {
  mockAccount.mockReturnValue({ address: undefined })
  mockCuration.mockReturnValue(record())
  mockCanEdit.mockReturnValue({ data: false })
  mockMetadata.mockReturnValue({
    schemaVersion: 1,
    name: 'Blues',
    description: 'Everything that stopped me.',
    image: '',
    items: [{ instance: PICK, tokenId: '', note: '' }],
  })
  mockSend.mockReset()
})
afterEach(cleanup)

describe('CurationPage', () => {
  it('shows the whole wall label to a visitor with no wallet', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Blues' })).toBeInTheDocument()
    expect(screen.getByText('Everything that stopped me.')).toBeInTheDocument()
    expect(screen.getByTestId('picks')).toHaveTextContent('1 picks')
    expect(screen.getByRole('link', { name: /0x1111/ })).toHaveAttribute(
      'href',
      `/profile/${CURATOR}`,
    )
  })

  it('offers no controls to a stranger', () => {
    mockAccount.mockReturnValue({ address: STRANGER })
    mount()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: /off view/i })).toBeNull()
  })

  it('gives the curator the editor, the view switch, and the collaborator panel', () => {
    mockAccount.mockReturnValue({ address: CURATOR })
    mockCanEdit.mockReturnValue({ data: true })
    mount()

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take off view' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Collaborators' })).toBeInTheDocument()
  })

  /** A collaborator assembles; only the curator decides visibility and who else assembles. */
  it('gives a collaborator the editor and nothing else', () => {
    mockAccount.mockReturnValue({ address: FRIEND })
    mockCanEdit.mockReturnValue({ data: true })
    mount()

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /off view/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Collaborators' })).toBeNull()
    expect(screen.getByText(/you are a collaborator here/i)).toBeInTheDocument()
  })

  it('repoints the curation through the registry when an editor saves', () => {
    mockAccount.mockReturnValue({ address: CURATOR })
    mockCanEdit.mockReturnValue({ data: true })
    mount()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save curation' }))

    const call = mockSend.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call.functionName).toBe('setCurationURI')
    expect((call.args as unknown[])[0]).toBe(7n)
  })

  it('will not open the editor before the set has resolved', () => {
    mockAccount.mockReturnValue({ address: CURATOR })
    mockCanEdit.mockReturnValue({ data: true })
    mockMetadata.mockReturnValue(undefined)
    mount()

    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByText(/reading the set…/i)).toBeInTheDocument()
  })

  it('says a retired curation is off view, and still shows it', () => {
    mockCuration.mockReturnValue(record({ retired: true }))
    mount()

    expect(screen.getByTestId('curation-retired')).toHaveTextContent('taken this off view')
    expect(screen.getByTestId('picks')).toBeInTheDocument()
  })

  it('offers the curator the way back on view', () => {
    mockAccount.mockReturnValue({ address: CURATOR })
    mockCanEdit.mockReturnValue({ data: true })
    mockCuration.mockReturnValue(record({ retired: true }))
    mount()

    fireEvent.click(screen.getByRole('button', { name: 'Put back on view' }))
    const call = mockSend.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call.functionName).toBe('setRetired')
    expect(call.args).toEqual([7n, false])
  })

  it('refuses a route param that is not a curation number', () => {
    mount('/curation/abc')
    expect(screen.getByTestId('curation-bad-id')).toHaveTextContent('Not a curation')
  })

  /** `getCuration` reverts on an id nobody published, so the read error IS the empty answer. */
  it('reads a revert as "no such curation"', () => {
    mockCuration.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      queryKey: [],
    })
    mount()
    expect(screen.getByTestId('curation-not-found')).toHaveTextContent('No curation #7')
  })
})
