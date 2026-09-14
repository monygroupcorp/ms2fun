// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BondingCurveMath } from "../factories/erc404/libraries/BondingCurveMath.sol";

/// @notice Interface for bonding curve parameter computers.
///         Implementations are registered in ComponentRegistry under keccak256("curve").
///         Called once at instance creation time — address is NOT stored on the instance.
interface ICurveComputer {
    /// @notice Compute bonding curve parameters from graduation preset inputs.
    function computeCurveParams(uint256 nftCount, uint256 targetETH, uint256 unitPerNFT, uint256 liquidityReserveBps)
        external
        view
        returns (BondingCurveMath.Params memory);

    /// @notice Whether this computer can solve a curve for `liquidityReserveBps` at all.
    /// @dev A curve computer's shape constants decide which LP reserves are serviceable, and the
    ///      answer is a property of THIS computer — not of the caller, and not a constant anyone
    ///      else can hardcode without it drifting the next time those constants move. So the
    ///      question is asked here rather than answered elsewhere: `LaunchManager.setPreset` calls
    ///      this on the preset's own `curveComputer` and refuses a preset the computer could never
    ///      serve, instead of storing it and failing on a creator's `create` much later.
    ///      MUST NOT revert — a reserve this computer cannot serve is `false`, not an error.
    /// @param liquidityReserveBps Bps of total supply reserved for liquidity.
    /// @return supported True if `computeCurveParams` can solve at this reserve.
    function supportsReserveBps(uint256 liquidityReserveBps) external view returns (bool supported);
}
