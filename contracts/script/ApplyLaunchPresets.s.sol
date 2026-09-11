// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { LaunchManager } from "../src/factories/erc404/LaunchManager.sol";
import { LaunchPresets } from "./LaunchPresets.sol";

/// @notice Bring a deployed `LaunchManager`'s preset ladder up to the one this repo ships.
///
///         Run with:
///         forge script script/ApplyLaunchPresets.s.sol --rpc-url sepolia \
///             --account <keystore> --broadcast
///
///         ── WHY THIS EXISTS AS A SCRIPT AND NOT AS THREE `cast send` CALLS ──
///
///         A preset is read ONCE, at create: `ERC404Factory._deployAndInitialize` copies it into the
///         instance's stored bonding params, and no later `setPreset` reaches a collection that
///         already exists. So a rung that is wrong when a creator launches is wrong for that
///         collection forever — `unitPerNFT` fixes `maxSupply = nftCount * unitPerNFT * 1e18` against
///         DN404's `uint96`, which is a permanent ceiling on the pieces it may ever have. Retuning
///         the ladder in `DeployCore` therefore does nothing to a chain that is already deployed,
///         and the CREATE3 salt set is single-use per deployer, so "re-run the deploy" is not
///         available either. The gap is closed by an owner call, and an owner call typed by hand is
///         an eight-digit number typed by hand.
///
///         This reads the ladder from `LaunchPresets` — the same statement `DeployCore` writes and
///         `ValidateSepolia` asserts — and writes only the rungs that differ, so a second run after
///         a successful one broadcasts nothing.
contract ApplyLaunchPresets is Script {
    string internal constant DEPLOYMENT_PATH = "./deployments/sepolia.json";

    function run() public {
        LaunchManager lm = LaunchManager(_launchManager());
        address owner = lm.owner();
        console.log("LaunchManager:", address(lm));
        console.log("owner:", owner);
        console.log("");

        // The curve computer is per-deployment and this script does not touch it: each rung is
        // rewritten carrying the computer it already has, so a chain whose computer was migrated
        // keeps the migrated one. Its approval under the `curve_computer` tag is ValidateSepolia's
        // assertion, not this script's.
        uint256 changed;
        for (uint256 i = 0; i < LaunchPresets.COUNT; i++) {
            LaunchManager.Preset memory live = lm.getPreset(i);
            LaunchManager.Preset memory shipped = LaunchPresets.preset(i, live.curveComputer);

            if (
                live.targetETH == shipped.targetETH && live.unitPerNFT == shipped.unitPerNFT
                    && live.liquidityReserveBps == shipped.liquidityReserveBps && live.active == shipped.active
            ) {
                console.log("preset", i, "already matches the shipped ladder; unitPerNFT:", live.unitPerNFT);
                continue;
            }

            console.log("preset", i, "unitPerNFT on chain:", live.unitPerNFT);
            console.log("    max pieces on chain:", LaunchPresets.maxNftSupply(live.unitPerNFT));
            console.log("    shipped unitPerNFT:", shipped.unitPerNFT);
            console.log("    max pieces shipped:", LaunchPresets.maxNftSupply(shipped.unitPerNFT));

            vm.broadcast(owner);
            lm.setPreset(i, shipped);
            changed++;
        }

        console.log("");
        console.log("rungs rewritten:", changed);
    }

    /// @dev Overridden in the test, which stands a LaunchManager up in memory rather than reading a
    ///      record off disk. Production behaviour is the default.
    function _launchManager() internal view virtual returns (address addr) {
        addr = vm.parseJsonAddress(vm.readFile(DEPLOYMENT_PATH), ".contracts.LaunchManager");
        require(addr != address(0), "LaunchManager: deployment record holds the zero address");
        require(addr.code.length > 0, "LaunchManager: no code at the address in the deployment record");
    }
}
