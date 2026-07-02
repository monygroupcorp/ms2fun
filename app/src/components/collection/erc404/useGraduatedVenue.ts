/**
 * Detect which AMM an ERC-404 instance graduated to, and read that venue's pool params.
 *
 * The instance is AMM-agnostic — at graduation it delegates to whichever ILiquidityDeployerModule
 * it was created with. We identify the venue by matching `instance.liquidityDeployer()` against the
 * three known module singletons (from the deploy config), then read the pool params the zRouter swap
 * needs straight off that module (they're immutable, so the singleton is authoritative for the whole
 * family): Uni-V4 needs poolFee + tickSpacing; ZAMM needs feeOrHook; Cypher (Algebra) is not routed
 * through zRouter (link-out fast-follow), so it carries no params here.
 */
import { getAddress } from 'viem'
import {
  useReadErc404BondingInstanceLiquidityDeployer,
  useReadLiquidityDeployerModulePoolFee,
  useReadLiquidityDeployerModuleTickSpacing,
  useReadZammLiquidityDeployerModuleFeeOrHook,
} from '../../../generated/contracts'
import { forkAddresses, forkChainId } from '../../../lib/addresses'

export type GraduatedVenue =
  | { kind: 'uniV4'; deployer: `0x${string}`; poolFee: number; tickSpacing: number }
  | { kind: 'zamm'; deployer: `0x${string}`; feeOrHook: bigint }
  | { kind: 'cypher'; deployer: `0x${string}` }
  | { kind: 'unknown'; deployer: `0x${string}` | undefined }

export interface UseGraduatedVenueResult {
  venue: GraduatedVenue | undefined
  /** True until the deployer address AND (for embedded venues) the pool params have resolved. */
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
  const deployerRead = useReadErc404BondingInstanceLiquidityDeployer({
    address: instance,
    chainId: forkChainId,
  })
  const deployer = deployerRead.data

  const isUni = sameAddress(deployer, forkAddresses.ModuleUniV4Deployer)
  const isZamm = sameAddress(deployer, forkAddresses.ModuleZAMMDeployer)
  const isCypher = sameAddress(deployer, forkAddresses.ModuleCypherDeployer)

  // Pool params — read off the identified module singleton. Gated so only the matching family's
  // reads fire. (Reading from the deployer address, not the instance: the params are immutable on
  // the module, shared by every instance of that family.)
  const poolFeeRead = useReadLiquidityDeployerModulePoolFee({
    address: deployer,
    chainId: forkChainId,
    query: { enabled: isUni && Boolean(deployer) },
  })
  const tickSpacingRead = useReadLiquidityDeployerModuleTickSpacing({
    address: deployer,
    chainId: forkChainId,
    query: { enabled: isUni && Boolean(deployer) },
  })
  const feeOrHookRead = useReadZammLiquidityDeployerModuleFeeOrHook({
    address: deployer,
    chainId: forkChainId,
    query: { enabled: isZamm && Boolean(deployer) },
  })

  if (deployerRead.isPending || deployer === undefined) {
    return { venue: undefined, isPending: true }
  }

  if (isUni) {
    // A module that matches the Uni-V4 address but can't answer poolFee/tickSpacing is not a real
    // deployer (e.g. the anvil MockComponentModule stub) — degrade to the link-out rather than hang.
    if (poolFeeRead.isError || tickSpacingRead.isError) {
      return { venue: { kind: 'unknown', deployer }, isPending: false }
    }
    if (poolFeeRead.data === undefined || tickSpacingRead.data === undefined) {
      return { venue: undefined, isPending: true }
    }
    return {
      venue: {
        kind: 'uniV4',
        deployer,
        poolFee: Number(poolFeeRead.data),
        tickSpacing: Number(tickSpacingRead.data),
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

  if (isCypher) {
    return { venue: { kind: 'cypher', deployer }, isPending: false }
  }

  return { venue: { kind: 'unknown', deployer }, isPending: false }
}
