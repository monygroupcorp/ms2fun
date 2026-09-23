/**
 * `useSwapTithe` — the read behind the wizard's after-market claim, and specifically the two
 * distinctions the copy depends on.
 *
 * A REVERT is not a zero. `ZAMMLiquidityDeployerModule` declares no `alignmentHookFactory()` at
 * all (the perpetual tithe is a Uniswap-V4-venue decision), so the call matches no function and
 * reverts; an unreachable node reverts too. Neither is evidence that a pool is untaxed, and
 * reporting "untaxed" off either would tell a Uniswap creator their pool takes nothing when the
 * truth is that we never found out. Only a SUCCESSFUL read of `address(0)` earns that sentence.
 *
 * IN FLIGHT is not an answer either. The wizard renders nothing for `pending`, because a step that
 * shows "untaxed" for a moment and then corrects itself has already been believed.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockFactoryRead = vi.hoisted(() => vi.fn())
const mockBipsRead = vi.hoisted(() => vi.fn())

vi.mock('../../generated/contracts', () => ({
  useReadLiquidityDeployerModuleAlignmentHookFactory: mockFactoryRead,
  useReadLiquidityDeployerModuleHookFeeBips: mockBipsRead,
}))
vi.mock('../../lib/addresses', () => ({ forkChainId: 1337 }))

const { useSwapTithe } = await import('./useSwapTithe')

/** The wagmi options a mocked read was called with, so the `enabled`/`retry` gating is assertable. */
function optsOf(mock: ReturnType<typeof vi.fn>): {
  address?: string
  query: { enabled: boolean; retry: boolean }
} {
  const call = mock.mock.calls[0]
  expect(call, 'the read was never called').toBeDefined()
  return call![0]
}

const DEPLOYER = '0x1111111111111111111111111111111111111111' as const
const HOOK_FACTORY = '0x2222222222222222222222222222222222222222' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

/** wagmi's shape for a read that has not produced a value: no data, no error. */
const inFlight = { data: undefined, isError: false }
const reverted = { data: undefined, isError: true }
const got = (data: unknown) => ({ data, isError: false })

// No default for `deployer`: JS defaults fire on an explicit `undefined`, which is precisely the
// "nothing selected yet" case under test.
function ask(deployer: `0x${string}` | undefined, enabled = true) {
  return renderHook(() => useSwapTithe(deployer, enabled)).result.current
}

afterEach(() => {
  mockFactoryRead.mockReset()
  mockBipsRead.mockReset()
})

describe('useSwapTithe', () => {
  it('reports the rate when the deployer names a hook factory', () => {
    mockFactoryRead.mockReturnValue(got(HOOK_FACTORY))
    mockBipsRead.mockReturnValue(got(100n))
    expect(ask(DEPLOYER)).toEqual({ kind: 'taxed', feeBips: 100n })
  })

  it('reports untaxed on a SUCCESSFUL read of address(0) — the shipped default', () => {
    mockFactoryRead.mockReturnValue(got(ZERO))
    mockBipsRead.mockReturnValue(inFlight)
    expect(ask(DEPLOYER)).toEqual({ kind: 'untaxed' })
  })

  it('reports unknown — NOT untaxed — when the factory read reverts', () => {
    mockFactoryRead.mockReturnValue(reverted)
    mockBipsRead.mockReturnValue(inFlight)
    expect(ask(DEPLOYER)).toEqual({ kind: 'unknown' })
  })

  it('reports unknown when the switch reads but the rate does not', () => {
    mockFactoryRead.mockReturnValue(got(HOOK_FACTORY))
    mockBipsRead.mockReturnValue(reverted)
    expect(ask(DEPLOYER)).toEqual({ kind: 'unknown' })
  })

  it('reports pending while the factory read is in flight', () => {
    mockFactoryRead.mockReturnValue(inFlight)
    mockBipsRead.mockReturnValue(inFlight)
    expect(ask(DEPLOYER)).toEqual({ kind: 'pending' })
  })

  it('reports pending while the rate is still in flight behind a live factory', () => {
    mockFactoryRead.mockReturnValue(got(HOOK_FACTORY))
    mockBipsRead.mockReturnValue(inFlight)
    expect(ask(DEPLOYER)).toEqual({ kind: 'pending' })
  })

  it('asks nothing, and claims nothing, while no deployer is chosen', () => {
    mockFactoryRead.mockReturnValue(inFlight)
    mockBipsRead.mockReturnValue(inFlight)
    expect(ask(undefined)).toEqual({ kind: 'unknown' })
    expect(optsOf(mockFactoryRead).query.enabled).toBe(false)
  })

  it('asks nothing for a standard that graduates into no pool', () => {
    mockFactoryRead.mockReturnValue(got(ZERO))
    mockBipsRead.mockReturnValue(inFlight)
    expect(ask(DEPLOYER, false)).toEqual({ kind: 'unknown' })
    expect(optsOf(mockFactoryRead).query.enabled).toBe(false)
  })

  it('does not ask for a rate while the switch is off — there is nothing for it to mean', () => {
    mockFactoryRead.mockReturnValue(got(ZERO))
    mockBipsRead.mockReturnValue(inFlight)
    ask(DEPLOYER)
    expect(optsOf(mockBipsRead).query.enabled).toBe(false)
  })

  it('retries neither read: a deployer without the getter reverts the same way every time', () => {
    mockFactoryRead.mockReturnValue(got(HOOK_FACTORY))
    mockBipsRead.mockReturnValue(got(50n))
    ask(DEPLOYER)
    expect(optsOf(mockFactoryRead).query.retry).toBe(false)
    expect(optsOf(mockBipsRead).query.retry).toBe(false)
  })

  it('addresses both reads at the deployer the creator picked', () => {
    mockFactoryRead.mockReturnValue(got(HOOK_FACTORY))
    mockBipsRead.mockReturnValue(got(50n))
    ask(DEPLOYER)
    expect(optsOf(mockFactoryRead).address).toBe(DEPLOYER)
    expect(optsOf(mockBipsRead).address).toBe(DEPLOYER)
  })
})
