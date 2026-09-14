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

    /// @notice Whether this computer can actually solve a curve for a given liquidity reserve.
    /// @dev The admissible reserve band is not an independent policy number — it is implied by the
    ///      implementation's own curve shape limits, because the parity target the reserve sets must
    ///      land inside the multiples those limits can reach. Callers that STORE a reserve ahead of
    ///      any create (LaunchManager.setPreset) ask here instead of carrying a copy of the band, so
    ///      the bound has exactly one definition: this implementation's.
    /// @param liquidityReserveBps Bps of total supply reserved for liquidity.
    /// @return admissible True if `computeCurveParams` can return params for this reserve.
    function isReserveBpsAdmissible(uint256 liquidityReserveBps) external view returns (bool admissible);
}
