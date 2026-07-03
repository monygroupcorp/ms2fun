/**
 * useVaultsSummary — one multicall for the vaults index (`/vaults`). For each vault we read
 * vaultType + totalPrincipal + accumulatedFees in a single batched `useReadContracts`, so the list
 * renders each row's TVL/type without a hook per row (which would break hook-order as the vault set
 * loads in). totalPrincipal only resolves for endowment vaults (LP vaults revert it → allowFailure
 * leaves it undefined); the page-level TVL total sums only the endowment principals.
 */
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { alignmentEndowmentVaultAbi } from '../../generated/contracts'
import { forkChainId } from '../addresses'

export interface VaultSummary {
  vaultType: string | undefined
  /** Endowment TVL; undefined for LP vaults. */
  totalPrincipal: bigint | undefined
  accumulatedFees: bigint | undefined
}

export function useVaultsSummary(addresses: readonly `0x${string}`[]): {
  byAddress: Map<string, VaultSummary>
  /** Sum of endowment principals (the honest TVL — LP positions aren't valued). */
  endowmentTvl: bigint
  isPending: boolean
} {
  const contracts = useMemo(
    () =>
      addresses.flatMap((address) => [
        { address, abi: alignmentEndowmentVaultAbi, functionName: 'vaultType', chainId: forkChainId },
        { address, abi: alignmentEndowmentVaultAbi, functionName: 'totalPrincipal', chainId: forkChainId },
        { address, abi: alignmentEndowmentVaultAbi, functionName: 'accumulatedFees', chainId: forkChainId },
      ] as const),
    [addresses],
  )

  const { data, isPending } = useReadContracts({
    allowFailure: true,
    contracts,
    query: { enabled: addresses.length > 0 },
  })

  return useMemo(() => {
    const byAddress = new Map<string, VaultSummary>()
    let endowmentTvl = 0n
    addresses.forEach((address, i) => {
      const typeRes = data?.[i * 3]
      const principalRes = data?.[i * 3 + 1]
      const feesRes = data?.[i * 3 + 2]
      const vaultType = typeRes?.status === 'success' ? (typeRes.result as string) : undefined
      const totalPrincipal =
        vaultType === 'AaveEndowment' && principalRes?.status === 'success'
          ? (principalRes.result as bigint)
          : undefined
      const accumulatedFees = feesRes?.status === 'success' ? (feesRes.result as bigint) : undefined
      if (totalPrincipal !== undefined) endowmentTvl += totalPrincipal
      byAddress.set(address.toLowerCase(), { vaultType, totalPrincipal, accumulatedFees })
    })
    return { byAddress, endowmentTvl, isPending: isPending && addresses.length > 0 }
  }, [addresses, data, isPending])
}
