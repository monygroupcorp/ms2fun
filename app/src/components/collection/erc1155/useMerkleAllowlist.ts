/**
 * Mint-side merkle-proof resolution for an ERC1155 edition (noesis-080). Wraps the pure
 * `allowlistConfig.resolveMemberProof` in a React-Query hook: reads the instance's collection metadata
 * (the SAME `useCollectionMetadata` the collection page uses), finds the `allowlists` row for this
 * edition (tierIndex 0 — single-list authoring), and resolves the connected wallet's proof against it.
 *
 * `enabled` should be the caller's already-computed `isPaidMintGated`/`isFreeMintGated` result — when
 * false this hook does no work (status stays 'idle').
 */
import { useAccount } from 'wagmi'
import type { Hex } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { useCollection } from '../../useCollection'
import { useCollectionMetadata } from '../../useCollectionMetadata'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { findAllowlistListURI, resolveMemberProof } from '../../../lib/collection/allowlistConfig'

export type MerkleAllowlistStatus =
  | 'idle' // not gated, or wallet disconnected
  | 'no-list' // gated but the owner hasn't configured/persisted a listURI yet
  | 'loading'
  | 'eligible'
  | 'not-eligible'

export interface MerkleAllowlistResult {
  status: MerkleAllowlistStatus
  proof: Hex[] | undefined
  maxQty: bigint | undefined
}

export function useMerkleAllowlistProof(
  instance: `0x${string}`,
  editionId: bigint,
  enabled: boolean,
): MerkleAllowlistResult {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const { address } = useAccount()
  const { data: card } = useCollection(instance, { chainId, addresses })
  const metadata = useCollectionMetadata(card?.metadataURI)
  const listURI = findAllowlistListURI(metadata, Number(editionId))

  const { data: proofResult, isPending } = useQuery({
    queryKey: ['merkle-allowlist-proof', instance, editionId.toString(), listURI, address],
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
