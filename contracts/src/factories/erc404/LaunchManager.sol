// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "solady/auth/Ownable.sol";

import { ICurveComputer } from "../../interfaces/ICurveComputer.sol";

/**
 * @title LaunchManager
 * @notice Holds graduation presets for ERC404Factory instances.
 *         Each preset defines the economic parameters for a bonding curve.
 */
contract LaunchManager is Ownable {
    error InvalidProtocol();
    error InvalidTargetETH();
    error InvalidUnitPerNFT();
    error InvalidReserveBps();
    error InvalidCurveComputer();
    error PresetNotActive();

    /// @notice Economic parameters for a graduation preset.
    struct Preset {
        uint256 targetETH;
        uint256 unitPerNFT;
        uint256 liquidityReserveBps;
        address curveComputer; // DAO-approved ICurveComputer for this preset
        bool active;
    }

    mapping(uint256 => Preset) private _presets;

    event PresetUpdated(uint256 indexed presetId, uint256 targetETH, address curveComputer, bool active);

    constructor(address _protocol) {
        if (_protocol == address(0)) revert InvalidProtocol();
        _initializeOwner(_protocol);
    }

    /// @notice Set or update a graduation preset. Only callable by owner (DAO).
    /// @dev `liquidityReserveBps` is checked TWICE, and the second check is the one that matters.
    ///      `(0, 10000)` is only the arithmetic range; the reserves a collection can actually be
    ///      created at are a much narrower band, because the curve computer solves the pole that
    ///      puts the curve's end price at the pool's opening price and refuses a parity target its
    ///      pole band cannot reach. At today's constants that band is 592..3567 bps, so a preset
    ///      anywhere in the other ~7,000 values stores cleanly, emits `PresetUpdated`, reads back
    ///      live from `getPreset` — and then reverts every `create` made against it, on a CREATOR's
    ///      transaction, with an error from a contract they never named.
    ///
    ///      The band is not written down here on purpose. It is a consequence of the computer's own
    ///      shape constants, so the computer is asked (`supportsReserveBps`) rather than copied; a
    ///      constant in this file would go quietly wrong the day those constants move, and a preset
    ///      names its own `curveComputer`, so the right answer is per-preset in any case.
    function setPreset(uint256 presetId, Preset calldata preset) external onlyOwner {
        if (preset.targetETH == 0) revert InvalidTargetETH();
        if (preset.unitPerNFT == 0) revert InvalidUnitPerNFT();
        if (preset.liquidityReserveBps == 0 || preset.liquidityReserveBps >= 10000) revert InvalidReserveBps();
        if (preset.curveComputer == address(0)) revert InvalidCurveComputer();
        if (!ICurveComputer(preset.curveComputer).supportsReserveBps(preset.liquidityReserveBps)) {
            revert InvalidReserveBps();
        }
        _presets[presetId] = preset;
        emit PresetUpdated(presetId, preset.targetETH, preset.curveComputer, preset.active);
    }

    /// @notice Get a graduation preset. Reverts if not active.
    function getPreset(uint256 presetId) external view returns (Preset memory) {
        Preset memory p = _presets[presetId];
        if (!p.active) revert PresetNotActive();
        return p;
    }
}
