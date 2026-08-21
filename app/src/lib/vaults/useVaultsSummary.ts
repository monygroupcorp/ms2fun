/**
 * useVaultsSummary — one multicall for the vaults index (`/vaults`). For each vault we read
 * vaultType + totalPrincipal + accumulatedFees + the alignment target in a single batched
 * `useReadContracts`, so the list renders each row's TVL/type/target without a hook per row (which
 * would break hook-order as the vault set loads in). totalPrincipal only resolves for endowment
 * vaults (LP vaults revert it → allowFailure leaves it undefined); the page-level TVL total sums
 * only the endowment principals.
 *
 * The target id needs two probes because the field name differs by vault family — `targetId()` on
 * the endowment vault, `alignmentTargetId()` on the liquidity family — and there is no way to tell
 * the families apart from the address alone. Both ride the same batch under `allowFailure`, exactly
 * as `scripts/tithe-report.ts` probes them; whichever resolves is the vault's target, and neither
 * resolving leaves `targetId: null` (reported as unattributed, never guessed).
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
  {
    type: 'function',
    name: 'targetId',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'alignmentTargetId',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/** Reads per vault in the batch, in call order. */
const CALLS_PER_VAULT = 5

export interface VaultSummary {
  vaultType: string | undefined
  /** Endowment TVL; undefined for LP vaults. */
  totalPrincipal: bigint | undefined
  accumulatedFees: bigint | undefined
  /** The alignment target this vault binds to; `null` when neither family's getter resolved. */
  targetId: bigint | null
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
            {
              address,
              abi: vaultSummaryAbi,
              functionName: 'targetId',
              chainId: forkChainId,
            },
            {
              address,
              abi: vaultSummaryAbi,
              functionName: 'alignmentTargetId',
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
      const base = i * CALLS_PER_VAULT
      const typeRes = data?.[base]
      const principalRes = data?.[base + 1]
      const feesRes = data?.[base + 2]
      const endowmentTargetRes = data?.[base + 3]
      const liquidityTargetRes = data?.[base + 4]
      const vaultType = typeRes?.status === 'success' ? (typeRes.result as string) : undefined
      const totalPrincipal =
        vaultType === 'AaveEndowment' && principalRes?.status === 'success'
          ? (principalRes.result as bigint)
          : undefined
      const accumulatedFees = feesRes?.status === 'success' ? (feesRes.result as bigint) : undefined
      const targetId =
        endowmentTargetRes?.status === 'success'
          ? (endowmentTargetRes.result as bigint)
          : liquidityTargetRes?.status === 'success'
            ? (liquidityTargetRes.result as bigint)
            : null
      if (totalPrincipal !== undefined) endowmentTvl += totalPrincipal
      byAddress.set(address.toLowerCase(), { vaultType, totalPrincipal, accumulatedFees, targetId })
    })
    return { byAddress, endowmentTvl, isPending: isPending && addresses.length > 0 }
  }, [addresses, data, isPending])
}
