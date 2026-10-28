// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BondingCurveMath } from "../factories/erc404/libraries/BondingCurveMath.sol";

/// @notice Interface for bonding curve parameter computers.
///         Implementations are registered in ComponentRegistry under keccak256("curve").
///         Called once at instance creation time; the address is not stored on the instance.
interface ICurveComputer {
    /// @notice Compute bonding curve parameters from graduation preset inputs.
    function computeCurveParams(uint256 nftCount, uint256 targetETH, uint256 unitPerNFT, uint256 liquidityReserveBps)
        external
        view
        returns (BondingCurveMath.Params memory);

    /// @notice Whether this computer can actually solve a curve for a given liquidity reserve.
    /// @dev The admissible reserve band is implied by the implementation's own curve shape limits,
    ///      because the parity target the reserve sets must land inside the multiples those limits can
    ///      reach. The answer is a property of this computer, not a constant others can hardcode.
    ///      Callers that store a reserve ahead of any create (LaunchManager.setPreset) ask here
    ///      instead of carrying a copy of the band, so the bound has one definition and a preset the
    ///      computer could never serve is refused at store time rather than on a creator's `create`.
    ///      MUST NOT revert: a reserve this computer cannot serve is `false`, not an error.
    /// @param liquidityReserveBps Bps of total supply reserved for liquidity.
    /// @return admissible True if `computeCurveParams` can return params for this reserve.
    function isReserveBpsAdmissible(uint256 liquidityReserveBps) external view returns (bool admissible);
}
