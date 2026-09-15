/**
 * The allowlist line states what this wallet can mint NOW, and the button refuses more (noesis-280).
 *
 * `MerkleGatingModule` enforces the leaf cap against a CUMULATIVE counter — `claimed[instance]
 * [editionId][user]`, bumped by `onMint` on both the paid and the free-claim path — so
 * `claimed + amount > maxQty` reverts `QtyCapExceeded`. The panel used to render the leaf cap under
 * the words "per wallet": a lifetime number described as a per-mint one. A wallet allowlisted for 5
 * that had minted 3 was told "up to 5 per wallet", could enter 5, and the button was enabled — the
 * only quantity check anywhere in the panel was `allowlist.status`, which never looks at a number.
 * The wallet signed, the chain refused, and the gas was spent finding out.
 *
 * So these cases assert the two things a visitor experiences: the number printed beside the noun, and
 * whether the button can be pressed. The hook is mocked because what is under test is the panel's
 * reading of `remainingNfts` — the subtraction that produces it is pinned in
 * `merkleAllowlistDenomination.test.tsx`'s family, where the scale it depends on lives.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { MintPanel } from './MintPanel'
import type { EditionView } from '../useEditions'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const MODULE = '0x3333333333333333333333333333333333333333' as const
const CAP = 5n

/** What the mocked allowlist hook answers with; each case sets what it is about before mounting. */
const allowlist = vi.hoisted(() => ({
  status: 'eligible' as string,
  maxQtyNfts: 5n as bigint | undefined,
  remainingNfts: 5n as bigint | undefined,
}))

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useAccount: () => ({ isConnected: true }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}))

const writeContract = vi.fn()

vi.mock('../../../generated/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../generated/contracts')>()),
  useReadErc1155InstanceCalculateMintCost: () => ({ data: 10n ** 16n, isPending: false }),
  // A module is set and the scope admits the paid path, so `isPaidMintGated` is true.
  useReadErc1155InstanceGatingModule: () => ({ data: MODULE }),
  useReadErc1155InstanceGatingScope: () => ({ data: 0 }),
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
  useMerkleAllowlistProof: () => ({
    status: allowlist.status,
    proof: allowlist.status === 'eligible' ? ([] as `0x${string}`[]) : undefined,
    maxQty: allowlist.maxQtyNfts,
    maxQtyNfts: allowlist.maxQtyNfts,
    claimedNfts:
      allowlist.maxQtyNfts !== undefined && allowlist.remainingNfts !== undefined
        ? allowlist.maxQtyNfts - allowlist.remainingNfts
        : undefined,
    remainingNfts: allowlist.remainingNfts,
  }),
}))

const EDITION = { id: 0n, openTime: 0n } as unknown as EditionView

afterEach(() => {
  cleanup()
  writeContract.mockClear()
  allowlist.status = 'eligible'
  allowlist.maxQtyNfts = CAP
  allowlist.remainingNfts = CAP
})

function mount(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MintPanel instance={INSTANCE} edition={EDITION} refetch={vi.fn()} />
    </QueryClientProvider>,
  )
}

const mintButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'mint' }) as HTMLButtonElement
const statusLine = (): string =>
  screen.getByTestId('erc1155-mint-allowlist-status').textContent ?? ''

function setAmount(n: number): void {
  fireEvent.change(screen.getByLabelText('mint amount'), { target: { value: String(n) } })
}

test('a wallet that has minted nothing is offered its whole cap', () => {
  mount()
  expect(statusLine()).toMatch(/5 of 5 left for this wallet/)
  expect(mintButton().disabled).toBe(false)
  expect(screen.queryByTestId('erc1155-mint-allowlist-over-cap')).toBeNull()
})

test('a partly-claimed wallet is told what is LEFT, not the lifetime cap', () => {
  // The defect, exactly: allowlisted for 5, already minted 3. The old line said "up to 5 per wallet".
  allowlist.remainingNfts = 2n
  mount()
  expect(statusLine()).toMatch(/2 of 5 left for this wallet/)
  expect(statusLine()).not.toMatch(/up to 5/)
})

test('a wallet at its cap cannot enable the mint button', () => {
  allowlist.remainingNfts = 0n
  mount()
  expect(mintButton().disabled).toBe(true)
  expect(statusLine()).toMatch(/0 of 5 left for this wallet/)
  expect(screen.getByTestId('erc1155-mint-allowlist-over-cap').textContent).toMatch(
    /minted its whole allowance/i,
  )
})

test('an amount above what is left is refused before signing, and says by how much', () => {
  allowlist.remainingNfts = 2n
  mount()
  expect(mintButton().disabled).toBe(false)
  setAmount(3)
  expect(mintButton().disabled).toBe(true)
  expect(screen.getByTestId('erc1155-mint-allowlist-over-cap').textContent).toMatch(
    /lower the amount to 2/,
  )
  // The button is the visible half; the write must be unreachable too, not merely un-clickable.
  fireEvent.click(mintButton())
  expect(writeContract).not.toHaveBeenCalled()
})

test('an amount exactly equal to what is left is still allowed', () => {
  // The floor must not be off by one: `claimed + amount > maxQty` reverts, `==` does not.
  allowlist.remainingNfts = 2n
  mount()
  setAmount(2)
  expect(mintButton().disabled).toBe(false)
  expect(screen.queryByTestId('erc1155-mint-allowlist-over-cap')).toBeNull()
})

test('an unreadable claimed counter blocks the mint rather than falling back to the cap', () => {
  // Failing open here would restore the whole defect on any RPC hiccup: the panel would print the
  // lifetime cap again and enable a button the chain refuses.
  allowlist.remainingNfts = undefined
  mount()
  expect(mintButton().disabled).toBe(true)
  expect(statusLine()).toMatch(/checking what this wallet has already minted/i)
  fireEvent.click(mintButton())
  expect(writeContract).not.toHaveBeenCalled()
})

test('a wallet that is not on the list is unchanged by any of this', () => {
  allowlist.status = 'not-eligible'
  allowlist.maxQtyNfts = undefined
  allowlist.remainingNfts = undefined
  mount()
  expect(mintButton().disabled).toBe(true)
  expect(statusLine()).toMatch(/not on the allowlist/i)
  expect(screen.queryByTestId('erc1155-mint-allowlist-over-cap')).toBeNull()
})
