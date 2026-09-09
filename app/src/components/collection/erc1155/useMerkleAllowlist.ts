/**
 * Mint-side merkle-proof resolution for an ERC1155 edition (noesis-080). Wraps the pure
 * `allowlistConfig.resolveMemberProof` in a React-Query hook: reads the instance's collection metadata
 * (the SAME `useCollectionMetadata` the collection page uses), finds the `allowlists` row for this
 * edition (tierIndex 0 — single-list authoring), and resolves the connected wallet's proof against it.
 *
 * `enabled` should be the caller's already-computed `isPaidMintGated`/`isFreeMintGated` result — when
 * false this hook does no work (status stays 'idle').
 *
 * `NO_QTY_SCALE`: an ERC-1155 instance forwards an NFT count to the gating module, so its leaves commit
 * the creator's number unscaled. The scale is passed explicitly rather than defaulted — see
 * `merkle.ts`'s `scaleQty` for why the ERC-404 twin of this hook must pass `unit()` instead.
 */
import { useAccount } from 'wagmi'
import type { Hex } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { useCollection } from '../../useCollection'
import { useCollectionMetadata } from '../../useCollectionMetadata'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { findAllowlistListURI, resolveMemberProof } from '../../../lib/collection/allowlistConfig'
import { NO_QTY_SCALE } from '../../../lib/merkle'

export type MerkleAllowlistStatus =
  | 'idle' // not gated, or wallet disconnected
  | 'no-list' // gated but the owner hasn't configured/persisted a listURI yet
  | 'loading'
  | 'eligible'
  | 'not-eligible'

export interface MerkleAllowlistResult {
  status: MerkleAllowlistStatus
  proof: Hex[] | undefined
  /** Leaf-denominated cap — what `encodeMerkleGatingData` takes. */
  maxQty: bigint | undefined
  /** The same cap in NFTs — what the panel shows the holder. Equal to `maxQty` on this family. */
  maxQtyNfts: bigint | undefined
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
      resolveMemberProof(listURI as string, address as `0x${string}`, NO_QTY_SCALE, signal),
  })

  const pending = { proof: undefined, maxQty: undefined, maxQtyNfts: undefined }
  if (!enabled || !address) return { status: 'idle', ...pending }
  if (!listURI) return { status: 'no-list', ...pending }
  if (isPending) return { status: 'loading', ...pending }
  if (!proofResult) return { status: 'not-eligible', ...pending }
  return {
    status: 'eligible',
    proof: proofResult.proof,
    maxQty: proofResult.maxQty,
    maxQtyNfts: proofResult.maxQtyNfts,
  }
}
