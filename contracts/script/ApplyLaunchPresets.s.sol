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
///         `deployments/sepolia.json`; see `_launchManager` for why the live Sepolia protocol is
///         not such a chain. Drop `--broadcast` to read the chain and print the drift without
///         sending anything — the run is read-only until a rung actually differs.
///
///         ── WHY THIS EXISTS AS A SCRIPT AND NOT AS THREE `cast send` CALLS ──
///
///         A preset is read ONCE, at create: `ERC404Factory._deployAndInitialize` copies it into the
///         instance's stored bonding params, and no later `setPreset` reaches a collection that
///         already exists. So a rung that is wrong when a creator launches is wrong for that
///         collection forever — `unitPerNFT` fixes `maxSupply = nftCount * unitPerNFT * 1e18` against
///         DN404's `uint96`, which is a permanent ceiling on the pieces it may ever have. Retuning
///         the ladder in `DeployCore` therefore does nothing to a chain that is already deployed.
///         Nor does re-running the deploy reach it: a CREATE3 salt is single-use per deployer, so a
///         fresh run cannot land on the addresses that are live — it stands a SECOND protocol up
///         beside the first, at fresh addresses, and the first keeps the ladder it was born with.
///         Re-deploying is a choice about which protocol the network points at; it is not a way to
///         retune the one already there. That gap is closed by an owner call, and an owner call
///         typed by hand is an eight-digit number typed by hand.
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

    /// @dev Which LaunchManager to bring up to the ladder. `LAUNCH_MANAGER` wins over the record,
    ///      and it has to, because the chain that needs this script most is the one with no record:
    ///      a deployment record is a BROADCAST artifact written by the deploy run itself, so it
    ///      describes the deployment that wrote it and no other. Sepolia's live protocol was
    ///      deployed in March, its record was superseded and moved aside as history, and the salt
    ///      set that produced it is spent — there will never be a run that writes
    ///      `deployments/sepolia.json` for the contracts that are live there now. Resolving only
    ///      through the record therefore fails on `readFile` before it reads a single rung, and the
    ///      alternative is hand-writing a record for a deployment nothing else on disk describes.
    ///      `LAUNCH_MANAGER` is the same env var `MigrateOwnership` already takes for this contract.
    ///
    ///      The record stays the fallback so a freshly deployed chain needs no env var at all, and
    ///      both paths are held to the same two checks: an address that is zero, or that carries no
    ///      code on the RPC in hand, is a pointer at the wrong chain and must stop the run.
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

    /// @dev Overridden in the test, which supplies a record in memory rather than reading one off
    ///      disk. Production behaviour is the default. Mirrors the seam in `ValidateSepolia`.
    function _deploymentJson() internal view virtual returns (string memory) {
        return vm.readFile(DEPLOYMENT_PATH);
    }

    /// @dev The override as the operator supplies it, `address(0)` when unset. Its own seam because
    ///      the process environment is global to a forge run and test cases execute concurrently, so
    ///      a test that sets `LAUNCH_MANAGER` to exercise precedence races every other test reading
    ///      it. Overriding here lets the precedence in `_launchManager` — which is where the
    ///      decisions are — be tested deterministically; what is left below is the builtin read.
    function _envLaunchManager() internal view virtual returns (address) {
        return vm.envOr("LAUNCH_MANAGER", address(0));
    }
}
