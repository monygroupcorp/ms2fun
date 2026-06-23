/**
 * The wizard's `vault` slot provider: registered alignment vaults are bound to targets in
 * MasterRegistry (NOT ComponentRegistry), so they're enumerated here from the `VaultRegistered`
 * event — distinct from `useApprovedModules` (which reads ComponentRegistry for gating/liquidity/etc).
 * Event-derived like `useCreatorCollections`; `fromBlock: 0n` is fast on the fork.
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { masterRegistryV1Abi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'

export interface RegisteredVault {
  address: `0x${string}`
  name: string
  targetId: bigint
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
      const logs = await client.getContractEvents({
        address: forkAddresses.MasterRegistryV1,
        abi: masterRegistryV1Abi,
        eventName: 'VaultRegistered',
        fromBlock: 0n,
        toBlock: 'latest',
      })
      const seen = new Set<`0x${string}`>()
      const vaults: RegisteredVault[] = []
      for (const log of logs) {
        const { vault, name, targetId } = log.args
        if (vault === undefined || targetId === undefined || seen.has(vault)) continue
        seen.add(vault)
        vaults.push({ address: vault, name: name ?? '', targetId })
      }
      return vaults
    },
  })

  return { data, isPending, isError }
}
