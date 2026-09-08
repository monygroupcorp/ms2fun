/**
 * useEndowment — reads AlignmentEndowmentVault state for a single benefactor (collection instance).
 * Only meaningful for AaveEndowment vaults; callers should check isEndowment before rendering.
 */
import { useCallback } from 'react'
import {
  useReadAlignmentEndowmentVaultVaultType,
  useReadAlignmentEndowmentVaultPrincipalOf,
  useReadAlignmentEndowmentVaultDepositTime,
  useReadAlignmentEndowmentVaultAccumulatedFees,
  useReadAlignmentEndowmentVaultTotalPrincipalLocked,
  useReadAlignmentEndowmentVaultCommunityPayout,
  useReadAlignmentEndowmentVaultVestDuration,
} from '../../generated/contracts'
import { useCollectionChainId } from './useCollectionChain'

export interface EndowmentState {
  isEndowment: boolean
  /** This benefactor's live escrowed (pre-vest) principal (`principalOf`); drops to 0 once vested. */
  principal: bigint
  /** FIRST-deposit timestamp only. The vault gives every deposit its own clock, so this is not the
   *  clock the whole holding runs on — see `earliestMaturity`. */
  depositTime: bigint
  /** The vault's per-tranche vest window (`VEST_DURATION`), in seconds. */
  vestDuration: bigint
  /** The EARLIEST time any of this benefactor's principal can vest = `depositTime + VEST_DURATION`.
   *  Deposits made after the first vest later, each on its own clock, and the vault exposes no view
   *  of those clocks (`_escrowTranches` is internal), so a true next maturity is not computable here. */
  earliestMaturity: bigint
  /** True only when nothing of this benefactor's principal is still escrowed (`principalOf == 0`).
   *  This is the only completed-vest claim the app can make from what the vault exposes: a past
   *  `earliestMaturity` says the first tranche could vest, never that every tranche has. */
  fullyVested: boolean
  yield: bigint
  /** Live escrowed principal across all benefactors (`totalPrincipalLocked`). */
  totalPrincipal: bigint
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

  const { data: depositTime, isPending: depositPending } =
    useReadAlignmentEndowmentVaultDepositTime({
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

  const { data: communityPayout, isPending: communityPending } =
    useReadAlignmentEndowmentVaultCommunityPayout({
      ...(vault ? { address: vault } : {}),
      chainId,
      query: { enabled: enabled && isEndowment },
    })

  const { data: vestDuration, isPending: maturityPending } =
    useReadAlignmentEndowmentVaultVestDuration({
      ...(vault ? { address: vault } : {}),
      chainId,
      query: { enabled: enabled && isEndowment },
    })

  const refetch = useCallback(() => {
    void refetchPrincipal()
    void refetchFees()
  }, [refetchPrincipal, refetchFees])

  const resolvedPrincipal = principal ?? 0n
  const resolvedDepositTime = depositTime ?? 0n
  const resolvedVestDuration = vestDuration ?? 0n

  const earliestMaturity =
    resolvedDepositTime > 0n ? resolvedDepositTime + resolvedVestDuration : 0n

  // `matured` used to be `now >= depositTime + VEST_DURATION`, which asserts the whole holding has
  // vested on the strength of the FIRST deposit's clock. Every deposit vests independently, so the
  // only completed-vest claim the exposed state supports is "nothing is escrowed any more".
  const fullyVested = resolvedDepositTime > 0n && resolvedPrincipal === 0n

  const isPending =
    typePending ||
    (isEndowment &&
      (principalPending ||
        depositPending ||
        feesPending ||
        totalPending ||
        communityPending ||
        maturityPending))

  return {
    isEndowment,
    principal: resolvedPrincipal,
    depositTime: resolvedDepositTime,
    vestDuration: resolvedVestDuration,
    earliestMaturity,
    fullyVested,
    yield: accumulatedFees ?? 0n,
    totalPrincipal: totalPrincipal ?? 0n,
    communityPayout: communityPayout ?? undefined,
    isPending,
    refetch,
  }
}
