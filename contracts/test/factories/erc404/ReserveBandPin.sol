// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The admissible `liquidityReserveBps` band, written down once for the tests (noesis-255).
/// @dev These numbers are a PIN, not a definition. The band itself is derived on-chain by
///      `CurveParamsComputer.isReserveBpsAdmissible` from that contract's own `MIN_POLE_WAD` /
///      `MAX_POLE_WAD`: the parity target `G = 0.8 * (1 - r) / r` a reserve sets must land inside the
///      multiples the pole band can reach, or `solvePole` reverts `ParityTargetUnreachable`.
///
///      The values below are what that derivation evaluates to today. They live here so a change to
///      either pole constant — which silently moves which presets are launchable, and which
///      `LaunchManager.setPreset` now refuses at store time — cannot land unannounced: it breaks
///      these tests instead. Tests inherit this rather than each declaring its own copy, so the pin
///      has a single home and two test files cannot drift apart.
abstract contract ReserveBandPin {
    uint256 internal constant MIN_RESERVE_BPS = 592;
    uint256 internal constant MAX_RESERVE_BPS = 3567;
}
