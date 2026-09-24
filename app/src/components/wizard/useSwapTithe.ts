/**
 * useSwapTithe — does the selected liquidity deployer mint an alignment hook, and at what rate?
 *
 * The wizard used to answer this with a conditional: the graduated pool "can carry" a hook that
 * taxes every swap. True, and useless — the app never asked. The deployer is a public contract and
 * it knows: `alignmentHookFactory()` is the switch (`address(0)` = no hook, the ship default) and
 * `hookFeeBips()` is the rate baked into each hook it mints. Both are public getters on
 * `LiquidityDeployerModule`, so this reads them off whichever deployer the creator picked and lets
 * the alignment step state the answer instead of the possibility.
 *
 * Only the Uniswap V4 deployer declares them. `ZAMMLiquidityDeployerModule` declares neither, by
 * decision rather than oversight — the perpetual tithe is a Uni-V4-venue feature — so an
 * `alignmentHookFactory()` call to it matches no function and reverts. That revert is NOT a zero
 * factory, and the difference is the whole point of the hook: `isError` becomes `unknown` (the
 * wizard then says nothing about a tithe), while a successful read of `address(0)` becomes
 * `untaxed` (the wizard says so plainly). An unreachable RPC lands in `unknown` for the same
 * reason — from here it is indistinguishable from a missing getter, and neither is evidence that a
 * pool is untaxed.
 *
 * `retry: false`: a deployer without the getter reverts deterministically, and three more attempts
 * only delay the silence. With no deployer chosen yet nothing is asked and the answer is `unknown`,
 * which is the truth: an unanswered question is not a zero.
 */
import {
  useReadLiquidityDeployerModuleAlignmentHookFactory,
  useReadLiquidityDeployerModuleHookFeeBips,
} from '../../generated/contracts'
import { forkChainId } from '../../lib/addresses'
import type { SwapTithe } from '../../lib/vaults/alignmentWording'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/**
 * @param deployer the liquidity-deployer module the wizard has selected, or undefined while the
 *        slot is empty (or the project type has no such slot).
 * @param enabled false suppresses the reads entirely — used for the standards that graduate into
 *        no pool at all, where the question does not arise.
 */
export function useSwapTithe(deployer: `0x${string}` | undefined, enabled = true): SwapTithe {
  const asking = Boolean(deployer) && enabled
  const at = deployer ? { address: deployer } : {}

  const factory = useReadLiquidityDeployerModuleAlignmentHookFactory({
    ...at,
    chainId: forkChainId,
    query: { enabled: asking, retry: false },
  })

  // Deliberately chained rather than fired in parallel: the rate is meaningless while the switch is
  // off, and on a deployer that has no getters the second call would only be a second revert.
  const hasHook = factory.data !== undefined && factory.data !== ZERO_ADDRESS
  const bips = useReadLiquidityDeployerModuleHookFeeBips({
    ...at,
    chainId: forkChainId,
    query: { enabled: asking && hasHook, retry: false },
  })

  if (!asking) return { kind: 'unknown' }
  if (factory.isError) return { kind: 'unknown' }
  if (factory.data === undefined) return { kind: 'pending' }
  if (factory.data === ZERO_ADDRESS) return { kind: 'untaxed' }
  if (bips.isError) return { kind: 'unknown' }
  if (bips.data === undefined) return { kind: 'pending' }
  return { kind: 'taxed', feeBips: bips.data }
}
