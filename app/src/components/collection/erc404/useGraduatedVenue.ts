/**
 * Detect which AMM an ERC-404 instance graduated to, and read that venue's pool params.
 *
 * The instance is AMM-agnostic — at graduation it delegates to whichever ILiquidityDeployerModule
 * it was created with. We identify the venue by matching `instance.liquidityDeployer()` against the
 * three known module singletons (from the deploy config), then read the pool params that venue's
 * swap needs straight off that module (they're immutable, so the singleton is authoritative for the
 * whole family):
 *  - Uni-V4 needs poolFee + tickSpacing (zRouter `swapV4`);
 *  - ZAMM needs feeOrHook (zRouter `swapVZ`);
 *  - Cypher (Algebra Integral) is not a zRouter venue — it trades on its own periphery router, so
 *    what it needs is the pool itself. The module carries the Algebra factory and the wrapped-native
 *    token it paired against at graduation, and `poolByPair(instance, weth)` names the pool.
 *
 * Every venue this hook can name is embeddable: the panel trades all three in-site. `unknown` is
 * reserved for a deployer we cannot identify or a pool we cannot resolve — a state the surface says
 * plainly rather than routing the user somewhere else.
 */
import { getAddress, zeroAddress } from 'viem'
import { useReadContract } from 'wagmi'
import {
  useReadCypherLiquidityDeployerModuleAlgebraFactory,
  useReadCypherLiquidityDeployerModuleWeth,
  useReadErc404BondingInstanceLiquidityDeployer,
  useReadLiquidityDeployerModulePoolFee,
  useReadLiquidityDeployerModuleTickSpacing,
  useReadZammLiquidityDeployerModuleFeeOrHook,
} from '../../../generated/contracts'
import { algebraFactoryAbi } from '../../../lib/algebra/abis'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'

export type GraduatedVenue =
  | { kind: 'uniV4'; deployer: `0x${string}`; poolFee: number; tickSpacing: number }
  | { kind: 'zamm'; deployer: `0x${string}`; feeOrHook: bigint }
  | { kind: 'cypher'; deployer: `0x${string}`; pool: `0x${string}`; weth: `0x${string}` }
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
  const isCypher = sameAddress(deployer, addresses.ModuleCypherDeployer)

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
  const feeOrHookRead = useReadZammLiquidityDeployerModuleFeeOrHook({
    ...(deployer ? { address: deployer } : {}),
    chainId: chainId,
    query: { enabled: isZamm && Boolean(deployer) },
  })

  // Cypher: the module's two immutables name the pool's coordinates, and the factory names the pool.
  const cypherEnabled = isCypher && Boolean(deployer)
  const algebraFactoryRead = useReadCypherLiquidityDeployerModuleAlgebraFactory({
    ...(deployer ? { address: deployer } : {}),
    chainId: chainId,
    query: { enabled: cypherEnabled },
  })
  const cypherWethRead = useReadCypherLiquidityDeployerModuleWeth({
    ...(deployer ? { address: deployer } : {}),
    chainId: chainId,
    query: { enabled: cypherEnabled },
  })
  const algebraFactory = algebraFactoryRead.data
  const cypherWeth = cypherWethRead.data
  const poolRead = useReadContract({
    abi: algebraFactoryAbi,
    functionName: 'poolByPair',
    ...(algebraFactory ? { address: algebraFactory } : {}),
    chainId: chainId,
    args: cypherWeth ? [instance, cypherWeth] : undefined,
    query: { enabled: cypherEnabled && Boolean(algebraFactory) && Boolean(cypherWeth) },
  })

  if (deployerRead.isPending || deployer === undefined) {
    return { venue: undefined, isPending: true }
  }

  if (isUni) {
    // A module that matches the Uni-V4 address but can't answer poolFee/tickSpacing is not a real
    // deployer (e.g. the anvil MockComponentModule stub) — say so rather than hang.
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
    if (algebraFactoryRead.isError || cypherWethRead.isError || poolRead.isError) {
      return { venue: { kind: 'unknown', deployer }, isPending: false }
    }
    if (algebraFactory === undefined || cypherWeth === undefined || poolRead.data === undefined) {
      return { venue: undefined, isPending: true }
    }
    // A pair the factory has never seen answers `address(0)`. There is no pool to trade, and there
    // is nowhere else to send the user — that is the honest no-route state, not a link-out.
    if (poolRead.data === zeroAddress) {
      return { venue: { kind: 'unknown', deployer }, isPending: false }
    }
    return {
      venue: { kind: 'cypher', deployer, pool: poolRead.data, weth: cypherWeth },
      isPending: false,
    }
  }

  return { venue: { kind: 'unknown', deployer }, isPending: false }
}
