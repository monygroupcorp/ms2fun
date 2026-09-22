/**
 * The Curations wall on a chain with no curation registry.
 *
 * The contract is newer than the deployments that carry it, so a build pointed at a chain deployed
 * before it resolves the zero address — and offering a composer there would take a signature to
 * nowhere. `curationsAvailable` is a module constant read from that address, so this case needs its
 * own module graph; it lives in its own file rather than resetting the registry out from under the
 * sibling tests of the available case.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { CurationsPage } from './CurationsPage'

const VISITOR = '0x2222222222222222222222222222222222222222' as const

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: VISITOR }),
  usePublicClient: () => undefined,
  useWriteContract: () => ({
    writeContract: vi.fn(),
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

// The committed deployment placeholder is all-zero, which IS this case — but assert it through the
// flag the page reads rather than through the placeholder staying zero forever.
vi.mock('../components/curation/useCurations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  curationsAvailable: false,
  useLatestCurations: () => ({ data: [], isPending: false, isError: false }),
  useCurationCount: () => undefined,
}))

afterEach(cleanup)

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

describe('CurationsPage without a curation registry', () => {
  it('says the registry is not on this network', () => {
    mount()
    expect(screen.getByTestId('curations-unavailable')).toHaveTextContent('Not on this network')
  })

  it('offers no composer, even to a connected wallet', () => {
    mount()
    expect(screen.queryByRole('button', { name: 'Create a curation' })).toBeNull()
    expect(screen.queryByLabelText('Title')).toBeNull()
  })

  it('does not also claim the wall is empty', () => {
    mount()
    expect(screen.queryByTestId('curations-empty')).toBeNull()
  })
})
