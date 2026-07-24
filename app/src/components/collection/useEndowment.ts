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
  depositTime: bigint
  /** Vest completion time = `depositTime + VEST_DURATION`; escrowed principal vests to the target then. */
  maturity: bigint
  /** True once the vest window has elapsed (principal has vested / is vestable to the target). */
  matured: boolean
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

  const maturity = resolvedDepositTime > 0n ? resolvedDepositTime + resolvedVestDuration : 0n

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000))
  const matured = resolvedDepositTime > 0n && nowSeconds >= maturity

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
    maturity,
    matured,
    yield: accumulatedFees ?? 0n,
    totalPrincipal: totalPrincipal ?? 0n,
    communityPayout: communityPayout ?? undefined,
    isPending,
    refetch,
  }
}
