// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { LaunchManager } from "../src/factories/erc404/LaunchManager.sol";
import { LaunchPresets } from "./LaunchPresets.sol";

/// @notice Bring a deployed `LaunchManager`'s preset ladder up to the one this repo ships.
///
///         Run with:
///         LAUNCH_MANAGER=<address> forge script script/ApplyLaunchPresets.s.sol --rpc-url sepolia \
///             --account <keystore> --broadcast
///
///         `LAUNCH_MANAGER` may be omitted on a chain whose deploy run left a record at
///         `deployments/sepolia.json`. Without `--broadcast` the script reads the chain and prints
///         the drift; it sends nothing until a rung actually differs.
///
///         A preset is read once, at create: `ERC404Factory._deployAndInitialize` copies it into the
///         instance's stored bonding params, and no later `setPreset` reaches an existing collection.
///         `unitPerNFT` fixes `maxSupply = nftCount * unitPerNFT * 1e18` against DN404's `uint96`, a
///         permanent ceiling on the pieces a collection may have. Retuning the ladder in `DeployCore`
///         does not touch a deployed chain, and a re-run of the deploy cannot either: a CREATE3 salt is
///         single-use per deployer, so it stands up a second protocol at fresh addresses. The owner
///         call that retunes the live ladder is scripted here so the numbers are never typed by hand.
///
///         The ladder is read from `LaunchPresets`, the statement `DeployCore` writes and
///         `ValidateSepolia` asserts. Only the rungs that differ are written, so a second run after
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

    /// @dev Which LaunchManager to bring up to the ladder. `LAUNCH_MANAGER` wins over the record: a
    ///      deployment record is a broadcast artifact describing only the deployment that wrote it,
    ///      so a chain whose live protocol has no such record can only be addressed by env var.
    ///      `MigrateOwnership` takes the same env var for this contract. The record is the fallback,
    ///      so a freshly deployed chain needs no env var. Both paths reject a zero address and an
    ///      address with no code on the RPC in hand, which is a pointer at the wrong chain.
    function _launchManager() internal view virtual returns (address addr) {
        addr = _envLaunchManager();
        if (addr != address(0)) {
            console.log("LaunchManager source: LAUNCH_MANAGER");
        } else {
            console.log("LaunchManager source:", DEPLOYMENT_PATH);
            addr = vm.parseJsonAddress(_deploymentJson(), ".contracts.LaunchManager");
            require(addr != address(0), "LaunchManager: deployment record holds the zero address");
        }
        require(addr.code.length > 0, "LaunchManager: no code at the resolved address");
    }

    /// @dev Overridden in the test to supply a record in memory. Mirrors the seam in `ValidateSepolia`.
    function _deploymentJson() internal view virtual returns (string memory) {
        return vm.readFile(DEPLOYMENT_PATH);
    }

    /// @dev The override as the operator supplies it, `address(0)` when unset. Its own seam because
    ///      the process environment is global to a forge run and concurrent test cases would race on
    ///      `LAUNCH_MANAGER`; overriding it lets the precedence in `_launchManager` be tested
    ///      deterministically.
    function _envLaunchManager() internal view virtual returns (address) {
        return vm.envOr("LAUNCH_MANAGER", address(0));
    }
}
