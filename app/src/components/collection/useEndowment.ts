/**
 * useEndowment — reads AlignmentEndowmentVault state for a single benefactor (collection instance).
 * Only meaningful for AaveEndowment vaults; callers should check isEndowment before rendering.
 */
import { useCallback } from 'react'
import {
  useReadAlignmentEndowmentVaultVaultType,
  useReadAlignmentEndowmentVaultPrincipal,
  useReadAlignmentEndowmentVaultDepositTime,
  useReadAlignmentEndowmentVaultAccumulatedFees,
  useReadAlignmentEndowmentVaultTotalPrincipal,
  useReadAlignmentEndowmentVaultCommunityPayout,
  useReadAlignmentEndowmentVaultMaturityDuration,
  useReadAlignmentEndowmentVaultCalculateClaimableAmount,
} from '../../generated/contracts'
import { forkChainId } from '../../lib/addresses'

export interface EndowmentState {
  isEndowment: boolean
  principal: bigint
  depositTime: bigint
  maturity: bigint
  matured: boolean
  yield: bigint
  /** Gross principal claimable via withdrawPrincipal — 0 while locked, gross at maturity. */
  claimable: bigint
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
  const enabled = !!vault

  const { data: vaultType, isPending: typePending } = useReadAlignmentEndowmentVaultVaultType({
    ...(vault ? { address: vault } : {}),
    chainId: forkChainId,
    query: { enabled },
  })

  const isEndowment = vaultType === 'AaveEndowment'

  const {
    data: principal,
    isPending: principalPending,
    refetch: refetchPrincipal,
  } = useReadAlignmentEndowmentVaultPrincipal({
    ...(vault ? { address: vault } : {}),
    chainId: forkChainId,
    args: [benefactor ?? ZERO_ADDRESS],
    query: { enabled: enabled && !!benefactor && isEndowment },
  })

  const { data: depositTime, isPending: depositPending } =
    useReadAlignmentEndowmentVaultDepositTime({
      ...(vault ? { address: vault } : {}),
      chainId: forkChainId,
      args: [benefactor ?? ZERO_ADDRESS],
      query: { enabled: enabled && !!benefactor && isEndowment },
    })

  const {
    data: accumulatedFees,
    isPending: feesPending,
    refetch: refetchFees,
  } = useReadAlignmentEndowmentVaultAccumulatedFees({
    ...(vault ? { address: vault } : {}),
    chainId: forkChainId,
    query: { enabled: enabled && isEndowment },
  })

  const { data: totalPrincipal, isPending: totalPending } =
    useReadAlignmentEndowmentVaultTotalPrincipal({
      ...(vault ? { address: vault } : {}),
      chainId: forkChainId,
      query: { enabled: enabled && isEndowment },
    })

  const { data: communityPayout, isPending: communityPending } =
    useReadAlignmentEndowmentVaultCommunityPayout({
      ...(vault ? { address: vault } : {}),
      chainId: forkChainId,
      query: { enabled: enabled && isEndowment },
    })

  const { data: maturityDuration, isPending: maturityPending } =
    useReadAlignmentEndowmentVaultMaturityDuration({
      ...(vault ? { address: vault } : {}),
      chainId: forkChainId,
      query: { enabled: enabled && isEndowment },
    })

  const {
    data: claimable,
    isPending: claimablePending,
    refetch: refetchClaimable,
  } = useReadAlignmentEndowmentVaultCalculateClaimableAmount({
    ...(vault ? { address: vault } : {}),
    chainId: forkChainId,
    args: [benefactor ?? ZERO_ADDRESS],
    query: { enabled: enabled && !!benefactor && isEndowment },
  })

  const refetch = useCallback(() => {
    void refetchPrincipal()
    void refetchFees()
    void refetchClaimable()
  }, [refetchPrincipal, refetchFees, refetchClaimable])

  const resolvedPrincipal = principal ?? 0n
  const resolvedDepositTime = depositTime ?? 0n
  const resolvedMaturityDuration = maturityDuration ?? 0n

  const maturity = resolvedDepositTime > 0n ? resolvedDepositTime + resolvedMaturityDuration : 0n

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
        maturityPending ||
        claimablePending))

  return {
    isEndowment,
    principal: resolvedPrincipal,
    depositTime: resolvedDepositTime,
    maturity,
    matured,
    yield: accumulatedFees ?? 0n,
    claimable: claimable ?? 0n,
    totalPrincipal: totalPrincipal ?? 0n,
    communityPayout: communityPayout ?? undefined,
    isPending,
    refetch,
  }
}
