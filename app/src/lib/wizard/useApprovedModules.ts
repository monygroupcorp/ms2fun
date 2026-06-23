/**
 * Live hook listing the approved components for a ComponentRegistry tag, with each module's parsed
 * metadata. This is the on-chain half of the hybrid schema (ADR-0005): the REGISTRY decides which
 * options exist; the client supplies the typed input form for each module's `configType`.
 *
 * Tag → bytes32 mapping (keccak256 pre-images, matching FeatureUtils on-chain):
 *   'gating'         → keccak256('gating')
 *   'liquidity'      → keccak256('liquidity')
 *   'dynamic_pricing'→ keccak256('dynamic_pricing')
 *   'staking'        → keccak256('staking')
 *   'vault'          → keccak256('vault')   ← returns [] until Aave vault ships (expected)
 */

import { useQuery } from '@tanstack/react-query'
import { keccak256, toBytes } from 'viem'
import { usePublicClient } from 'wagmi'
import { useReadComponentRegistryGetApprovedComponentsByTag } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../addresses'
import { fetchJson } from '../metadata'
import { parseComponentMeta, type ComponentModuleMeta } from './configTypes'
import type { ComponentTag } from './schema'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModuleOption {
  address: `0x${string}`
  meta: ComponentModuleMeta
}

// ── Minimal ABI for metadataURI ───────────────────────────────────────────────

const COMPONENT_META_ABI = [
  {
    type: 'function',
    name: 'metadataURI',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Resolve an approved component list for a given ComponentTag, then fetch + parse each module's
 * on-chain `metadataURI`. Modules whose URI is empty or unreachable are still included with an
 * empty ComponentModuleMeta so no option is silently dropped.
 */
export function useApprovedModules(tag: ComponentTag): {
  data: ModuleOption[] | undefined
  isPending: boolean
  isError: boolean
} {
  // Derive the on-chain bytes32 tag hash from the pre-image string.
  const tagHash = keccak256(toBytes(tag))

  // Step 1: read the approved address list from ComponentRegistry.
  const {
    data: addresses,
    isPending: addrPending,
    isError: addrError,
  } = useReadComponentRegistryGetApprovedComponentsByTag({
    address: forkAddresses.ComponentRegistry,
    chainId: forkChainId,
    args: [tagHash],
  })

  // Step 2: for each address, read metadataURI then fetch + parse the JSON.
  const client = usePublicClient({ chainId: forkChainId })

  const {
    data,
    isPending: metaPending,
    isError: metaError,
  } = useQuery({
    queryKey: ['approved-modules', tag, addresses],
    enabled: !!client && !!addresses && addresses.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<ModuleOption[]> => {
      if (!client || !addresses || addresses.length === 0) return []

      return Promise.all(
        addresses.map(async (address): Promise<ModuleOption> => {
          try {
            const uri = await client.readContract({
              address,
              abi: COMPONENT_META_ABI,
              functionName: 'metadataURI',
            })
            const json = uri ? await fetchJson(uri) : null
            return { address, meta: parseComponentMeta(json) }
          } catch {
            // Unreachable module or bad ABI — include with empty meta so it's not silently dropped.
            return { address, meta: parseComponentMeta(null) }
          }
        }),
      )
    },
  })

  // When the address list is empty (e.g. vault tag before Aave vault ships), return [] immediately.
  if (!addrPending && !addrError && addresses && addresses.length === 0) {
    return { data: [], isPending: false, isError: false }
  }

  return {
    data,
    isPending: addrPending || metaPending,
    isError: addrError || metaError,
  }
}
