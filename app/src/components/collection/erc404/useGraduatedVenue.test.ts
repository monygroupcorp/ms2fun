/**
 * Venue resolution (noesis-349) — including the degrade paths, which are the ones that decide
 * whether a user gets a trade or a redirect.
 *
 * The case most likely to be dropped when a venue is added is a deployer that matches by address but
 * cannot answer its own pool params — a real state (a stub module on a local chain). It must resolve
 * to the unresolved-venue state rather than hanging or guessing.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraduatedVenue } from './useGraduatedVenue'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const UNI_MODULE = '0x2222222222222222222222222222222222222222' as const
const ZAMM_MODULE = '0x3333333333333333333333333333333333333333' as const

/** Every read the hook makes, as a settable fixture. `undefined` data = still resolving. */
const reads = vi.hoisted(() => ({
  deployer: { data: undefined as string | undefined, isPending: false },
  poolFee: { data: undefined as number | undefined, isError: false },
  tickSpacing: { data: undefined as number | undefined, isError: false },
  feeOrHook: { data: undefined as bigint | undefined, isError: false },
}))

vi.mock('../../../generated/contracts', () => ({
  useReadErc404BondingInstanceLiquidityDeployer: () => reads.deployer,
  useReadLiquidityDeployerModulePoolFee: () => reads.poolFee,
  useReadLiquidityDeployerModuleTickSpacing: () => reads.tickSpacing,
  useReadZammLiquidityDeployerModuleFeeOrHook: () => reads.feeOrHook,
}))

vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1337,
  useCollectionAddresses: () => ({
    ModuleUniV4Deployer: UNI_MODULE,
    ModuleZAMMDeployer: ZAMM_MODULE,
  }),
}))

function resolve() {
  return renderHook(() => useGraduatedVenue(INSTANCE)).result.current
}

beforeEach(() => {
  reads.deployer = { data: undefined, isPending: false }
  reads.poolFee = { data: undefined, isError: false }
  reads.tickSpacing = { data: undefined, isError: false }
  reads.feeOrHook = { data: undefined, isError: false }
})

describe('uni-V4', () => {
  it('resolves pool params off the module singleton', () => {
    reads.deployer = { data: UNI_MODULE, isPending: false }
    reads.poolFee = { data: 3000, isError: false }
    reads.tickSpacing = { data: 60, isError: false }
    expect(resolve().venue).toEqual({
      kind: 'uniV4',
      deployer: UNI_MODULE,
      poolFee: 3000,
      tickSpacing: 60,
    })
  })

  it('a module that cannot answer poolFee resolves to the unresolved-venue state, not a hang', () => {
    reads.deployer = { data: UNI_MODULE, isPending: false }
    reads.poolFee = { data: undefined, isError: true }
    reads.tickSpacing = { data: 60, isError: false }
    const { venue, isPending } = resolve()
    expect(venue).toEqual({ kind: 'unknown', deployer: UNI_MODULE })
    expect(isPending).toBe(false)
  })

  it('a module that cannot answer tickSpacing degrades the same way', () => {
    reads.deployer = { data: UNI_MODULE, isPending: false }
    reads.poolFee = { data: 3000, isError: false }
    reads.tickSpacing = { data: undefined, isError: true }
    expect(resolve().venue).toEqual({ kind: 'unknown', deployer: UNI_MODULE })
  })
})

it('a deployer matching none of the known modules is unresolved', () => {
  reads.deployer = { data: '0x9999999999999999999999999999999999999999', isPending: false }
  expect(resolve().venue).toEqual({
    kind: 'unknown',
    deployer: '0x9999999999999999999999999999999999999999',
  })
})
