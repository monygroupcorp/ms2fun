// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { ApplyLaunchPresets } from "../../script/ApplyLaunchPresets.s.sol";
import { LaunchPresets } from "../../script/LaunchPresets.sol";
import { LaunchManager } from "../../src/factories/erc404/LaunchManager.sol";

/// @dev Runs the real `ApplyLaunchPresets.run()` body. The only seam overridden is where the
///      LaunchManager address comes from — a record on disk in production, a locally deployed one
///      here. Every decision under test is the script's own.
contract ApplyLaunchPresetsHarness is ApplyLaunchPresets {
    address private target;

    function setTarget(address target_) external {
        target = target_;
    }

    function _launchManager() internal view override returns (address) {
        return target;
    }
}

/// @notice The ladder a chain carries is not the ladder the repo ships until somebody calls
///         `setPreset`, and this is what makes that call repeatable rather than hand-typed.
///
///         Sepolia is the case in hand: it was deployed in March on `unitPerNFT` 1e9 / 1e6 / 1e3,
///         the ladder was re-spaced to 1e6 / 1e5 / 1e3, and a re-run of the deploy is not available
///         because the CREATE3 salt set is single-use per deployer. The rungs move by an owner call
///         or they do not move.
contract ApplyLaunchPresetsTest is Test {
    address constant OWNER = address(0xAA11CE);
    address constant CURVE = address(0xC0FFEE);

    LaunchManager internal lm;
    ApplyLaunchPresetsHarness internal script;

    function setUp() public {
        lm = new LaunchManager(OWNER);
        script = new ApplyLaunchPresetsHarness();
        script.setTarget(address(lm));
    }

    /// @dev The ladder Sepolia was deployed with. NICHE and STANDARD are superseded; HYPE was never
    ///      retuned, which is what makes the partial case below a real one and not a contrivance.
    function _writeSupersededLadder() internal {
        uint256[3] memory targets = [uint256(5 ether), 25 ether, 50 ether];
        uint256[3] memory units = [uint256(1_000_000_000), 1_000_000, 1_000];
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(OWNER);
            lm.setPreset(
                i,
                LaunchManager.Preset({
                    targetETH: targets[i],
                    unitPerNFT: units[i],
                    liquidityReserveBps: 1000,
                    curveComputer: CURVE,
                    active: true
                })
            );
        }
    }

    function _assertMatchesShipped() internal view {
        for (uint256 i = 0; i < LaunchPresets.COUNT; i++) {
            LaunchManager.Preset memory live = lm.getPreset(i);
            LaunchManager.Preset memory shipped = LaunchPresets.preset(i, live.curveComputer);
            assertEq(live.targetETH, shipped.targetETH, "targetETH");
            assertEq(live.unitPerNFT, shipped.unitPerNFT, "unitPerNFT");
            assertEq(live.liquidityReserveBps, shipped.liquidityReserveBps, "liquidityReserveBps");
            assertTrue(live.active, "active");
        }
    }

    function test_supersededLadderIsBroughtUpToTheShippedOne() public {
        _writeSupersededLadder();
        assertEq(lm.getPreset(0).unitPerNFT, 1_000_000_000, "starts on the superseded rung");

        script.run();

        _assertMatchesShipped();
        assertEq(lm.getPreset(0).unitPerNFT, 1_000_000, "NICHE moved three decades");
        assertEq(lm.getPreset(1).unitPerNFT, 100_000, "STANDARD moved one decade");
        assertEq(lm.getPreset(2).unitPerNFT, 1_000, "HYPE was already right and is unchanged");
    }

    /// @dev Idempotence is the property that makes this safe to re-run after a partial broadcast —
    ///      a run that lands two of three transactions and then fails on gas is finished by running
    ///      it again, not by working out which rung got through.
    function test_secondRunIsANoOp() public {
        _writeSupersededLadder();
        script.run();

        vm.recordLogs();
        script.run();
        assertEq(vm.getRecordedLogs().length, 0, "a matching ladder emits no PresetUpdated");
        _assertMatchesShipped();
    }

    /// @dev The curve computer is per-deployment and this script must not touch it: a chain whose
    ///      computer was migrated keeps the migrated one across a rung retune.
    function test_curveComputerIsCarriedThroughUntouched() public {
        _writeSupersededLadder();
        address migrated = address(0xBEEF);
        LaunchManager.Preset memory p = lm.getPreset(0);
        p.curveComputer = migrated;
        vm.prank(OWNER);
        lm.setPreset(0, p);

        script.run();

        assertEq(lm.getPreset(0).curveComputer, migrated, "preset 0 keeps its migrated computer");
        assertEq(lm.getPreset(0).unitPerNFT, 1_000_000, "and still gets the shipped rung");
        assertEq(lm.getPreset(1).curveComputer, CURVE, "preset 1 keeps the one it had");
    }

    /// @dev An inactive rung is not a rung: `getPreset` reverts `PresetNotActive`, so the script
    ///      reports the chain rather than silently rewriting a preset somebody deliberately retired.
    function test_inactivePresetStopsTheRun() public {
        _writeSupersededLadder();
        LaunchManager.Preset memory p = lm.getPreset(1);
        p.active = false;
        vm.prank(OWNER);
        lm.setPreset(1, p);

        vm.expectRevert(LaunchManager.PresetNotActive.selector);
        script.run();
    }
}
