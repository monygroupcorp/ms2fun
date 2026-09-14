/**
 * Mint-side merkle-proof resolution for an ERC404 bonding instance (noesis-080) — the erc404 twin of
 * `erc1155/useMerkleAllowlist.ts`. ERC404 has no per-edition concept (single curve), so the allowlist
 * row is always looked up at `(editionId 0, tierIndex 0)`.
 *
 * DENOMINATION (noesis-266). This family forwards COIN to `MerkleGatingModule` — `buyBonding` forwards
 * the purchase amount, `claimFreeMint` forwards `unit` — so the leaf cap the module compares against is
 * coin at wei scale, while the creator authored NFTs. The proof is therefore resolved under the
 * instance's own `unit()`, the same scale the admin panel rooted the tree under, and the query does not
 * run until that read lands: resolving at the wrong scale yields a proof that silently fails to verify.
 */
import { useAccount } from 'wagmi'
import type { Hex } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { useCollection } from '../../useCollection'
import { useCollectionMetadata } from '../../useCollectionMetadata'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { findAllowlistListURI, resolveMemberProof } from '../../../lib/collection/allowlistConfig'
import { useReadErc404BondingInstanceUnit } from '../../../generated/contracts'

export type MerkleAllowlistStatus = 'idle' | 'no-list' | 'loading' | 'eligible' | 'not-eligible'

export interface MerkleAllowlistResult {
  status: MerkleAllowlistStatus
  proof: Hex[] | undefined
  /** Leaf-denominated cap (coin wei) — what `encodeMerkleGatingData` takes. */
  maxQty: bigint | undefined
  /** The same cap in NFTs, as the creator authored it — what the panel shows the holder. */
  maxQtyNfts: bigint | undefined
}

export function useMerkleAllowlistProof(
  instance: `0x${string}`,
  enabled: boolean,
): MerkleAllowlistResult {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const { address } = useAccount()
  const { data: card } = useCollection(instance, { chainId, addresses })
  const metadata = useCollectionMetadata(card?.metadataURI)
  const listURI = findAllowlistListURI(metadata, 0)
  const { data: unit } = useReadErc404BondingInstanceUnit({ address: instance, chainId })

  const { data: proofResult, isPending } = useQuery({
    queryKey: ['merkle-allowlist-proof', instance, listURI, address, unit?.toString()],
    enabled: enabled && !!listURI && !!address && unit !== undefined,
    queryFn: async ({ signal }) =>
      resolveMemberProof(listURI as string, address as `0x${string}`, unit as bigint, signal),
  })

  const pending = { proof: undefined, maxQty: undefined, maxQtyNfts: undefined }
  if (!enabled || !address) return { status: 'idle', ...pending }
  if (!listURI) return { status: 'no-list', ...pending }
  // `unit()` not landed yet is 'loading', not 'not-eligible' — the query is still disabled.
  if (isPending || unit === undefined) return { status: 'loading', ...pending }
  if (!proofResult) return { status: 'not-eligible', ...pending }
  return {
    status: 'eligible',
    proof: proofResult.proof,
    maxQty: proofResult.maxQty,
    maxQtyNfts: proofResult.maxQtyNfts,
  }
}
