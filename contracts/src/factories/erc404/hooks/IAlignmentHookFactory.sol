// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IAlignmentVault } from "../../../interfaces/IAlignmentVault.sol";

/**
 * @title IAlignmentHookFactory
 * @notice Type-agnostic factory that deterministically deploys a permission-bit-valid Uniswap v4
 *         alignment hook per graduation. Each hook-TYPE registers one factory under the
 *         `FeatureUtils.ALIGNMENT_HOOK` component tag; a graduation selects a factory and calls
 *         `deployHook` to mint the pool's hook.
 * @dev The factory on-chain mines a CREATE2 salt so the deployed address carries EXACTLY the hook's
 *      required Uniswap v4 permission bits (and no others), then CREATE2-deploys the hook. The hook's
 *      constructor `validateHookPermissions()` is the on-chain guard: a mis-mined address reverts the
 *      deploy. Environment/governance parameters a hook needs beyond the per-graduation set
 *      (PoolManager, WETH, the hook owner) are held as factory immutables, set when the factory is
 *      deployed and registered (117b / DeployCore) — so `deployHook`'s surface is exactly the
 *      per-graduation data. That data includes the pool the hook will serve (`poolToken`,
 *      `poolTickSpacing`): a hook binds its whole `PoolKey`, so the pool is part of the hook's identity
 *      and therefore of the address it is mined to, not something set on it afterwards.
 */
interface IAlignmentHookFactory {
    /**
     * @notice Deploy the alignment hook for a graduating pool at a permission-bit-valid address.
     * @dev Deterministic and idempotent in its arguments: the hook address is derived from the factory and
     *      the argument set, so a call for which the hook already exists at that address returns the
     *      existing hook instead of reverting on the CREATE2 collision. Callers must read the return value
     *      as "the hook for this argument set", not "a hook created by this call".
     * @param vault The alignment vault the hook forwards swap fees to.
     * @param benefactor The fixed identity credited for the pool's fee contributions.
     * @param hookFeeBips The hook fee in basis points (taken on the ETH side of swaps).
     * @param lpFeeRate The initial dynamic LP fee rate the hook overrides pools with.
     * @param poolToken The alignment token the graduation pool is paired against native ETH, i.e. the
     *        pool's `currency1`. The hook binds it and serves no other pool (audit L-6).
     * @param poolTickSpacing The graduation pool's tick spacing, bound for the same reason.
     * @return hook The deployed hook address (carries the required permission bits).
     */
    function deployHook(
        IAlignmentVault vault,
        address benefactor,
        uint256 hookFeeBips,
        uint24 lpFeeRate,
        address poolToken,
        int24 poolTickSpacing
    ) external returns (address hook);

    /**
     * @notice The Uniswap v4 permission-bit mask this hook type's addresses must satisfy.
     * @return required Bits that MUST be set in a valid hook address.
     * @return forbidden Bits that must NOT be set in a valid hook address.
     */
    function hookFlags() external view returns (uint160 required, uint160 forbidden);
}
