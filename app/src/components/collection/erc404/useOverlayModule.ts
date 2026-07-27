/**
 * Detect whether an ERC-404 instance has a `MetadataOverlayModule` wired into its metadata-resolver
 * seam (ADR-0006/0007), and resolve its address so the artist/holder panels know where to write.
 *
 * The instance carries ONE generic keyed slot (`modules[METADATA_RESOLVER]`, ADR-0006) which the
 * factory wires at create time to exactly one of: nothing (zero address), the overlay module
 * directly, the tier module directly, or a `MetadataResolverRouter` that stacks up to both
 * (`encodeMetadataConfig` in `lib/wizard/metadataConfig.ts` is the create-side mirror of this
 * decoding). We identify each stop by matching against the known singleton addresses (same idiom as
 * `useGraduatedVenue` matching `liquidityDeployer()` against the three AMM module singletons) rather
 * than probing ABIs — the deploy config is authoritative for "which contract is the overlay module."
 */
import { getAddress } from 'viem'
import {
  useReadErc404BondingInstanceModules,
  useReadMetadataResolverRouterResolverCount,
  useReadMetadataResolverRouterResolvers,
} from '../../../generated/contracts'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'

/** keccak256("metadata.resolver") — the instance's fixed module-slot key (ERC404BondingInstance.sol). */
const METADATA_RESOLVER =
  '0x6876dc951d238895420929c9699504dc9f785aa150ffdf376d602b9bf87a2972' as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Case-insensitive checksum compare — deploy config and on-chain reads may differ in casing. */
function sameAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return false
  }
}

export interface OverlayModuleResult {
  /** The MetadataOverlayModule address wired to this instance, or undefined if none is. */
  overlay: `0x${string}` | undefined
  isPending: boolean
}

export function useOverlayModule(instance: `0x${string}` | undefined): OverlayModuleResult {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const resolverRead = useReadErc404BondingInstanceModules({
    ...(instance ? { address: instance } : {}),
    args: [METADATA_RESOLVER],
    chainId: chainId,
    query: { enabled: !!instance },
  })
  const resolver = resolverRead.data

  const isDirectOverlay = sameAddress(resolver, addresses.MetadataOverlayModule)
  const isRouter = sameAddress(resolver, addresses.MetadataResolverRouter)

  // Router case: the overlay may be either of its (at most 2, per encodeMetadataConfig) wired
  // children — read both fixed slots, gated so they only fire when `resolver` IS the router.
  const countRead = useReadMetadataResolverRouterResolverCount({
    ...(resolver ? { address: resolver } : {}),
    args: instance ? [instance] : undefined,
    chainId: chainId,
    query: { enabled: isRouter && !!instance },
  })
  const count = countRead.data ?? 0n

  const child0Read = useReadMetadataResolverRouterResolvers({
    ...(resolver ? { address: resolver } : {}),
    args: instance ? [instance, 0n] : undefined,
    chainId: chainId,
    query: { enabled: isRouter && !!instance && count > 0n },
  })
  const child1Read = useReadMetadataResolverRouterResolvers({
    ...(resolver ? { address: resolver } : {}),
    args: instance ? [instance, 1n] : undefined,
    chainId: chainId,
    query: { enabled: isRouter && !!instance && count > 1n },
  })

  if (resolverRead.isPending || resolver === undefined) {
    return { overlay: undefined, isPending: true }
  }
  if (!resolver || resolver === ZERO_ADDRESS) {
    return { overlay: undefined, isPending: false }
  }
  if (isDirectOverlay) {
    return { overlay: addresses.MetadataOverlayModule, isPending: false }
  }
  if (isRouter) {
    if (countRead.isPending) return { overlay: undefined, isPending: true }
    if (count > 0n && child0Read.isPending) return { overlay: undefined, isPending: true }
    if (count > 1n && child1Read.isPending) return { overlay: undefined, isPending: true }
    if (sameAddress(child0Read.data, addresses.MetadataOverlayModule)) {
      return { overlay: addresses.MetadataOverlayModule, isPending: false }
    }
    if (sameAddress(child1Read.data, addresses.MetadataOverlayModule)) {
      return { overlay: addresses.MetadataOverlayModule, isPending: false }
    }
  }
  // Resolver is set but isn't (directly or via router) the overlay module — e.g. tier-only, or an
  // as-yet-unrecognized module. No overlay UI for this instance.
  return { overlay: undefined, isPending: false }
}
