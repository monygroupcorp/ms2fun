// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LaunchManager } from "../../../src/factories/erc404/LaunchManager.sol";
import { ICurveComputer } from "../../../src/interfaces/ICurveComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { ReserveBandPin } from "./ReserveBandPin.sol";

contract MockCurveComputer is ICurveComputer {
    function computeCurveParams(uint256, uint256, uint256, uint256)
        external
        pure
        returns (BondingCurveMath.Params memory)
    {
        return BondingCurveMath.Params({ kCoeff: 1, poleWad: 1.0438e18, normalizationFactor: 1 });
    }

    /// @dev Permissive stand-in: this mock solves nothing, so every legal bps is "admissible".
    ///      The real band is asserted against CurveParamsComputer, not against this.
    function isReserveBpsAdmissible(uint256 liquidityReserveBps) external pure virtual returns (bool) {
        return liquidityReserveBps != 0 && liquidityReserveBps < 10000;
    }
}

/// @dev A computer that admits nothing. Proves the setter asks the computer rather than a local copy:
///      a reserve every real band accepts is still refused when the preset's own computer says no.
contract RefusingCurveComputer is MockCurveComputer {
    function isReserveBpsAdmissible(uint256) external pure override returns (bool) {
        return false;
    }
}

contract LaunchManagerTest is Test, ReserveBandPin {
    LaunchManager launchMgr;
    address protocolAdmin = address(0xAD111);
    MockCurveComputer mockCurve;
    CurveParamsComputer realCurve;

    function setUp() public {
        launchMgr = new LaunchManager(protocolAdmin);
        mockCurve = new MockCurveComputer();
        realCurve = new CurveParamsComputer(protocolAdmin);
    }

    function _preset(uint256 reserveBps, address curve) internal pure returns (LaunchManager.Preset memory) {
        return LaunchManager.Preset({
            targetETH: 15 ether, unitPerNFT: 1e6, liquidityReserveBps: reserveBps, curveComputer: curve, active: true
        });
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

    // ============================================
    // The admissible reserve band, asked of the real computer
    // ============================================

    /// @dev A preset outside the band used to be storable and then reverted at every create against
    ///      it. The setter now refuses it at store time, and the edges are the real computer's own —
    ///      not a mock's and not a number retyped here.
    function test_setPreset_refusesReserveJustBelowTheBand() public {
        vm.prank(protocolAdmin);
        vm.expectRevert(LaunchManager.InvalidReserveBps.selector);
        launchMgr.setPreset(1, _preset(MIN_RESERVE_BPS - 1, address(realCurve)));
    }

    function test_setPreset_refusesReserveJustAboveTheBand() public {
        vm.prank(protocolAdmin);
        vm.expectRevert(LaunchManager.InvalidReserveBps.selector);
        launchMgr.setPreset(1, _preset(MAX_RESERVE_BPS + 1, address(realCurve)));
    }

    function test_setPreset_acceptsReserveAtTheLowEdge() public {
        vm.prank(protocolAdmin);
        launchMgr.setPreset(1, _preset(MIN_RESERVE_BPS, address(realCurve)));
        assertEq(launchMgr.getPreset(1).liquidityReserveBps, MIN_RESERVE_BPS);
    }

    function test_setPreset_acceptsReserveAtTheHighEdge() public {
        vm.prank(protocolAdmin);
        launchMgr.setPreset(1, _preset(MAX_RESERVE_BPS, address(realCurve)));
        assertEq(launchMgr.getPreset(1).liquidityReserveBps, MAX_RESERVE_BPS);
    }

    /// @dev The edges the setter enforces are the computer's, so the pin and the derivation must agree
    ///      at the same four points the tests above exercise.
    function test_setPreset_bandEdgesAreTheComputersOwn() public view {
        assertTrue(realCurve.isReserveBpsAdmissible(MIN_RESERVE_BPS), "low edge admissible");
        assertTrue(realCurve.isReserveBpsAdmissible(MAX_RESERVE_BPS), "high edge admissible");
        assertFalse(realCurve.isReserveBpsAdmissible(MIN_RESERVE_BPS - 1), "below low edge refused");
        assertFalse(realCurve.isReserveBpsAdmissible(MAX_RESERVE_BPS + 1), "above high edge refused");
    }

    /// @dev Degenerate bps are refused through the same path; the setter no longer checks them itself.
    function test_setPreset_refusesDegenerateReserve() public {
        vm.startPrank(protocolAdmin);
        vm.expectRevert(LaunchManager.InvalidReserveBps.selector);
        launchMgr.setPreset(1, _preset(0, address(realCurve)));
        vm.expectRevert(LaunchManager.InvalidReserveBps.selector);
        launchMgr.setPreset(1, _preset(10000, address(realCurve)));
        vm.stopPrank();
    }

    /// @dev A reserve every real band admits is still refused when the preset's own computer says no,
    ///      so the bound lives in the computer and nowhere in the setter.
    function test_setPreset_asksThePresetsOwnComputer() public {
        RefusingCurveComputer refusing = new RefusingCurveComputer();
        vm.prank(protocolAdmin);
        vm.expectRevert(LaunchManager.InvalidReserveBps.selector);
        launchMgr.setPreset(1, _preset(1000, address(refusing)));
    }

    /// @dev The reserve is validated by calling the computer, so a zero computer is refused first and
    ///      the setter never calls into address(0).
    function test_setPreset_zeroComputerIsRefusedBeforeTheReserve() public {
        vm.prank(protocolAdmin);
        vm.expectRevert(LaunchManager.InvalidCurveComputer.selector);
        launchMgr.setPreset(1, _preset(0, address(0)));
    }

    function test_getPreset_revertsIfNotActive() public {
        vm.expectRevert(abi.encodeWithSignature("PresetNotActive()"));
        launchMgr.getPreset(99);
    }
}
