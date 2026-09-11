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
    /// @dev The reserve is validated against the preset's OWN curve computer rather than against a
    ///      bound written down here. `(0, 10000)` is the arithmetically legal range for a bps, but it
    ///      is far wider than the range a curve can actually be solved over: the reserve fixes the
    ///      pool parity target, and a target outside the multiples the computer's pole band reaches
    ///      is unreachable. A preset stored outside that band used to be accepted here and then
    ///      reverted at EVERY create against it — the setter accepted what the curve could not solve.
    ///      Asking the computer keeps the bound in one place; a copy of the numbers here would be a
    ///      second definition, and a retune of the computer's shape constants would silently put the
    ///      two out of agreement.
    function setPreset(uint256 presetId, Preset calldata preset) external onlyOwner {
        if (preset.targetETH == 0) revert InvalidTargetETH();
        if (preset.unitPerNFT == 0) revert InvalidUnitPerNFT();
        // Checked before the reserve, which is validated by calling into this address.
        if (preset.curveComputer == address(0)) revert InvalidCurveComputer();
        if (!ICurveComputer(preset.curveComputer).isReserveBpsAdmissible(preset.liquidityReserveBps)) {
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
