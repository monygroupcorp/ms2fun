/**
 * Detect which AMM an ERC-404 instance graduated to, and read that venue's pool params.
 *
 * The instance is AMM-agnostic — at graduation it delegates to whichever ILiquidityDeployerModule
 * it was created with. We identify the venue by matching `instance.liquidityDeployer()` against the
 * known module singletons (from the deploy config), then read the pool params that venue's swap
 * needs straight off that module (they're immutable, so the singleton is authoritative for the
 * whole family):
 *  - Uni-V4 needs the pool's FULL key. Which key that is depends on the instance: a graduation
 *    taken before the alignment-hook switch was thrown is a static-fee, hookless pool traded through
 *    zRouter `swapV4`, and one taken after it is a DYNAMIC-fee pool whose key names a per-instance
 *    hook, traded through `AlignmentHookSwapRouter`. The module records which, per instance, and
 *    that per-instance answer is what this hook reads — the module-wide `alignmentHookFactory`
 *    switch would misdescribe every collection that graduated on the other side of it;
 *  - ZAMM needs feeOrHook (zRouter `swapVZ`).
 *
 * Every venue this hook can name is embeddable: the panel trades both in-site. `unknown` is
 * reserved for a deployer we cannot identify — a state the surface says plainly rather than
 * routing the user somewhere else.
 */
import { getAddress, zeroAddress } from 'viem'
import {
  useReadErc404BondingInstanceLiquidityDeployer,
  useReadLiquidityDeployerModuleGraduationHook,
  useReadLiquidityDeployerModulePoolFee,
  useReadLiquidityDeployerModuleTickSpacing,
  useReadZammLiquidityDeployerModuleFeeOrHook,
} from '../../../generated/contracts'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'

/**
 * The Uniswap-V4 pool key's fee member when the pool carries a hook — v4's `LPFeeLibrary`
 * `DYNAMIC_FEE_FLAG`. A hooked graduation pool is initialized at this value, not at the module's
 * static `poolFee`, because the hook's `beforeSwap` returns an LP-fee override that v4 honors on
 * dynamic-fee pools only. Naming such a pool by its static tier names a pool that does not exist.
 */
export const DYNAMIC_FEE_FLAG = 0x800000

export type GraduatedVenue =
  | {
      kind: 'uniV4'
      deployer: `0x${string}`
      /** The pool key's fee member: the module's static tier, or {@link DYNAMIC_FEE_FLAG} if hooked. */
      poolFee: number
      tickSpacing: number
      /**
       * The alignment hook in this instance's pool key, or `undefined` where the pool is hookless.
       * Undefined and "not yet known" are never the same value here: an unresolved read keeps the
       * whole venue pending, so a hooked pool can never be mistaken for a hookless one.
       */
      hook?: `0x${string}`
    }
  | { kind: 'zamm'; deployer: `0x${string}`; feeOrHook: bigint }
  | { kind: 'unknown'; deployer: `0x${string}` | undefined }

export interface UseGraduatedVenueResult {
  venue: GraduatedVenue | undefined
  /** True until the deployer address AND the venue's own params have resolved. */
  isPending: boolean
}

/** Case-insensitive checksum compare — the deploy config and on-chain reads may differ in casing. */
function sameAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return false
  }
}

export function useGraduatedVenue(instance: `0x${string}`): UseGraduatedVenueResult {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const deployerRead = useReadErc404BondingInstanceLiquidityDeployer({
    address: instance,
    chainId: chainId,
  })
  const deployer = deployerRead.data

  const isUni = sameAddress(deployer, addresses.ModuleUniV4Deployer)
  const isZamm = sameAddress(deployer, addresses.ModuleZAMMDeployer)

  // Pool params — read off the identified module singleton. Gated so only the matching family's
  // reads fire. (Reading from the deployer address, not the instance: the params are immutable on
  // the module, shared by every instance of that family.)
  const poolFeeRead = useReadLiquidityDeployerModulePoolFee({
    ...(deployer ? { address: deployer } : {}),
    chainId: chainId,
    query: { enabled: isUni && Boolean(deployer) },
  })
  const tickSpacingRead = useReadLiquidityDeployerModuleTickSpacing({
    ...(deployer ? { address: deployer } : {}),
    chainId: chainId,
    query: { enabled: isUni && Boolean(deployer) },
  })
  // Which pool key THIS instance graduated into. Read per-instance, not from the module-wide
  // `alignmentHookFactory` switch: the switch is a governed setting that can be thrown at any time,
  // while a pool key is fixed at the graduation that created it. A collection that graduated before
  // the switch stays hookless forever, and one that graduated after it is hooked forever, so the
  // switch's current value describes neither reliably. `retry: false` because the failure this can
  // hit is a module that does not declare the getter (the anvil `MockComponentModule` stub), which
  // reverts deterministically — retrying only delays the answer.
  const graduationHookRead = useReadLiquidityDeployerModuleGraduationHook({
    ...(deployer ? { address: deployer } : {}),
    chainId: chainId,
    args: [instance],
    query: { enabled: isUni && Boolean(deployer), retry: false },
  })

  const feeOrHookRead = useReadZammLiquidityDeployerModuleFeeOrHook({
    ...(deployer ? { address: deployer } : {}),
    chainId: chainId,
    query: { enabled: isZamm && Boolean(deployer) },
  })

  if (deployerRead.isPending || deployer === undefined) {
    return { venue: undefined, isPending: true }
  }

  if (isUni) {
    // A module that matches the Uni-V4 address but can't answer poolFee/tickSpacing is not a real
    // deployer (e.g. the anvil MockComponentModule stub) — say so rather than hang.
    if (poolFeeRead.isError || tickSpacingRead.isError || graduationHookRead.isError) {
      return { venue: { kind: 'unknown', deployer }, isPending: false }
    }
    if (
      poolFeeRead.data === undefined ||
      tickSpacingRead.data === undefined ||
      graduationHookRead.data === undefined
    ) {
      return { venue: undefined, isPending: true }
    }
    // A hooked pool differs from a hookless one in TWO members of its key, not one: the hook, and a
    // fee that becomes the dynamic-fee flag. Carrying the static tier alongside a hook would name a
    // third pool that exists nowhere, so the fee is switched here rather than at the call site.
    const hooked = graduationHookRead.data !== zeroAddress
    return {
      venue: {
        kind: 'uniV4',
        deployer,
        poolFee: hooked ? DYNAMIC_FEE_FLAG : Number(poolFeeRead.data),
        tickSpacing: Number(tickSpacingRead.data),
        ...(hooked ? { hook: graduationHookRead.data } : {}),
      },
      isPending: false,
    }
  }

  if (isZamm) {
    if (feeOrHookRead.isError) {
      return { venue: { kind: 'unknown', deployer }, isPending: false }
    }
    if (feeOrHookRead.data === undefined) {
      return { venue: undefined, isPending: true }
    }
    return { venue: { kind: 'zamm', deployer, feeOrHook: feeOrHookRead.data }, isPending: false }
  }

  return { venue: { kind: 'unknown', deployer }, isPending: false }
}
