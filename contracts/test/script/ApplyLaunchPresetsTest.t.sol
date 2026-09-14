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

/// @dev Keeps the script's OWN `_launchManager` — the precedence, the zero check and the code check
///      are all the production ones. Only the two inputs it reads are supplied here: the record that
///      would come off disk, and the override that would come out of the process environment.
contract ApplyLaunchPresetsResolutionHarness is ApplyLaunchPresets {
    string private record;
    address private override_;

    function setRecord(string memory record_) external {
        record = record_;
    }

    function setOverride(address override__) external {
        override_ = override__;
    }

    function resolve() external view returns (address) {
        return _launchManager();
    }

    function _deploymentJson() internal view override returns (string memory) {
        return record;
    }

    function _envLaunchManager() internal view override returns (address) {
        return override_;
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
        _admitReserveAt(CURVE);
    }

    /// @dev `setPreset` asks the rung's computer whether the reserve is admissible before it writes.
    ///      The computer is a stand-in address here — the script must carry it through, not call it —
    ///      so it answers yes to every band.
    function _admitReserveAt(address computer) internal {
        vm.etch(computer, hex"00");
        vm.mockCall(computer, abi.encodeWithSignature("isReserveBpsAdmissible(uint256)"), abi.encode(true));
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
        _admitReserveAt(migrated);
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

/// @notice Where the script gets its LaunchManager from. Shipped, it resolved only through
///         `deployments/sepolia.json`, and that path is empty for the one deployment this script was
///         written for: Sepolia's live protocol dates from March, its record was superseded into
///         `deployments/superseded/`, and the CREATE3 salt set that produced those addresses is
///         spent — no future run writes that file for the contracts live there now. So the script
///         reverted on `readFile` before reading a rung, and the ladder could not be applied at all.
///
///         Vacuity check (vacuity-check): drop the override branch from `_launchManager` and
///         `test_overrideResolvesWithoutARecord` fails on the unparseable record instead; drop
///         either `require` and the matching case below stops reverting.
contract ApplyLaunchPresetsResolutionTest is Test {
    address constant OWNER = address(0xAA11CE);

    ApplyLaunchPresetsResolutionHarness internal script;
    LaunchManager internal fromOverride;
    LaunchManager internal fromRecord;

    function setUp() public {
        script = new ApplyLaunchPresetsResolutionHarness();
        fromOverride = new LaunchManager(OWNER);
        fromRecord = new LaunchManager(OWNER);
    }

    function _record(address addr) internal pure returns (string memory) {
        return string.concat('{"contracts":{"LaunchManager":"', vm.toString(addr), '"}}');
    }

    /// @dev The case in hand: no record on disk at all. The stub returns the empty string, which is
    ///      what `parseJsonAddress` is handed when the file is missing — so resolution reaching the
    ///      record at all reverts here rather than reading green.
    function test_overrideResolvesWithoutARecord() public {
        script.setRecord("");
        script.setOverride(address(fromOverride));

        assertEq(script.resolve(), address(fromOverride), "the override names the target");
    }

    /// @dev A freshly deployed chain needs no override: the record its own deploy run wrote is the
    ///      zero-config path, and it must keep working.
    function test_recordIsTheFallbackWhenNoOverrideIsGiven() public {
        script.setRecord(_record(address(fromRecord)));

        assertEq(script.resolve(), address(fromRecord), "the record supplies the target");
    }

    /// @dev An operator pointing at one chain while a record for another sits on disk gets the chain
    ///      they typed. Precedence has to be stated, because both sources can be present at once.
    function test_overrideWinsOverTheRecord() public {
        script.setRecord(_record(address(fromRecord)));
        script.setOverride(address(fromOverride));

        assertEq(script.resolve(), address(fromOverride), "the override outranks the record");
    }

    /// @dev Both paths owe the same code check. An address carrying no code on the RPC in hand is an
    ///      address from another chain, and a run against it would broadcast owner calls into
    ///      nothing — so it stops here rather than reporting rungs rewritten.
    function test_overridePointingAtACodelessAddressStopsTheRun() public {
        script.setRecord(_record(address(fromRecord)));
        script.setOverride(address(0xD00D));

        vm.expectRevert(bytes("LaunchManager: no code at the resolved address"));
        script.resolve();
    }

    function test_recordHoldingTheZeroAddressStopsTheRun() public {
        script.setRecord(_record(address(0)));

        vm.expectRevert(bytes("LaunchManager: deployment record holds the zero address"));
        script.resolve();
    }
}
