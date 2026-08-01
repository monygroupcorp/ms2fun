// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { IAlignmentVault } from "../../../interfaces/IAlignmentVault.sol";

/**
 * @title IAlignmentHook
 * @notice Marker interface every alignment-hook TYPE must implement so it can be plugged into a
 *         graduated pool as a swappable addon. It is a Uniswap v4 hook (`is IHooks`) that additionally
 *         surfaces the three immutables a graduation needs to inspect: the fee it takes, the benefactor
 *         it credits, and the vault it forwards to.
 * @dev Type #1 is `UniAlignmentV4Hook` (deployed by `UniTitheHookFactory`). The interface is
 *      structural — the hook already exposes these as public immutables; declaring `is IAlignmentHook`
 *      binds the type to the marker without any logic change.
 */
interface IAlignmentHook is IHooks {
    /// @notice Hook fee in basis points taken on the ETH side of swaps (immutable, set at deploy).
    function hookFeeBips() external view returns (uint256);

    /// @notice The fixed identity credited for this pool's swap-fee contributions (immutable).
    function benefactor() external view returns (address);

    /// @notice The alignment vault swap fees are forwarded to (immutable).
    function vault() external view returns (IAlignmentVault);
}
