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
    /// @dev The reserve is validated against the preset's own curve computer, not a bound held here.
    ///      The reserve fixes the pool parity target, and only a band narrower than (0, 10000) bps is
    ///      solvable by a curve; a reserve outside it would store and read back but revert every
    ///      `create` on the creator's transaction. The computer owns the band, so there is one
    ///      definition, and it is per-preset because each preset names its own `curveComputer`.
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
