/**
 * Live supply ceiling for the selected ERC-404 launch preset.
 *
 * Two hops, both on-chain: `ERC404Factory.launchManager()` → `LaunchManager.getPreset(presetId)`,
 * then `maxNftSupplyForUnit(preset.unitPerNFT)`. Read rather than hardcoded because presets are
 * DAO-settable (`setPreset`); a retuned preset must move the wizard's bound with it, or the app
 * starts refusing supplies the chain would accept (or worse, admitting ones it won't).
 *
 * `LaunchManager` is not in the wagmi include list, so its one-function ABI is inlined here — the
 * same approach `useRegisteredVaults` takes for the vault getters, and it keeps this off the
 * bindings-regen path.
 *
 * `getPreset` REVERTS (`PresetNotActive`) for an id the DAO has not activated. That surfaces as
 * `isError` with `ceiling === undefined`, and an undefined ceiling never manufactures a blocker —
 * an inactive preset is refused by the factory itself, and the create-path error belongs there.
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { erc404FactoryAbi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { maxNftSupplyForUnit } from '../../lib/wizard/supplyCeiling'

/** `LaunchManager.getPreset` — inlined (not in `wagmi.config.ts`'s include list). */
const LAUNCH_MANAGER_ABI = [
  {
    type: 'function',
    name: 'getPreset',
    stateMutability: 'view',
    inputs: [{ name: 'presetId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'targetETH', type: 'uint256' },
          { name: 'unitPerNFT', type: 'uint256' },
          { name: 'liquidityReserveBps', type: 'uint256' },
          { name: 'curveComputer', type: 'address' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
] as const

export interface PresetSupplyCeiling {
  /** Largest `nftCount` this preset admits, or undefined while loading / on an inactive preset. */
  ceiling: bigint | undefined
  /** The preset's `unitPerNFT` (coin units per NFT, pre-1e18), for display. */
  unitPerNFT: bigint | undefined
  isPending: boolean
  isError: boolean
}

/**
 * @param presetId the wizard's `presetId` field value (a select value string), or undefined when the
 *        project type has no preset (ERC-1155 / ERC-721 — the query stays disabled).
 */
export function usePresetSupplyCeiling(presetId: string | undefined): PresetSupplyCeiling {
  const client = usePublicClient({ chainId: forkChainId })
  const parsed =
    presetId !== undefined && /^\d+$/.test(presetId.trim()) ? presetId.trim() : undefined

  const { data, isPending, isError } = useQuery({
    queryKey: ['preset-supply-ceiling', parsed],
    enabled: Boolean(client) && parsed !== undefined,
    staleTime: 60_000,
    retry: false, // an inactive preset reverts deterministically; retrying just delays the answer
    queryFn: async (): Promise<{ ceiling: bigint; unitPerNFT: bigint }> => {
      if (!client || parsed === undefined) throw new Error('disabled')
      const launchManager = await client.readContract({
        address: forkAddresses.ERC404Factory,
        abi: erc404FactoryAbi,
        functionName: 'launchManager',
      })
      const preset = await client.readContract({
        address: launchManager,
        abi: LAUNCH_MANAGER_ABI,
        functionName: 'getPreset',
        args: [BigInt(parsed)],
      })
      const unitPerNFT = preset.unitPerNFT
      return { ceiling: maxNftSupplyForUnit(unitPerNFT), unitPerNFT }
    },
  })

  return {
    ceiling: data?.ceiling,
    unitPerNFT: data?.unitPerNFT,
    isPending: parsed !== undefined && isPending,
    isError,
  }
}
