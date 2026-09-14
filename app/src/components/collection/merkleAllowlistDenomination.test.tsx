/**
 * The mint-side wiring of the allowlist cap's denomination (noesis-266).
 *
 * `lib/collection/allowlistConfig.test.ts` pins the arithmetic: one scale function, applied to both the
 * tree and the proof. What it cannot see is which scale each family's hook actually hands it, and that
 * is the whole defect — the ERC-404 leg fed the module a cap in NFTs while the instance forwarded coin.
 * So this walks the real path both gated ERC-404 surfaces use (`SwapPanel`'s buy and `FreeMintPanel`
 * both call this one hook) from a creator's typed row through to the numbers the panel encodes and the
 * number it shows, and does the same for the ERC-1155 twin, which must stay unscaled.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  buildAllowlistFromPaste,
  isAllowlistBuildError,
} from '../../lib/collection/allowlistConfig'

const INSTANCE = '0x2222222222222222222222222222222222222222' as const
const HOLDER = '0x1111111111111111111111111111111111111111' as const
/** `unit()` — coin per whole NFT on a shipped ERC404 bonding instance. */
const UNIT = 10n ** 24n

const state = vi.hoisted(() => ({
  unit: undefined as bigint | undefined,
  listURI: '' as string,
  list: undefined as unknown,
}))

vi.mock('wagmi', () => ({ useAccount: () => ({ address: HOLDER }) }))
vi.mock('../useCollection', () => ({
  useCollection: () => ({ data: { metadataURI: 'ipfs://x' } }),
}))
vi.mock('../useCollectionMetadata', () => ({
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
vi.mock('./useCollectionChain', () => ({
  useCollectionChainId: () => 31337,
  useCollectionAddresses: () => ({}),
}))
vi.mock('../../generated/contracts', () => ({
  useReadErc404BondingInstanceUnit: () => ({ data: state.unit }),
}))
vi.mock('../../lib/metadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/metadata')>()
  return { ...actual, fetchJson: async () => ({ status: 'found', data: state.list }) }
})

const { useMerkleAllowlistProof: useErc404Proof } = await import('./erc404/useMerkleAllowlist')
const { useMerkleAllowlistProof: useErc1155Proof } = await import('./erc1155/useMerkleAllowlist')

let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** What the creator does: type `address,NFTs` into the admin panel and let it self-host the list. */
function creatorPastes(row: string, qtyScale: bigint): void {
  const built = buildAllowlistFromPaste(row, qtyScale)
  if (isAllowlistBuildError(built)) throw new Error(built.error)
  state.listURI = built.listURI
  state.list = built.entries.map((e) => ({ address: e.address, maxQty: e.maxQty.toString() }))
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  state.unit = UNIT
})
afterEach(() => {
  cleanup()
  client.clear()
})

describe('merkle allowlist denomination, mint side', () => {
  it('ERC-404: a creator cap of 5 NFTs is encoded as 5 * unit and shown as 5', async () => {
    creatorPastes(`${HOLDER},5`, UNIT)
    const view = renderHook(() => useErc404Proof(INSTANCE, true), { wrapper })
    await waitFor(() => expect(view.result.current.status).toBe('eligible'))

    // `maxQty` is what SwapPanel/FreeMintPanel abi-encode into gatingData; the module compares it
    // against a coin amount, so 5 here would revert QtyCapExceeded on any real purchase.
    expect(view.result.current.maxQty).toBe(5n * UNIT)
    // `maxQtyNfts` is what those panels render — the number the creator actually typed.
    expect(view.result.current.maxQtyNfts).toBe(5n)
  })

  it('ERC-404: nothing is resolved before unit() lands — a wrong scale is never guessed', async () => {
    creatorPastes(`${HOLDER},5`, UNIT)
    state.unit = undefined
    const view = renderHook(() => useErc404Proof(INSTANCE, true), { wrapper })

    // Not 'not-eligible', which would tell a listed holder they are off the list, and not a proof
    // resolved at scale 1, which the module would silently reject.
    expect(view.result.current.status).toBe('loading')
    expect(view.result.current.proof).toBeUndefined()
    expect(view.result.current.maxQty).toBeUndefined()
  })

  it('ERC-1155: the same cap of 5 stays 5 — this family forwards an NFT count', async () => {
    creatorPastes(`${HOLDER},5`, 1n)
    const view = renderHook(() => useErc1155Proof(INSTANCE, 0n, true), { wrapper })
    await waitFor(() => expect(view.result.current.status).toBe('eligible'))

    expect(view.result.current.maxQty).toBe(5n)
    expect(view.result.current.maxQtyNfts).toBe(5n)
  })
})
