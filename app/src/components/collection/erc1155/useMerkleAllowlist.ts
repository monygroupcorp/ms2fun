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
 *
 * REMAINING, not the cap (noesis-280). The leaf cap is a LIFETIME per-wallet number; the module
 * enforces it against a cumulative counter (`MerkleGatingModule.claimed`, keyed by instance/edition/
 * user and bumped by `onMint` on BOTH the paid and the free-claim path), so after a wallet's first
 * mint the cap and what it may still mint diverge. The counter is public and on the ABI, so the hook
 * reads it and hands callers `remainingNfts`; a panel that shows the cap instead promises a quantity
 * the chain will refuse with `QtyCapExceeded`. `claimed` is denominated in whatever the instance
 * forwards — NFTs here, because of `NO_QTY_SCALE` above, which is exactly why the ERC-404 twin cannot
 * copy this subtraction without scaling by `unit()` first.
 */
import { useAccount } from 'wagmi'
import type { Hex } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { useCollection } from '../../useCollection'
import { useCollectionMetadata } from '../../useCollectionMetadata'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { findAllowlistListURI, resolveMemberProof } from '../../../lib/collection/allowlistConfig'
import {
  useReadErc1155InstanceGatingModule,
  useReadMerkleGatingModuleClaimed,
} from '../../../generated/contracts'
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
  /** The same cap in NFTs — equal to `maxQty` on this family. The LIFETIME cap, not a budget. */
  maxQtyNfts: bigint | undefined
  /** What this wallet has already minted against that cap, in NFTs, read off the module. */
  claimedNfts: bigint | undefined
  /** `maxQtyNfts - claimedNfts`, floored at 0 — what the wallet may still mint NOW. */
  remainingNfts: bigint | undefined
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
  const { data: gatingModule } = useReadErc1155InstanceGatingModule({ address: instance, chainId })

  // The cumulative counter the module enforces the cap against. Disabled until we know both the
  // module address and the wallet; when disabled react-query reports `isPending` forever, so the
  // loading branch below tests `claimedEnabled` alongside it rather than the flag alone.
  const claimedEnabled = enabled && !!address && !!gatingModule
  const { data: claimedNfts, isPending: claimedPending } = useReadMerkleGatingModuleClaimed({
    ...(gatingModule ? { address: gatingModule } : {}),
    chainId,
    args: address ? [instance, editionId, address] : undefined,
    query: { enabled: claimedEnabled },
  })

  const { data: proofResult, isPending } = useQuery({
    queryKey: ['merkle-allowlist-proof', instance, editionId.toString(), listURI, address],
    enabled: enabled && !!listURI && !!address,
    queryFn: async ({ signal }) =>
      resolveMemberProof(listURI as string, address as `0x${string}`, NO_QTY_SCALE, signal),
  })

  const pending = {
    proof: undefined,
    maxQty: undefined,
    maxQtyNfts: undefined,
    claimedNfts: undefined,
    remainingNfts: undefined,
  }
  if (!enabled || !address) return { status: 'idle', ...pending }
  if (!listURI) return { status: 'no-list', ...pending }
  if (isPending || (claimedEnabled && claimedPending)) return { status: 'loading', ...pending }
  if (!proofResult) return { status: 'not-eligible', ...pending }
  // A failed `claimed` read leaves `remainingNfts` undefined rather than defaulting to the cap: the
  // caller gates on it, so an unreadable counter must block the mint, not wave it through.
  const remainingNfts =
    claimedNfts === undefined
      ? undefined
      : proofResult.maxQtyNfts > claimedNfts
        ? proofResult.maxQtyNfts - claimedNfts
        : 0n
  return {
    status: 'eligible',
    proof: proofResult.proof,
    maxQty: proofResult.maxQty,
    maxQtyNfts: proofResult.maxQtyNfts,
    claimedNfts,
    remainingNfts,
  }
}
