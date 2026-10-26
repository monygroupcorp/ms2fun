// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { LaunchManager } from "../src/factories/erc404/LaunchManager.sol";

/// @notice The three protocol launch presets (NICHE / STANDARD / HYPE), stated once.
///
///         `unitPerNFT` is the rung, and the three rungs are a decade apart. It is not a taste knob:
///         `maxSupply = nftCount * unitPerNFT * 1e18` and DN404 holds total supply in a `uint96`, so
///         the unit fixes a hard ceiling on how many pieces a collection may ever have,
///         `type(uint96).max / (unitPerNFT * 1e18)`, which `maxNftSupply` computes:
///
///           NICHE     1e6 units/NFT →     79,228 pieces
///           STANDARD  1e5 units/NFT →    792,281 pieces
///           HYPE      1e3 units/NFT → 79,228,162 pieces
///
///         Tighter spacing makes the rungs meaningless to a creator choosing between them; a factor
///         of a thousand would collapse a ceiling to 79 pieces. Retuning a rung moves that ceiling,
///         so a change here belongs with the wizard's ceiling test.
///
///         A library so the three readers of the ladder cannot disagree: the script that writes it to
///         a fresh chain, the validator that asserts a live chain carries it, and the curve-solver
///         test that pins what each rung does to the bonding maths.
library LaunchPresets {
    /// @notice How many presets the protocol ships. Ids are `0 ..< COUNT`.
    uint256 internal constant COUNT = 3;

    /// @notice The shipped preset for `presetId`, bound to the curve computer this deployment approved.
    /// @dev    `curveComputer` is the one per-deployment field: a `CurveParamsComputer` deployed on
    ///         each chain. A caller that only wants the economics, such as a validator comparing a
    ///         live read, passes the address it read back and compares the whole struct.
    function preset(uint256 presetId, address curveComputer) internal pure returns (LaunchManager.Preset memory) {
        require(presetId < COUNT, "LaunchPresets: no such preset");
        uint256[COUNT] memory targets = [uint256(5 ether), 25 ether, 50 ether];
        uint256[COUNT] memory units = [uint256(1_000_000), 100_000, 1_000];
        return LaunchManager.Preset({
            targetETH: targets[presetId],
            unitPerNFT: units[presetId],
            liquidityReserveBps: 1000,
            curveComputer: curveComputer,
            active: true
        });
    }

    /// @notice The hard ceiling on pieces a collection created under `unitPerNFT` may ever have.
    /// @dev    `ERC404Factory` computes `maxSupply = nftCount * unitPerNFT * 1e18` into DN404's
    ///         `uint96` total supply, so this is the largest `nftCount` that does not overflow it.
    function maxNftSupply(uint256 unitPerNFT) internal pure returns (uint256) {
        return uint256(type(uint96).max) / (unitPerNFT * 1e18);
    }
}
