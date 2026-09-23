/**
 * Venue resolution (noesis-349) — including the degrade paths, which are the ones that decide
 * whether a user gets a trade or a redirect.
 *
 * The case most likely to be dropped when a venue is added is a deployer that matches by address but
 * cannot answer its own pool params — a real state (a stub module on a local chain). It must resolve
 * to the unresolved-venue state rather than hanging or guessing.
 *
 * The Uni-V4 cases also carry the alignment-hook shape. A pool is named by all five members of its
 * key, and two of them change once the hook switch is thrown: the key gains the hook that graduation
 * minted, and its fee becomes v4's dynamic-fee flag rather than the module's static tier. Reading
 * only `poolFee`/`tickSpacing` named a pool that was never initialized, and a pool that does not
 * exist cannot be traded — so the three states that are easy to collapse are pinned apart below: a
 * REVERT (the getter is absent) is not a zero, a PENDING read is not a zero, and a zero means
 * hookless. The answer is per INSTANCE, not per module: `alignmentHookFactory` describes what the
 * module will do next and says nothing about a collection that already graduated.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraduatedVenue } from './useGraduatedVenue'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const UNI_MODULE = '0x2222222222222222222222222222222222222222' as const
const ZAMM_MODULE = '0x3333333333333333333333333333333333333333' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const
/** A plausible mined hook address — the low byte carries the 0xCC permission bits. */
const HOOK = '0x00000000000000000000000000000000000000cc' as const

/** Every read the hook makes, as a settable fixture. `undefined` data = still resolving. */
const reads = vi.hoisted(() => ({
  deployer: { data: undefined as string | undefined, isPending: false },
  poolFee: { data: undefined as number | undefined, isError: false },
  tickSpacing: { data: undefined as number | undefined, isError: false },
  graduationHook: { data: undefined as string | undefined, isError: false },
  feeOrHook: { data: undefined as bigint | undefined, isError: false },
}))

/** The options the per-instance hook read was called with, captured for the wiring assertion. */
let hookReadOpts: unknown

vi.mock('../../../generated/contracts', () => ({
  useReadErc404BondingInstanceLiquidityDeployer: () => reads.deployer,
  useReadLiquidityDeployerModulePoolFee: () => reads.poolFee,
  useReadLiquidityDeployerModuleTickSpacing: () => reads.tickSpacing,
  useReadLiquidityDeployerModuleGraduationHook: (opts: unknown) => {
    hookReadOpts = opts
    return reads.graduationHook
  },
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
  // Resolved-and-hookless is the default so the pre-existing cases below read unchanged; the hooked
  // and degraded shapes are set explicitly by the cases that are about them.
  reads.graduationHook = { data: ZERO, isError: false }
  hookReadOpts = undefined
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

  it('a hooked graduation carries the hook AND the dynamic fee, not the static tier', () => {
    reads.deployer = { data: UNI_MODULE, isPending: false }
    reads.poolFee = { data: 3000, isError: false }
    reads.tickSpacing = { data: 60, isError: false }
    reads.graduationHook = { data: HOOK, isError: false }
    expect(resolve().venue).toEqual({
      kind: 'uniV4',
      deployer: UNI_MODULE,
      // v4's LPFeeLibrary.DYNAMIC_FEE_FLAG. The static 3000 above is what the pool would have been
      // initialized at on the untaxed path; carrying it alongside a hook names a third pool that
      // exists nowhere, so the fee has to move with the hook.
      poolFee: 0x800000,
      tickSpacing: 60,
      hook: HOOK,
    })
  })

  it('a reverting hook read is unresolved — NOT an unhooked pool', () => {
    reads.deployer = { data: UNI_MODULE, isPending: false }
    reads.poolFee = { data: 3000, isError: false }
    reads.tickSpacing = { data: 60, isError: false }
    reads.graduationHook = { data: undefined, isError: true }
    const { venue, isPending } = resolve()
    expect(venue).toEqual({ kind: 'unknown', deployer: UNI_MODULE })
    expect(isPending).toBe(false)
  })

  it('an unresolved hook read keeps the whole venue pending rather than trading a half-known key', () => {
    reads.deployer = { data: UNI_MODULE, isPending: false }
    reads.poolFee = { data: 3000, isError: false }
    reads.tickSpacing = { data: 60, isError: false }
    reads.graduationHook = { data: undefined, isError: false }
    const { venue, isPending } = resolve()
    expect(venue).toBeUndefined()
    expect(isPending).toBe(true)
  })

  it('asks the module about THIS instance, and does not retry a getter that is absent', () => {
    reads.deployer = { data: UNI_MODULE, isPending: false }
    reads.poolFee = { data: 3000, isError: false }
    reads.tickSpacing = { data: 60, isError: false }
    resolve()
    expect(hookReadOpts).toMatchObject({
      address: UNI_MODULE,
      args: [INSTANCE],
      query: { enabled: true, retry: false },
    })
  })
})

it('a deployer matching none of the known modules is unresolved', () => {
  reads.deployer = { data: '0x9999999999999999999999999999999999999999', isPending: false }
  expect(resolve().venue).toEqual({
    kind: 'unknown',
    deployer: '0x9999999999999999999999999999999999999999',
  })
})
