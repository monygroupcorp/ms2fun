/**
 * Mint-side merkle-proof resolution for an ERC404 bonding instance (noesis-080) — the erc404 twin of
 * `erc1155/useMerkleAllowlist.ts`. ERC404 has no per-edition concept (single curve), so the allowlist
 * row is always looked up at `(editionId 0, tierIndex 0)`.
 */
import { useAccount } from 'wagmi'
import type { Hex } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { useCollection } from '../../useCollection'
import { useCollectionMetadata } from '../../useCollectionMetadata'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { findAllowlistListURI, resolveMemberProof } from '../../../lib/collection/allowlistConfig'

export type MerkleAllowlistStatus = 'idle' | 'no-list' | 'loading' | 'eligible' | 'not-eligible'

export interface MerkleAllowlistResult {
  status: MerkleAllowlistStatus
  proof: Hex[] | undefined
  maxQty: bigint | undefined
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

  const { data: proofResult, isPending } = useQuery({
    queryKey: ['merkle-allowlist-proof', instance, listURI, address],
    enabled: enabled && !!listURI && !!address,
    queryFn: async ({ signal }) =>
      resolveMemberProof(listURI as string, address as `0x${string}`, signal),
  })

  if (!enabled || !address) return { status: 'idle', proof: undefined, maxQty: undefined }
  if (!listURI) return { status: 'no-list', proof: undefined, maxQty: undefined }
  if (isPending) return { status: 'loading', proof: undefined, maxQty: undefined }
  if (!proofResult) return { status: 'not-eligible', proof: undefined, maxQty: undefined }
  return { status: 'eligible', proof: proofResult.proof, maxQty: proofResult.maxQty }
}
