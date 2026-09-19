/**
 * The drop's end, as a collector meets it (noesis/open-edition-cannot-close).
 *
 * `ERC1155Instance.mint` reverts `EditionClosed()` AT the close time and `ExceedsWalletLimit()` past
 * the per-wallet ceiling. Neither is a degradation the panel may absorb quietly: a button that can
 * be pressed on an edition that is over spends gas to learn the drop ended, which is the same defect
 * the open-time gate and the allowlist-remaining line were each written against.
 *
 * So these cases assert what a visitor experiences — the sentence on the panel and whether the
 * button can be pressed. The arithmetic behind both lives in `editionSchedule.ts` and is pinned by
 * its own tests; what is under test here is the panel's reading of it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { MintPanel } from './MintPanel'
import type { EditionView } from '../useEditions'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const WALLET = '0x2222222222222222222222222222222222222222' as const

/** What the mocked `editionMintedBy` read answers with — what this wallet already took. */
const chain = vi.hoisted(() => ({ mintedByWallet: undefined as bigint | undefined }))

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useAccount: () => ({ isConnected: true, address: WALLET }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}))

const writeContract = vi.fn()

vi.mock('../../../generated/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../generated/contracts')>()),
  useReadErc1155InstanceCalculateMintCost: () => ({ data: 10n ** 16n, isPending: false }),
  // No gating module: the allowlist leg is out of the way, so only the schedule is under test.
  useReadErc1155InstanceGatingModule: () => ({ data: undefined }),
  useReadErc1155InstanceGatingScope: () => ({ data: 0 }),
  useReadErc1155InstanceEditionMintedBy: () => ({ data: chain.mintedByWallet }),
  useWriteErc1155InstanceMint: () => ({
    writeContract,
    data: undefined,
    isPending: false,
    isError: false,
    reset: vi.fn(),
  }),
}))

vi.mock('../useCollectionChain', () => ({ useCollectionChainId: () => 31337 }))
vi.mock('./useMerkleAllowlist', () => ({
  useMerkleAllowlistProof: () => ({ status: 'no-list', proof: undefined }),
}))

const SECOND = 1000
const HOUR = 60 * 60 * SECOND

/**
 * Unix seconds `ms` from now. Truncation to whole seconds loses a fraction, and `timeRemaining`
 * floors, so a case that wants "5 hours left" asks for a little over five hours rather than sitting
 * on the boundary and reading 4.
 */
const at = (ms: number): bigint => BigInt(Math.floor((Date.now() + ms) / 1000))

function edition(over: Partial<Record<'closeTime' | 'maxPerWallet', bigint>>): EditionView {
  return {
    id: 1n,
    openTime: 0n,
    closeTime: 0n,
    maxPerWallet: 0n,
    ...over,
  } as unknown as EditionView
}

function mount(ed: EditionView): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MintPanel instance={INSTANCE} edition={ed} refetch={() => {}} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  chain.mintedByWallet = undefined
  writeContract.mockClear()
  cleanup()
})

// ── the close time ──────────────────────────────────────────────────────────

test('an edition still inside its window says how long is left and can be minted', () => {
  mount(edition({ closeTime: at(5 * HOUR + 30 * SECOND) }))

  expect(screen.getByTestId('erc1155-mint-time-remaining').textContent).toContain('5 hours left')
  expect(screen.queryByTestId('erc1155-mint-closed')).toBeNull()
  expect(screen.getByRole('button', { name: 'mint' })).not.toBeDisabled()
})

test('an edition that is over says so and cannot be minted', () => {
  mount(edition({ closeTime: at(-SECOND) }))

  expect(screen.getByTestId('erc1155-mint-closed').textContent).toContain('this edition is over')
  expect(screen.queryByTestId('erc1155-mint-time-remaining')).toBeNull()
  expect(screen.getByRole('button', { name: 'mint' })).toBeDisabled()
})

test('a closed edition does not send a transaction even if the button is reached', () => {
  mount(edition({ closeTime: at(-SECOND) }))

  fireEvent.click(screen.getByRole('button', { name: 'mint' }))
  expect(writeContract).not.toHaveBeenCalled()
})

test('an open-ended edition says nothing about an end and stays mintable', () => {
  mount(edition({}))

  expect(screen.queryByTestId('erc1155-mint-time-remaining')).toBeNull()
  expect(screen.queryByTestId('erc1155-mint-closed')).toBeNull()
  expect(screen.getByRole('button', { name: 'mint' })).not.toBeDisabled()
})

// ── the per-wallet ceiling ──────────────────────────────────────────────────

test('a wallet that has minted nothing is offered the whole ceiling', () => {
  chain.mintedByWallet = 0n
  mount(edition({ maxPerWallet: 3n }))

  expect(screen.getByTestId('erc1155-mint-wallet-limit').textContent).toContain('3 of 3 left')
  expect(screen.getByRole('button', { name: 'mint' })).not.toBeDisabled()
})

test('a partly-spent wallet is told what is LEFT, not the ceiling', () => {
  chain.mintedByWallet = 2n
  mount(edition({ maxPerWallet: 3n }))

  expect(screen.getByTestId('erc1155-mint-wallet-limit').textContent).toContain('1 of 3 left')
})

test('a wallet at its ceiling is told so and cannot mint', () => {
  chain.mintedByWallet = 3n
  mount(edition({ maxPerWallet: 3n }))

  expect(screen.getByTestId('erc1155-mint-wallet-limit').textContent).toContain(
    'has minted its limit of 3',
  )
  expect(screen.getByRole('button', { name: 'mint' })).toBeDisabled()
})

test('an amount above what is left is refused before signing', () => {
  chain.mintedByWallet = 2n
  mount(edition({ maxPerWallet: 3n }))

  fireEvent.change(screen.getByLabelText('mint amount'), { target: { value: '2' } })
  expect(screen.getByRole('button', { name: 'mint' })).toBeDisabled()
})

test('an amount exactly equal to what is left is still allowed', () => {
  chain.mintedByWallet = 1n
  mount(edition({ maxPerWallet: 3n }))

  fireEvent.change(screen.getByLabelText('mint amount'), { target: { value: '2' } })
  expect(screen.getByRole('button', { name: 'mint' })).not.toBeDisabled()
})

test('an edition with no ceiling says nothing about one', () => {
  mount(edition({}))

  expect(screen.queryByTestId('erc1155-mint-wallet-limit')).toBeNull()
})
