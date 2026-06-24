/**
 * Aggregate the ERC404 bonding instance reads the W-B4 surface needs into one hook, and expose a
 * `BondingView` shaped for the pure `derivePhase` / `canDeployLiquidity` machine. Replaces legacy's
 * scattered manual `executeContractCall` + EventBus cache plumbing with wagmi/React-Query reads.
 */
import {
  useReadErc404BondingInstanceBondingActive,
  useReadErc404BondingInstanceBondingFeeBps,
  useReadErc404BondingInstanceBondingMaturityTime,
  useReadErc404BondingInstanceBondingOpenTime,
  useReadErc404BondingInstanceCurveParams,
  useReadErc404BondingInstanceGraduated,
  useReadErc404BondingInstanceLiquidityDeployer,
  useReadErc404BondingInstanceMaxSupply,
  useReadErc404BondingInstanceReserve,
  useReadErc404BondingInstanceTotalBondingSupply,
  useReadErc404BondingInstanceUnit,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import type { BondingView } from './bondingPhase'

/** The 5-tuple `curveParams()` returns, in the order `CurveParamsComputer.calculateCost` expects. */
export type CurveParamsTuple = readonly [bigint, bigint, bigint, bigint, bigint]

export interface BondingData {
  view: BondingView | undefined
  curveParams: CurveParamsTuple | undefined
  reserve: bigint | undefined
  unit: bigint | undefined
  feeBps: bigint | undefined
  isPending: boolean
  isError: boolean
  refetch: () => void
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export function useBondingData(instance: `0x${string}`): BondingData {
  const opts = { address: instance, chainId: forkChainId } as const

  const active = useReadErc404BondingInstanceBondingActive(opts)
  const openTime = useReadErc404BondingInstanceBondingOpenTime(opts)
  const maturityTime = useReadErc404BondingInstanceBondingMaturityTime(opts)
  const graduated = useReadErc404BondingInstanceGraduated(opts)
  const deployer = useReadErc404BondingInstanceLiquidityDeployer(opts)
  const totalSupply = useReadErc404BondingInstanceTotalBondingSupply(opts)
  const maxSupply = useReadErc404BondingInstanceMaxSupply(opts)
  const curve = useReadErc404BondingInstanceCurveParams(opts)
  const reserve = useReadErc404BondingInstanceReserve(opts)
  const unit = useReadErc404BondingInstanceUnit(opts)
  const feeBps = useReadErc404BondingInstanceBondingFeeBps(opts)

  const reads = [
    active,
    openTime,
    maturityTime,
    graduated,
    deployer,
    totalSupply,
    maxSupply,
    curve,
    reserve,
    unit,
    feeBps,
  ]
  const isPending = reads.some((r) => r.isPending)
  const isError = reads.some((r) => r.isError)

  function refetch(): void {
    for (const r of reads) void r.refetch()
  }

  let view: BondingView | undefined
  if (
    active.data !== undefined &&
    openTime.data !== undefined &&
    maturityTime.data !== undefined &&
    graduated.data !== undefined &&
    deployer.data !== undefined &&
    totalSupply.data !== undefined &&
    maxSupply.data !== undefined
  ) {
    view = {
      bondingActive: active.data,
      bondingOpenTime: openTime.data,
      bondingMaturityTime: maturityTime.data,
      graduated: graduated.data,
      liquidityDeployer: (deployer.data ?? ZERO_ADDRESS) as `0x${string}`,
      totalBondingSupply: totalSupply.data,
      maxSupply: maxSupply.data,
    }
  }

  // curveParams() returns 5 named outputs; wagmi surfaces them as a readonly 5-tuple.
  const curveParams = curve.data as CurveParamsTuple | undefined

  return {
    view,
    curveParams,
    reserve: reserve.data,
    unit: unit.data,
    feeBps: feeBps.data,
    isPending,
    isError,
    refetch,
  }
}
