/**
 * Resolve the CurveParamsComputer singleton address at runtime.
 *
 * WHY runtime resolution: CurveParamsComputer is a pure-math singleton, but it is NOT exposed in
 * `src/lib/addresses` and this slice may not edit that file. DeployCore registers it in the
 * ComponentRegistry under the `bytes32("curve_computer")` tag (and serializes it to the deployment
 * JSON). So we read `ComponentRegistry.getApprovedComponentsByTag("curve_computer")` and take the
 * first approved computer — exactly the address the factory used to compute each instance's curve.
 *
 * The instance's `calculateCost`/`calculateRefund` are PURE and identical to the inline
 * `BondingCurveMath` the contract uses, so quoting against this singleton with the instance's own
 * `curveParams()` reproduces the on-chain cost precisely.
 */
import { useReadComponentRegistryGetApprovedComponentsByTag } from '../../../generated/contracts'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { CURVE_COMPUTER_TAG } from './gating'

export interface CurveComputer {
  /** Resolved CurveParamsComputer address, or undefined until resolved / if none approved. */
  address: `0x${string}` | undefined
  isPending: boolean
  isError: boolean
}

export function useCurveComputer(): CurveComputer {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const { data, isPending, isError } = useReadComponentRegistryGetApprovedComponentsByTag({
    address: addresses.ComponentRegistry,
    chainId: chainId,
    args: [CURVE_COMPUTER_TAG],
  })

  const address = data && data.length > 0 ? data[0] : undefined
  return { address, isPending, isError }
}
