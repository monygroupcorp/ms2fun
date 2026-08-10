/**
 * The shared read layer for a connected holder's Token Tiers position on a tiered ERC-404: the
 * ladder, which owned ids are band ids and at what weight, what the holder truly holds versus what
 * they can transfer, and what is waiting in the escrow-release queue. Three surfaces (the tier panel,
 * the portfolio/swap readout, the debit warning) all need these same facts — this hook is the one
 * place they read them from, so they cannot drift from each other or from the contract.
 *
 * **`balance` (transferable) is the PRIMARY read and stays that way** (rth, 2026-08-10). `holdings`
 * (`coinBalanceOf`) is a display aggregate that sits beside it — never a substitute in a guard, a
 * quote, a limit, an amount sent to a contract, or any write path. `rerollMath.ts:19` is the existing
 * precedent for this rule; it applies here too, to every one of this hook's consumers.
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import {
  erc404BondingInstanceAbi,
  useReadErc404BondingInstanceCoinBalanceOf,
  useReadErc404BondingInstancePendingEscrowRelease,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { useErc404OwnedPieces } from './useErc404OwnedPieces'
import { bandOf, coinHoldings, type TierBand } from './tierPosition'

/** Defensive upper bound on the ladder-probe loop below. Sealed ladders run 2-3 rungs in practice
 *  (contracts/src/factories/erc404/ERC404BondingStorage.sol); this only guards against a malformed
 *  response looping forever, never a real ladder size. */
const MAX_PROBE_BANDS = 64

export interface TierPositionBandPiece {
  id: bigint
  /** 1-based tier number. */
  tierN: number
  weight: bigint
}

export interface TierPosition {
  /** True when this instance sealed a Token Tiers ladder. Untiered is the common case. */
  tiered: boolean
  /** The sealed ladder, empty when untiered or not yet loaded. */
  ladder: TierBand[]
  /** The holder's owned band pieces, with their tier and weight. Empty when untiered. */
  bandPieces: TierPositionBandPiece[]
  /** `balanceOf(holder)` — the transferable amount. See the module docstring: this is the read to
   *  use in a guard, a quote, or anything sent to a contract. Undefined until the read lands. */
  balance: bigint | undefined
  /** `coinBalanceOf(holder)` — "Holdings": balance plus the escrow behind every owned band piece.
   *  Authoritative for display. Undefined until the read lands. */
  holdings: bigint | undefined
  /** `holdings` reconstructed locally from `balance` and `bandPieces` (`coinHoldings`), for callers
   *  that must predict a position that does not exist on-chain yet (noesis-173's post-debit
   *  preview). Agrees with `holdings` once both have landed; `holdings` is authoritative for
   *  display. Undefined until its own inputs land. */
  localHoldings: bigint | undefined
  /** Coin waiting in the escrow-release queue (`pendingEscrowRelease`). Undefined until the read
   *  lands. */
  pendingEscrowRelease: bigint | undefined
  isPending: boolean
  refetch: () => void
}

/**
 * `(instance, holder) -> TierPosition` for any ERC-404 bonding instance, tiered or not.
 *
 * `tierBands` is a public array with no length getter, so the ladder is discovered by probing
 * `tierBands(0)`, `tierBands(1)`, … until the out-of-bounds revert — exact (Solidity dynamic-array
 * indices are dense, `0..length-1`, no gaps) and, for the untiered case that is every ERC-404 shipped
 * to date, exactly ONE call. `idLimit` is `totalSupply / unit`, not a contract function — reused from
 * `useErc404OwnedPieces`, which already derives it, rather than re-deriving it here (also reused for
 * the owned ids themselves; do not duplicate the Transfer-log replay).
 */
export function useTierPosition(
  instance: `0x${string}`,
  holder: `0x${string}` | undefined,
): TierPosition {
  const chainId = useCollectionChainId()
  const client = usePublicClient({ chainId })
  const owned = useErc404OwnedPieces(instance, holder)

  const { data: holdings } = useReadErc404BondingInstanceCoinBalanceOf({
    address: instance,
    chainId,
    args: holder ? [holder] : undefined,
    query: { enabled: !!holder },
  })

  const { data: pendingEscrowRelease } = useReadErc404BondingInstancePendingEscrowRelease({
    address: instance,
    chainId,
    args: holder ? [holder] : undefined,
    query: { enabled: !!holder },
  })

  const {
    data: ladder,
    isPending: ladderPending,
    refetch: refetchLadder,
  } = useQuery({
    queryKey: ['erc404-tier-ladder', chainId, instance],
    enabled: !!client,
    staleTime: Infinity, // sealed once, for the instance's life — never goes stale
    queryFn: async (): Promise<TierBand[]> => {
      if (!client) return []
      const bands: TierBand[] = []
      for (let i = 0; i < MAX_PROBE_BANDS; i++) {
        try {
          const [idStart, idEnd, weight] = await client.readContract({
            address: instance,
            abi: erc404BondingInstanceAbi,
            functionName: 'tierBands',
            args: [BigInt(i)],
          })
          // `tierBands` outputs are `uint32` — viem types them `number`; the ladder itself compares
          // against `bigint` NFT ids, so widen once here rather than at every comparison site.
          bands.push({ idStart: BigInt(idStart), idEnd: BigInt(idEnd), weight: BigInt(weight) })
        } catch {
          break // out-of-bounds revert — the ladder ends here
        }
      }
      return bands
    },
  })

  const tiered = (ladder?.length ?? 0) > 0

  const bandPieces: TierPositionBandPiece[] =
    tiered && ladder && owned.idLimit !== undefined
      ? owned.pieces.flatMap((piece) => {
          const info = bandOf(piece.id, ladder, owned.idLimit as bigint)
          return info ? [{ id: piece.id, tierN: info.tierN, weight: info.weight }] : []
        })
      : []

  const localHoldings =
    owned.balance !== undefined && owned.unit !== undefined
      ? coinHoldings(owned.balance, bandPieces, owned.unit)
      : undefined

  return {
    tiered,
    ladder: ladder ?? [],
    bandPieces,
    balance: owned.balance,
    holdings,
    localHoldings,
    pendingEscrowRelease,
    isPending: (owned.isPending && !!holder) || ladderPending,
    refetch: () => {
      owned.refetch()
      void refetchLadder()
    },
  }
}
