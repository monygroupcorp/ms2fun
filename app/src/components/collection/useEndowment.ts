/**
 * useEndowment — reads AlignmentEndowmentVault state for a single benefactor (collection instance).
 * Only meaningful for AaveEndowment vaults; callers should check isEndowment before rendering.
 *
 * One pooled principal, one flat 80/19/1 split, forever. There is no vesting, no escrow class, no
 * maturity clock: a benefactor's `principalOf` is their live share of the pool and only falls when
 * the curated target actually withdraws it (`execute`) or the target de-curates and the corpus is
 * released to the community. `principalOf == 0` therefore means the target has taken everything this
 * benefactor put in — not that it "fully vested".
 */
import { useCallback } from 'react'
import {
  useReadAlignmentEndowmentVaultVaultType,
  useReadAlignmentEndowmentVaultPrincipalOf,
  useReadAlignmentEndowmentVaultAccumulatedFees,
  useReadAlignmentEndowmentVaultTotalPrincipalLocked,
  useReadAlignmentEndowmentVaultTargetId,
  useReadAlignmentEndowmentVaultPendingYieldOf,
  useReadAlignmentEndowmentVaultAccumulatedTargetFees,
  useReadAlignmentEndowmentVaultRoundResidue,
  useReadAlignmentRegistryV1GetCommunityPayout,
} from '../../generated/contracts'
import { forkAddresses } from '../../lib/addresses'
import { useCollectionChainId } from './useCollectionChain'

export interface EndowmentState {
  isEndowment: boolean
  /** This benefactor's live pooled principal (`principalOf`). Falls only when the target withdraws
   *  it, never on any clock — it is permanent until physically deployed. */
  principal: bigint
  yield: bigint
  /**
   * THIS benefactor's claimable creator yield (`pendingYieldOf`) — settled purse plus the accrual
   * still live on their principal weight. Distinct from `yield`, which is the vault-wide accumulator:
   * one collection's creator can only ever pull this.
   */
  claimable: bigint
  /**
   * Target-leg yield the vault accrued while the community sink was unset. Permissionless to
   * deliver (`flushTargetFees`) once a sink exists; it keeps accruing until then.
   */
  undeliveredTargetFees: bigint
  /** Corpus residue left over from a closed round (redeemed out of the position already, not yet
   *  delivered). Flushable to the community sink while curated (`flushRoundResidue`), swept into
   *  the same delivery as everything else once the target de-curates. */
  roundResidue: bigint
  /** Live principal across all benefactors (`totalPrincipalLocked`). */
  totalPrincipal: bigint
  /** Where this vault's community leg is owed, read from the alignment registry rather than from the
   *  vault. The vault holds no sink of its own — it resolves this same registry answer at send time —
   *  so this is the address the money actually reaches, and the one the community can rotate. */
  communityPayout: `0x${string}` | undefined
  isPending: boolean
  refetch: () => void
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export function useEndowment(
  vault: `0x${string}` | undefined,
  benefactor: `0x${string}` | undefined,
): EndowmentState {
  const chainId = useCollectionChainId()
  const enabled = !!vault

  const { data: vaultType, isPending: typePending } = useReadAlignmentEndowmentVaultVaultType({
    ...(vault ? { address: vault } : {}),
    chainId,
    query: { enabled },
  })

  const isEndowment = vaultType === 'AaveEndowment'

  const {
    data: principal,
    isPending: principalPending,
    refetch: refetchPrincipal,
  } = useReadAlignmentEndowmentVaultPrincipalOf({
    ...(vault ? { address: vault } : {}),
    chainId,
    args: [benefactor ?? ZERO_ADDRESS],
    query: { enabled: enabled && !!benefactor && isEndowment },
  })

  const {
    data: accumulatedFees,
    isPending: feesPending,
    refetch: refetchFees,
  } = useReadAlignmentEndowmentVaultAccumulatedFees({
    ...(vault ? { address: vault } : {}),
    chainId,
    query: { enabled: enabled && isEndowment },
  })

  const { data: totalPrincipal, isPending: totalPending } =
    useReadAlignmentEndowmentVaultTotalPrincipalLocked({
      ...(vault ? { address: vault } : {}),
      chainId,
      query: { enabled: enabled && isEndowment },
    })

  const { data: targetId, isPending: targetPending } = useReadAlignmentEndowmentVaultTargetId({
    ...(vault ? { address: vault } : {}),
    chainId,
    query: { enabled: enabled && isEndowment },
  })

  const { data: communityPayout, isPending: communityPending } =
    useReadAlignmentRegistryV1GetCommunityPayout({
      address: forkAddresses.AlignmentRegistryV1,
      chainId,
      ...(targetId !== undefined ? { args: [targetId] as const } : {}),
      query: { enabled: enabled && isEndowment && targetId !== undefined },
    })

  const { data: claimable, refetch: refetchClaimable } =
    useReadAlignmentEndowmentVaultPendingYieldOf({
      ...(vault ? { address: vault } : {}),
      chainId,
      args: [benefactor ?? ZERO_ADDRESS],
      query: { enabled: enabled && !!benefactor && isEndowment },
    })

  const { data: undeliveredTargetFees, refetch: refetchTargetFees } =
    useReadAlignmentEndowmentVaultAccumulatedTargetFees({
      ...(vault ? { address: vault } : {}),
      chainId,
      query: { enabled: enabled && isEndowment },
    })

  const { data: roundResidue, refetch: refetchRoundResidue } =
    useReadAlignmentEndowmentVaultRoundResidue({
      ...(vault ? { address: vault } : {}),
      chainId,
      query: { enabled: enabled && isEndowment },
    })

  const refetch = useCallback(() => {
    void refetchPrincipal()
    void refetchFees()
    void refetchClaimable()
    void refetchTargetFees()
    void refetchRoundResidue()
  }, [refetchPrincipal, refetchFees, refetchClaimable, refetchTargetFees, refetchRoundResidue])

  const isPending =
    typePending ||
    (isEndowment &&
      (principalPending || feesPending || totalPending || targetPending || communityPending))

  return {
    isEndowment,
    principal: principal ?? 0n,
    yield: accumulatedFees ?? 0n,
    claimable: claimable ?? 0n,
    undeliveredTargetFees: undeliveredTargetFees ?? 0n,
    roundResidue: roundResidue ?? 0n,
    totalPrincipal: totalPrincipal ?? 0n,
    communityPayout:
      communityPayout !== undefined && communityPayout !== ZERO_ADDRESS
        ? communityPayout
        : undefined,
    isPending,
    refetch,
  }
}
