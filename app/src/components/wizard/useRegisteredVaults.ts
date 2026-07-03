/**
 * The wizard's `vault` slot provider: registered alignment vaults are bound to targets in
 * MasterRegistry (NOT ComponentRegistry), so they're enumerated here from the `VaultRegistered`
 * event — distinct from `useApprovedModules` (which reads ComponentRegistry for gating/liquidity/etc).
 * Event-derived like `useCreatorCollections`; read via the deploy-block-floored reverse-windowed
 * scanner (ADR-0010 Tier 1B), not a genesis scan.
 *
 * Each event-derived vault is then enriched via one multicall reading its on-chain taxonomy —
 * `vaultType()` (→ family/venue via `deriveVaultFlavor`) + `isLiquidityReady()` (O2 gating) +
 * `description()` — so the alignment step can group by family → venue and gate unready LP venues.
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { masterRegistryV1Abi } from '../../generated/contracts'
import { deployBlock, forkAddresses, forkChainId } from '../../lib/addresses'
import { scanBackward } from '../../lib/logScan'
import { deriveVaultFlavor, type VaultFamily } from '../../lib/wizard/vaultFlavor'

/**
 * Inline ABI fragment for the per-vault reads. Hand-written (not from the generated bindings) so this
 * doesn't depend on a wagmi regen — every vault implements these three. `isLiquidityReady()` is a
 * `view` (true for the Aave vault; true for an LP vault only once its pool key + price validator are
 * wired); `vaultType()` / `description()` are `pure`.
 */
const VAULT_INFO_ABI = [
  {
    type: 'function',
    name: 'vaultType',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'isLiquidityReady',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'description',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const

export interface RegisteredVault {
  address: `0x${string}`
  name: string
  targetId: bigint
  /** Raw on-chain `vaultType()` — "AaveEndowment" | "UniswapV4LP" | "ZAMMLP" | "CypherLP". */
  vaultType: string
  family: VaultFamily
  /** Machine venue id — see `deriveVaultFlavor`. */
  venue: string
  /** `isLiquidityReady()` — an LP vault is only safe to select once true (O2). Aave is always ready. */
  ready: boolean
  description: string
}

export function useRegisteredVaults(): {
  data: RegisteredVault[] | undefined
  isPending: boolean
  isError: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })

  const { data, isPending, isError } = useQuery({
    queryKey: ['registered-vaults'],
    enabled: !!client,
    staleTime: 60_000,
    queryFn: async (): Promise<RegisteredVault[]> => {
      if (!client) return []
      const latest = await client.getBlockNumber()
      const logs = await scanBackward(
        (fromBlock, toBlock) =>
          client.getContractEvents({
            address: forkAddresses.MasterRegistryV1,
            abi: masterRegistryV1Abi,
            eventName: 'VaultRegistered',
            fromBlock,
            toBlock,
          }),
        { latest, floor: deployBlock },
      )
      const seen = new Set<`0x${string}`>()
      const base: { address: `0x${string}`; name: string; targetId: bigint }[] = []
      for (const log of logs) {
        const { vault, name, targetId } = log.args
        if (vault === undefined || targetId === undefined || seen.has(vault)) continue
        seen.add(vault)
        base.push({ address: vault, name: name ?? '', targetId })
      }
      if (base.length === 0) return []

      // Enrich every vault with vaultType/isLiquidityReady/description in one round-trip.
      const results = await client.multicall({
        allowFailure: true,
        contracts: base.flatMap((v) => [
          { address: v.address, abi: VAULT_INFO_ABI, functionName: 'vaultType' } as const,
          { address: v.address, abi: VAULT_INFO_ABI, functionName: 'isLiquidityReady' } as const,
          { address: v.address, abi: VAULT_INFO_ABI, functionName: 'description' } as const,
        ]),
      })

      const vaults: RegisteredVault[] = []
      base.forEach((v, i) => {
        const typeR = results[i * 3]
        const readyR = results[i * 3 + 1]
        const descR = results[i * 3 + 2]
        // Defensive: a vault whose vaultType() can't be read isn't a well-formed alignment vault —
        // drop it rather than fail the whole query.
        if (!typeR || typeR.status !== 'success' || typeof typeR.result !== 'string') return
        const vaultType = typeR.result
        const { family, venue } = deriveVaultFlavor(vaultType)
        // Unreadable readiness ⇒ treat as not ready (fail closed for O2 gating).
        const ready = readyR?.status === 'success' ? Boolean(readyR.result) : false
        const description =
          descR?.status === 'success' && typeof descR.result === 'string' ? descR.result : ''
        vaults.push({ ...v, vaultType, family, venue, ready, description })
      })
      return vaults
    },
  })

  return { data, isPending, isError }
}
