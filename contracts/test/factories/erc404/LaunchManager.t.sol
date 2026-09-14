// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LaunchManager } from "../../../src/factories/erc404/LaunchManager.sol";
import { ICurveComputer } from "../../../src/interfaces/ICurveComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";

contract MockCurveComputer is ICurveComputer {
    /// @dev Reserves this mock claims it can serve. Defaults to the whole arithmetic range so the
    ///      pre-existing tests keep exercising `setPreset`'s other guards unchanged.
    uint256 public minSupported = 1;
    uint256 public maxSupported = 9999;

    function setSupportedBand(uint256 lo, uint256 hi) external {
        minSupported = lo;
        maxSupported = hi;
    }

    function computeCurveParams(uint256, uint256, uint256, uint256)
        external
        pure
        returns (BondingCurveMath.Params memory)
    {
        return BondingCurveMath.Params({ kCoeff: 1, poleWad: 1.0438e18, normalizationFactor: 1 });
    }

    function supportsReserveBps(uint256 liquidityReserveBps) external view returns (bool) {
        return liquidityReserveBps >= minSupported && liquidityReserveBps <= maxSupported;
    }
}

contract LaunchManagerTest is Test {
    LaunchManager launchMgr;
    address protocolAdmin = address(0xAD111);
    MockCurveComputer mockCurve;

    function setUp() public {
        launchMgr = new LaunchManager(protocolAdmin);
        mockCurve = new MockCurveComputer();
    }

    function test_setPreset_storesPreset() public {
        vm.startPrank(protocolAdmin);
        launchMgr.setPreset(
            1,
            LaunchManager.Preset({
                targetETH: 15 ether,
                unitPerNFT: 1e6,
                liquidityReserveBps: 2000,
                curveComputer: address(mockCurve),
                active: true
            })
        );
        LaunchManager.Preset memory p = launchMgr.getPreset(1);
        assertEq(p.targetETH, 15 ether);
        assertEq(p.unitPerNFT, 1e6);
        assertEq(p.liquidityReserveBps, 2000);
        assertEq(p.curveComputer, address(mockCurve));
        assertTrue(p.active);
        vm.stopPrank();
    }

    function test_setPreset_revertsIfNotOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        launchMgr.setPreset(
            1,
            LaunchManager.Preset({
                targetETH: 15 ether,
                unitPerNFT: 1e6,
                liquidityReserveBps: 2000,
                curveComputer: address(0x1),
                active: true
            })
        );
    }

    function test_getPreset_revertsIfNotActive() public {
        vm.expectRevert(abi.encodeWithSignature("PresetNotActive()"));
        launchMgr.getPreset(99);
    }

    // ── The admissible reserve band (noesis-257) ────────────────────────────────────────────────
    //
    // `(0, 10000)` is the arithmetic range, not the serviceable one. `setPreset` now asks the
    // preset's OWN curve computer which reserves it can solve for, so a preset that would revert
    // every create against it is refused at set time — on the DAO's transaction, where the mistake
    // was made, rather than on a creator's, from a contract they never named.

    /// @dev The band the shipped `CurveParamsComputer` actually serves, measured by walking every
    ///      bps against `computeCurveParams` and pinned in `CurveParamsComputer.t.sol`. Named here,
    ///      not re-derived: if a change to the pole constants moves the band, this test must FAIL
    ///      and be re-measured rather than quietly follow it.
    uint256 internal constant MIN_RESERVE_BPS = 592;
    uint256 internal constant MAX_RESERVE_BPS = 3567;

    function _preset(uint256 bps, address computer) internal pure returns (LaunchManager.Preset memory) {
        return LaunchManager.Preset({
            targetETH: 15 ether, unitPerNFT: 1e6, liquidityReserveBps: bps, curveComputer: computer, active: true
        });
    }

    function test_setPreset_refusesReserveTheRealComputerCannotSolve() public {
        CurveParamsComputer real = new CurveParamsComputer(protocolAdmin);
        vm.startPrank(protocolAdmin);

        // The two values the finding named. Both store fine today and break every create.
        vm.expectRevert(abi.encodeWithSignature("InvalidReserveBps()"));
        launchMgr.setPreset(1, _preset(4000, address(real)));

        vm.expectRevert(abi.encodeWithSignature("InvalidReserveBps()"));
        launchMgr.setPreset(1, _preset(500, address(real)));

        // And the band edges, from the outside.
        vm.expectRevert(abi.encodeWithSignature("InvalidReserveBps()"));
        launchMgr.setPreset(1, _preset(MIN_RESERVE_BPS - 1, address(real)));

        vm.expectRevert(abi.encodeWithSignature("InvalidReserveBps()"));
        launchMgr.setPreset(1, _preset(MAX_RESERVE_BPS + 1, address(real)));
        vm.stopPrank();
    }

    function test_setPreset_storesAcrossTheWholeAdmissibleBand() public {
        CurveParamsComputer real = new CurveParamsComputer(protocolAdmin);
        vm.startPrank(protocolAdmin);

        uint256[3] memory inBand = [MIN_RESERVE_BPS, uint256(1000), MAX_RESERVE_BPS];
        for (uint256 i = 0; i < inBand.length; i++) {
            launchMgr.setPreset(1, _preset(inBand[i], address(real)));
            assertEq(launchMgr.getPreset(1).liquidityReserveBps, inBand[i], "in-band preset stores and reads back");
        }
        vm.stopPrank();
    }

    /// @dev Non-vacuity: the refusal comes from the COMPUTER's answer, not from a constant in
    ///      `LaunchManager`. Same reserve, two computers, two outcomes.
    function test_setPreset_bandComesFromTheComputerNotFromLaunchManager() public {
        vm.startPrank(protocolAdmin);

        // The permissive mock serves 4000 — so 4000 is not refused by anything in LaunchManager.
        launchMgr.setPreset(1, _preset(4000, address(mockCurve)));
        assertEq(launchMgr.getPreset(1).liquidityReserveBps, 4000);

        // Narrow the same mock and the same reserve is refused.
        mockCurve.setSupportedBand(592, 3567);
        vm.expectRevert(abi.encodeWithSignature("InvalidReserveBps()"));
        launchMgr.setPreset(2, _preset(4000, address(mockCurve)));
        vm.stopPrank();
    }

    /// @dev The arithmetic guard still runs first, so `0` and `10000` keep their own refusal and
    ///      never reach a computer that would have to divide by them.
    function test_setPreset_degenerateReservesStillRefusedBeforeTheComputer() public {
        vm.startPrank(protocolAdmin);
        vm.expectRevert(abi.encodeWithSignature("InvalidReserveBps()"));
        launchMgr.setPreset(1, _preset(0, address(mockCurve)));

        vm.expectRevert(abi.encodeWithSignature("InvalidReserveBps()"));
        launchMgr.setPreset(1, _preset(10000, address(mockCurve)));
        vm.stopPrank();
    }
}
