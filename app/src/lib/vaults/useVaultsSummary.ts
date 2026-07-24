/**
 * useVaultsSummary — one multicall for the vaults index (`/vaults`). For each vault we read
 * vaultType + totalPrincipal + accumulatedFees in a single batched `useReadContracts`, so the list
 * renders each row's TVL/type without a hook per row (which would break hook-order as the vault set
 * loads in). totalPrincipal only resolves for endowment vaults (LP vaults revert it → allowFailure
 * leaves it undefined); the page-level TVL total sums only the endowment principals.
 */
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { forkChainId } from '../addresses'

/**
 * Minimal ABI slice for the vaults-index multicall. The full `alignmentEndowmentVaultAbi` (now enlarged
 * with the vest/`execute` surface) trips TS2589 ("type instantiation is excessively deep") when
 * `useReadContracts` infers per-call return types over hundreds of fragments. We only read three view
 * functions here, so a three-entry const ABI keeps inference shallow while staying fully typed (no
 * `@ts-expect-error`, no `any`). Selectors verified against contracts/out/AlignmentEndowmentVault.
 */
const vaultSummaryAbi = [
  {
    type: 'function',
    name: 'vaultType',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'totalPrincipalLocked',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'accumulatedFees',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

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
      addresses.flatMap(
        (address) =>
          [
            {
              address,
              abi: vaultSummaryAbi,
              functionName: 'vaultType',
              chainId: forkChainId,
            },
            {
              address,
              abi: vaultSummaryAbi,
              functionName: 'totalPrincipalLocked',
              chainId: forkChainId,
            },
            {
              address,
              abi: vaultSummaryAbi,
              functionName: 'accumulatedFees',
              chainId: forkChainId,
            },
          ] as const,
      ),
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
