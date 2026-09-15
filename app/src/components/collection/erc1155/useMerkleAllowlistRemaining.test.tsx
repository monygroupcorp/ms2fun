/**
 * The ERC-1155 allowlist hook reports what is LEFT, read off the chain (noesis-280).
 *
 * `mintPanelAllowlistRemaining.test.tsx` pins what the panel does with `remainingNfts`; this pins
 * where the number comes from. `MerkleGatingModule.claimed` is public and edition-scoped, and the
 * module compares `claimed + amount` against the leaf cap — so the hook subtracts one from the other
 * rather than handing the panel a lifetime cap to describe as a budget.
 *
 * The subtraction is only sound because this family forwards an NFT count (`NO_QTY_SCALE`), which
 * puts `claimed` and `maxQtyNfts` in the same unit. That premise is what
 * `merkleAllowlistDenomination.test.tsx` holds, and it is why the ERC-404 twin cannot copy this.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  buildAllowlistFromPaste,
  isAllowlistBuildError,
} from '../../../lib/collection/allowlistConfig'
import { NO_QTY_SCALE } from '../../../lib/merkle'

const INSTANCE = '0x2222222222222222222222222222222222222222' as const
const HOLDER = '0x1111111111111111111111111111111111111111' as const

const state = vi.hoisted(() => ({
  listURI: '' as string,
  list: undefined as unknown,
  gatingModule: '0x3333333333333333333333333333333333333333' as `0x${string}` | undefined,
  claimed: 0n as bigint | undefined,
  claimedPending: false,
}))

vi.mock('wagmi', () => ({ useAccount: () => ({ address: HOLDER }) }))
vi.mock('../../useCollection', () => ({
  useCollection: () => ({ data: { metadataURI: 'ipfs://x' } }),
}))
vi.mock('../../useCollectionMetadata', () => ({
  useCollectionMetadata: () => ({
    schemaVersion: 1,
    name: 'x',
    description: '',
    image: '',
    banner: '',
    category: '',
    links: [],
    allowlists: [{ editionId: 0, tierIndex: 0, listURI: state.listURI }],
  }),
}))
vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 31337,
  useCollectionAddresses: () => ({}),
}))
vi.mock('../../../generated/contracts', () => ({
  useReadErc1155InstanceGatingModule: () => ({ data: state.gatingModule }),
  useReadMerkleGatingModuleClaimed: () => ({
    data: state.claimed,
    isPending: state.claimedPending,
  }),
}))
vi.mock('../../../lib/metadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/metadata')>()
  return { ...actual, fetchJson: async () => ({ status: 'found', data: state.list }) }
})

const { useMerkleAllowlistProof } = await import('./useMerkleAllowlist')

let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** The creator types `address,NFTs` into the admin panel; this family roots the tree unscaled. */
function creatorAllows(nfts: number): void {
  const built = buildAllowlistFromPaste(`${HOLDER},${nfts}`, NO_QTY_SCALE)
  if (isAllowlistBuildError(built)) throw new Error(built.error)
  state.listURI = built.listURI
  state.list = built.entries.map((e) => ({ address: e.address, maxQty: e.maxQty.toString() }))
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  state.gatingModule = '0x3333333333333333333333333333333333333333'
  state.claimed = 0n
  state.claimedPending = false
})
afterEach(() => {
  cleanup()
  client.clear()
})

async function resolved() {
  const view = renderHook(() => useMerkleAllowlistProof(INSTANCE, 0n, true), { wrapper })
  await waitFor(() => expect(view.result.current.status).toBe('eligible'))
  return view.result.current
}

test('an untouched wallet has its whole cap remaining', async () => {
  creatorAllows(5)
  const r = await resolved()
  expect(r.maxQtyNfts).toBe(5n)
  expect(r.claimedNfts).toBe(0n)
  expect(r.remainingNfts).toBe(5n)
})

test('what the wallet already minted is subtracted from the cap', async () => {
  creatorAllows(5)
  state.claimed = 3n
  const r = await resolved()
  // The cap is unchanged — it is a lifetime number and stays reportable as one.
  expect(r.maxQtyNfts).toBe(5n)
  expect(r.remainingNfts).toBe(2n)
})

test('a wallet at its cap has zero remaining, not a negative', async () => {
  creatorAllows(5)
  state.claimed = 5n
  const r = await resolved()
  expect(r.remainingNfts).toBe(0n)
})

test('a counter past the cap floors at zero rather than wrapping', async () => {
  // bigint subtraction does not wrap, but it does go negative, and a negative remaining compared
  // against an amount would read as "nothing is over the limit". The floor is deliberate.
  creatorAllows(5)
  state.claimed = 7n
  const r = await resolved()
  expect(r.remainingNfts).toBe(0n)
})

test('the hook stays loading while the claimed counter is in flight', async () => {
  creatorAllows(5)
  // Resolve the proof once first so it is cached on `client`. Without this the assertion below is
  // vacuous — every render of this hook begins at 'loading' while the merkle query is in flight, so
  // a hook that never reads `claimed` at all would satisfy it on its first frame.
  await resolved()
  cleanup()
  state.claimedPending = true
  state.claimed = undefined

  const view = renderHook(() => useMerkleAllowlistProof(INSTANCE, 0n, true), { wrapper })
  await waitFor(() => expect(view.result.current.status).toBe('loading'))
  // Not 'eligible' with the cap standing in for the remainder — that is the defect, restored.
  expect(view.result.current.remainingNfts).toBeUndefined()
})

test('an unreadable counter leaves remaining undefined rather than defaulting to the cap', async () => {
  // A fail-closed guard rather than a reproduction: the hook before this change also had no
  // `remainingNfts`, so this case cannot go red against it. It exists to keep a later "default to
  // the cap when the read fails" from passing review — that default is the whole defect returning.
  creatorAllows(5)
  state.claimed = undefined
  const r = await resolved()
  expect(r.maxQtyNfts).toBe(5n)
  expect(r.claimedNfts).toBeUndefined()
  expect(r.remainingNfts).toBeUndefined()
})
