// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LaunchManager } from "../../../src/factories/erc404/LaunchManager.sol";
import { ICurveComputer } from "../../../src/interfaces/ICurveComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { ReserveBandPin } from "./ReserveBandPin.sol";

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

    /// @dev Stand-in: this mock solves nothing, so what it admits is whatever `setSupportedBand`
    ///      says — defaulting to the whole arithmetic range. The real band is asserted against
    ///      CurveParamsComputer, not against this.
    function isReserveBpsAdmissible(uint256 liquidityReserveBps) external view virtual returns (bool) {
        return liquidityReserveBps >= minSupported && liquidityReserveBps <= maxSupported;
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

    // ── The admissible reserve band (noesis-257) ────────────────────────────────────────────────
    //
    // `(0, 10000)` is the arithmetic range, not the serviceable one. `setPreset` now asks the
    // preset's OWN curve computer which reserves it can solve for, so a preset that would revert
    // every create against it is refused at set time — on the DAO's transaction, where the mistake
    // was made, rather than on a creator's, from a contract they never named.

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
