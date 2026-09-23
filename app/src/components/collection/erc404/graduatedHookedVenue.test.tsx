/**
 * A HOOKED graduation pool is traded against `AlignmentHookSwapRouter`, and every address the panel
 * hands the wallet on that path names that router rather than the aggregator.
 *
 * WHY THIS FILE EXISTS, WHEN THE PANEL ALREADY HAS TESTS. The other graduated-panel suites define
 * only hookless venues — they stub the hooked-pool hooks purely so the unused calls do not reach for
 * a real wagmi config — so the hooked branch of the panel was rendered by nothing. That is not a
 * coverage footnote. The hooked path is the one whose allowance target, approve target and write
 * target all have a plausible-looking wrong answer sitting one identifier away: `zRouter`. An
 * unrelated change once rewrote exactly those lines from the hooked router back to the aggregator;
 * it merged clean, TypeScript stayed green, and the only symptom would have been a seller approving
 * the aggregator and then watching the trade revert inside the periphery's `transferFrom`, with
 * their tokens never pulled and no way to tell why. A type cannot catch that — both are addresses.
 * These cases can, because they read the address the panel actually passes.
 *
 * The last case covers the same branch's other failure: which writer `trade again` resets. A panel
 * that resets the aggregator's writer after signing through the periphery leaves the submitted hash
 * in place, so the confirmed-swap screen renders itself again forever and the button does nothing.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { maxUint256, zeroAddress } from 'viem'
import { GraduatedSwapPanel, type EmbeddableVenue } from './GraduatedSwapPanel'
import { DYNAMIC_FEE_FLAG } from './useGraduatedVenue'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const DEPLOYER = '0x3333333333333333333333333333333333333333' as const
/** The alignment hook in this instance's pool key — the member zRouter has no argument for. */
const HOOK = '0x5555555555555555555555555555555555555555' as const
/** The aggregator. Correct for a hookless pool, and the wrong answer everywhere in this file. */
const ZROUTER = '0x6666666666666666666666666666666666666666' as const
const TRADER = '0x7777777777777777777777777777777777777777' as const
/** The periphery a hooked pool is traded through, and the address every assertion here expects. */
const HOOKED_ROUTER = '0x8888888888888888888888888888888888888888' as const

const QUOTE_OUT = 1_000n * 10n ** 18n
const TICK_SPACING = 60

/** Everything the mocked hooks record or replay. Hoisted so `vi.mock` factories can close over it. */
const spy = vi.hoisted(() => ({
  allowanceArgs: [] as (readonly unknown[] | undefined)[],
  approveWrite: vi.fn(),
  hookedWrite: vi.fn(),
  v4Write: vi.fn(),
  vzWrite: vi.fn(),
  hookedReset: vi.fn(),
  v4Reset: vi.fn(),
  vzReset: vi.fn(),
  /** Set to a hash to put the panel on its confirmed-swap screen through the HOOKED writer. */
  hookedTxHash: undefined as `0x${string}` | undefined,
}))

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useAccount: () => ({ address: TRADER, isConnected: true }),
  // A receipt resolves iff that writer submitted something — so success follows the writer whose
  // hash was actually read, which is the distinction the last case turns on.
  useWaitForTransactionReceipt: ({ hash }: { hash?: `0x${string}` }) => ({
    isLoading: false,
    isSuccess: hash !== undefined,
  }),
}))

vi.mock('../../../generated/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../generated/contracts')>()),
  useReadErc404BondingInstanceSymbol: () => ({ data: 'DEMO' }),
  useReadErc404BondingInstanceAllowance: (config: { args?: readonly unknown[] }) => {
    spy.allowanceArgs.push(config.args)
    // Zero, so the sell direction sits on the approve step where the target can be read.
    return { data: 0n, refetch: vi.fn() }
  },
  useReadErc404BondingInstanceBalanceOf: () => ({ data: QUOTE_OUT, refetch: vi.fn() }),
  useSimulateAlignmentHookSwapRouterSwap: () => ({
    data: { result: [1n, QUOTE_OUT] },
    error: null,
    isFetching: false,
  }),
  useSimulateZRouterSwapV4: () => ({ data: undefined, error: null, isFetching: false }),
  useSimulateZRouterSwapVz: () => ({ data: undefined, error: null, isFetching: false }),
  useWriteErc404BondingInstanceApprove: () => ({
    isPending: false,
    writeContract: spy.approveWrite,
  }),
  useWriteAlignmentHookSwapRouterSwap: () => ({
    data: spy.hookedTxHash,
    error: null,
    isPending: false,
    reset: spy.hookedReset,
    writeContract: spy.hookedWrite,
  }),
  useWriteZRouterSwapV4: () => ({
    data: undefined,
    error: null,
    isPending: false,
    reset: spy.v4Reset,
    writeContract: spy.v4Write,
  }),
  useWriteZRouterSwapVz: () => ({
    data: undefined,
    error: null,
    isPending: false,
    reset: spy.vzReset,
    writeContract: spy.vzWrite,
  }),
}))

vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1337,
  useCollectionAddresses: () => ({ zRouter: ZROUTER, AlignmentHookSwapRouter: HOOKED_ROUTER }),
}))

/** A collection that graduated AFTER the hook switch: dynamic fee, and a hook in the key. */
const HOOKED: EmbeddableVenue = {
  kind: 'uniV4',
  deployer: DEPLOYER,
  poolFee: DYNAMIC_FEE_FLAG,
  tickSpacing: TICK_SPACING,
  hook: HOOK,
}
/** The same venue from before the switch, for contrast: static fee, no hook, aggregator's business. */
const HOOKLESS: EmbeddableVenue = {
  kind: 'uniV4',
  deployer: DEPLOYER,
  poolFee: 3000,
  tickSpacing: TICK_SPACING,
}

function mount(venue: EmbeddableVenue): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <GraduatedSwapPanel instance={INSTANCE} venue={venue} decimals={18} refetch={vi.fn()} />
    </QueryClientProvider>,
  )
}

/** Put an amount in the box and switch to the sell direction, which is the approve-then-swap one. */
function enterSellAmount(): void {
  fireEvent.click(screen.getByTestId('erc404-graduated-direction-sell'))
  fireEvent.change(screen.getByTestId('erc404-graduated-amount-input'), { target: { value: '1' } })
}

beforeEach(() => {
  spy.allowanceArgs.length = 0
  spy.hookedTxHash = undefined
  spy.approveWrite.mockClear()
  spy.hookedWrite.mockClear()
  spy.v4Write.mockClear()
  spy.vzWrite.mockClear()
  spy.hookedReset.mockClear()
  spy.v4Reset.mockClear()
  spy.vzReset.mockClear()
})
afterEach(cleanup)

test('a hooked venue checks its allowance against the periphery, a hookless one against the aggregator', () => {
  mount(HOOKED)
  expect(spy.allowanceArgs.at(-1)).toEqual([TRADER, HOOKED_ROUTER])
  cleanup()

  spy.allowanceArgs.length = 0
  mount(HOOKLESS)
  expect(spy.allowanceArgs.at(-1)).toEqual([TRADER, ZROUTER])
})

test('a hooked sell approves the contract that will pull the tokens, not the aggregator', () => {
  mount(HOOKED)
  enterSellAmount()

  fireEvent.click(screen.getByTestId('erc404-graduated-approve'))

  expect(spy.approveWrite).toHaveBeenCalledTimes(1)
  const call = spy.approveWrite.mock.calls[0]?.[0] as { address: string; args: unknown[] }
  expect(call.address).toBe(INSTANCE)
  expect(call.args).toEqual([HOOKED_ROUTER, maxUint256])
  // Approving the aggregator would be the silent version of this defect: the allowance lands, the
  // button clears, and the sell then reverts inside the periphery's own `transferFrom`.
  expect(call.args[0]).not.toBe(ZROUTER)
})

test('a hooked buy is signed against the periphery, with the pool key the aggregator cannot express', () => {
  mount(HOOKED)
  fireEvent.change(screen.getByTestId('erc404-graduated-amount-input'), { target: { value: '1' } })

  fireEvent.click(screen.getByTestId('erc404-graduated-swap-submit'))

  expect(spy.v4Write).not.toHaveBeenCalled()
  expect(spy.vzWrite).not.toHaveBeenCalled()
  expect(spy.hookedWrite).toHaveBeenCalledTimes(1)

  const call = spy.hookedWrite.mock.calls[0]?.[0] as { address: string; args: unknown[] }
  expect(call.address).toBe(HOOKED_ROUTER)
  // All five members of the key, because a PoolKey is identified by all five: the hook AND the
  // dynamic fee that comes with it. A key carrying the static tier names a third pool that exists
  // nowhere, which is the failure this whole path was built to end.
  expect(call.args[0]).toEqual({
    currency0: zeroAddress,
    currency1: INSTANCE,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: TICK_SPACING,
    hooks: HOOK,
  })
})

test('after a hooked trade confirms, "trade again" resets the writer that signed', () => {
  spy.hookedTxHash = '0xabc0000000000000000000000000000000000000000000000000000000000001'
  mount(HOOKED)

  // The hooked writer holds a hash, so the panel is on its confirmed screen.
  fireEvent.click(screen.getByTestId('erc404-graduated-again'))

  expect(spy.hookedReset).toHaveBeenCalledTimes(1)
  // Resetting the aggregator's writer here clears nothing: the hooked writer keeps its hash, the
  // receipt stays successful, and the panel renders this same screen again — a dead button.
  expect(spy.v4Reset).not.toHaveBeenCalled()
  expect(spy.vzReset).not.toHaveBeenCalled()
})
