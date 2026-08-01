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
 *      per-graduation data.
 */
interface IAlignmentHookFactory {
    /**
     * @notice Deploy a fresh alignment hook for a graduating pool at a permission-bit-valid address.
     * @param vault The alignment vault the hook forwards swap fees to.
     * @param benefactor The fixed identity credited for the pool's fee contributions.
     * @param hookFeeBips The hook fee in basis points (taken on the ETH side of swaps).
     * @param lpFeeRate The initial dynamic LP fee rate the hook overrides pools with.
     * @return hook The deployed hook address (carries the required permission bits).
     */
    function deployHook(IAlignmentVault vault, address benefactor, uint256 hookFeeBips, uint24 lpFeeRate)
        external
        returns (address hook);

    /**
     * @notice The Uniswap v4 permission-bit mask this hook type's addresses must satisfy.
     * @return required Bits that MUST be set in a valid hook address.
     * @return forbidden Bits that must NOT be set in a valid hook address.
     */
    function hookFlags() external view returns (uint160 required, uint160 forbidden);
}
