/**
 * Venue resolution (noesis-349) — including the degrade paths, which are the ones that used to
 * decide whether a user got a trade or a redirect.
 *
 * Two of these cases are specifically the paths most likely to be dropped when a venue is added:
 *  - a Uni-V4 deployer that matches by address but cannot answer `poolFee`/`tickSpacing`. That is a
 *    real state (a stub module on a local chain), it is reached by a UNI collection rather than by a
 *    Cypher one, and it must resolve to the unresolved-venue state rather than hanging or guessing;
 *  - a Cypher deployer whose pair the Algebra factory has never seen, which answers `address(0)`.
 *    A zero address is not a pool, and treating it as one would put a swap panel in front of a pool
 *    that does not exist.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraduatedVenue } from './useGraduatedVenue'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const UNI_MODULE = '0x2222222222222222222222222222222222222222' as const
const ZAMM_MODULE = '0x3333333333333333333333333333333333333333' as const
const CYPHER_MODULE = '0x4444444444444444444444444444444444444444' as const
const ALGEBRA_FACTORY = '0x5555555555555555555555555555555555555555' as const
const WETH = '0x6666666666666666666666666666666666666666' as const
const POOL = '0x7777777777777777777777777777777777777777' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

/** Every read the hook makes, as a settable fixture. `undefined` data = still resolving. */
const reads = vi.hoisted(() => ({
  deployer: { data: undefined as string | undefined, isPending: false },
  poolFee: { data: undefined as number | undefined, isError: false },
  tickSpacing: { data: undefined as number | undefined, isError: false },
  feeOrHook: { data: undefined as bigint | undefined, isError: false },
  algebraFactory: { data: undefined as string | undefined, isError: false },
  weth: { data: undefined as string | undefined, isError: false },
  pool: { data: undefined as string | undefined, isError: false },
}))

vi.mock('wagmi', () => ({ useReadContract: () => reads.pool }))

vi.mock('../../../generated/contracts', () => ({
  useReadErc404BondingInstanceLiquidityDeployer: () => reads.deployer,
  useReadLiquidityDeployerModulePoolFee: () => reads.poolFee,
  useReadLiquidityDeployerModuleTickSpacing: () => reads.tickSpacing,
  useReadZammLiquidityDeployerModuleFeeOrHook: () => reads.feeOrHook,
  useReadCypherLiquidityDeployerModuleAlgebraFactory: () => reads.algebraFactory,
  useReadCypherLiquidityDeployerModuleWeth: () => reads.weth,
}))

vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1337,
  useCollectionAddresses: () => ({
    ModuleUniV4Deployer: UNI_MODULE,
    ModuleZAMMDeployer: ZAMM_MODULE,
    ModuleCypherDeployer: CYPHER_MODULE,
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
  reads.algebraFactory = { data: undefined, isError: false }
  reads.weth = { data: undefined, isError: false }
  reads.pool = { data: undefined, isError: false }
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

describe('cypher', () => {
  it('resolves the Algebra pool from the module immutables', () => {
    reads.deployer = { data: CYPHER_MODULE, isPending: false }
    reads.algebraFactory = { data: ALGEBRA_FACTORY, isError: false }
    reads.weth = { data: WETH, isError: false }
    reads.pool = { data: POOL, isError: false }
    expect(resolve().venue).toEqual({
      kind: 'cypher',
      deployer: CYPHER_MODULE,
      pool: POOL,
      weth: WETH,
    })
  })

  it('a pair the factory has never seen answers address(0), which is not a pool', () => {
    reads.deployer = { data: CYPHER_MODULE, isPending: false }
    reads.algebraFactory = { data: ALGEBRA_FACTORY, isError: false }
    reads.weth = { data: WETH, isError: false }
    reads.pool = { data: ZERO, isError: false }
    expect(resolve().venue).toEqual({ kind: 'unknown', deployer: CYPHER_MODULE })
  })

  it('stays pending while the pool read is still in flight', () => {
    reads.deployer = { data: CYPHER_MODULE, isPending: false }
    reads.algebraFactory = { data: ALGEBRA_FACTORY, isError: false }
    reads.weth = { data: WETH, isError: false }
    const { venue, isPending } = resolve()
    expect(venue).toBeUndefined()
    expect(isPending).toBe(true)
  })

  it('a failing factory read degrades rather than guessing a pool', () => {
    reads.deployer = { data: CYPHER_MODULE, isPending: false }
    reads.algebraFactory = { data: undefined, isError: true }
    reads.weth = { data: WETH, isError: false }
    expect(resolve().venue).toEqual({ kind: 'unknown', deployer: CYPHER_MODULE })
  })
})

it('a deployer matching none of the known modules is unresolved', () => {
  reads.deployer = { data: '0x9999999999999999999999999999999999999999', isPending: false }
  expect(resolve().venue).toEqual({
    kind: 'unknown',
    deployer: '0x9999999999999999999999999999999999999999',
  })
})
