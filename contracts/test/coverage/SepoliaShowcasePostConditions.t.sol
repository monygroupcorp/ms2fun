// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { SeedSepoliaShared, IShowcaseCurveState } from "../../script/SeedSepoliaShared.sol";

/// @dev A curve whose entire state is settable. It exists so the seed's post-conditions can be
///      exercised against states the seed itself would never produce — including the states that
///      must make them FAIL.
contract StubCurve is IShowcaseCurveState {
    uint256 public bondingOpenTime;
    uint256 public bondingMaturityTime;
    bool public bondingActive;
    bool public graduated;
    uint256 public reserve;
    uint256 public totalBondingSupply;

    function set(uint256 openTime, uint256 maturityTime, bool active, bool grad, uint256 res, uint256 sold) external {
        bondingOpenTime = openTime;
        bondingMaturityTime = maturityTime;
        bondingActive = active;
        graduated = grad;
        reserve = res;
        totalBondingSupply = sold;
    }

    function setGraduated(bool grad) external {
        graduated = grad;
    }

    function setMaturity(uint256 maturityTime) external {
        bondingMaturityTime = maturityTime;
    }

    function setReserve(uint256 res) external {
        reserve = res;
    }

    function setOpenTime(uint256 openTime) external {
        bondingOpenTime = openTime;
    }
}

/// @dev The seed base is abstract only because the two phase scripts are its concrete users; nothing
///      in it is unimplemented. This makes the internal post-conditions callable from a test.
contract ShowcaseAssertHarness is SeedSepoliaShared {
    function roster() external view returns (ShowcaseLeg[] memory) {
        return _showcaseRoster();
    }

    function assertStates(
        IShowcaseCurveState[] calldata states,
        ShowcaseLeg[] calldata legs,
        uint256 nowTs,
        uint128 poolLiquidity
    ) external view {
        _assertShowcaseStates(states, legs, nowTs, poolLiquidity);
    }
}

/// @notice THE VACUITY CHECK FOR THE SEPOLIA SHOWCASE POST-CONDITIONS.
///
///         The Sepolia seed's claim — that the deployment holds a pre-open, a mid-curve, a
///         ready-to-graduate and a graduated collection — is enforced by `_assertShowcaseStates`,
///         which phase 2 runs as `require`s before it reports success. An assertion that cannot fail
///         would let a seed that graduated nothing report a graduated showcase, so this suite states
///         the assertion's negative space directly: for each of the four rows, it removes the one
///         property that row exists to demonstrate and requires the check to go RED.
///
///         `test_passesOnAHealthyShowcase` is the other half. Without it the red cases could be
///         satisfied by an assertion that always reverts, which is a different kind of vacuous.
contract SepoliaShowcasePostConditionsTest is Test {
    ShowcaseAssertHarness internal harness;
    SeedSepoliaShared.ShowcaseLeg[] internal legs;
    StubCurve[] internal stubs;

    uint256 internal constant NOW_TS = 1_000_000;
    uint128 internal constant POOL_LIQUIDITY = 12_345;

    function setUp() public {
        harness = new ShowcaseAssertHarness();
        SeedSepoliaShared.ShowcaseLeg[] memory r = harness.roster();
        for (uint256 i = 0; i < r.length; i++) {
            legs.push(r[i]);
            StubCurve stub = new StubCurve();
            stubs.push(stub);
            // Each stub is set to the state its row claims — the shape a healthy seed produces.
            if (r[i].state == 0) {
                // PRE-OPEN: armed, opens in the future, never bought.
                stub.set(NOW_TS + 30 days, 0, true, false, 0, 0);
            } else if (r[i].state == 1) {
                // MID-CURVE: open, partially filled, holding a raise, not graduated.
                stub.set(NOW_TS - 1 hours, 0, true, false, 1 ether, 5e27);
            } else if (r[i].state == 2) {
                // READY: open, matured, holding a raise, uncrossed.
                stub.set(NOW_TS - 1 hours, NOW_TS - 30 minutes, true, false, 1 ether, 9e27);
            } else {
                // GRADUATED: raise moved out to the venue.
                stub.set(NOW_TS - 1 hours, 0, false, true, 0, 9e27);
            }
        }
    }

    function _states() internal view returns (IShowcaseCurveState[] memory s) {
        s = new IShowcaseCurveState[](stubs.length);
        for (uint256 i = 0; i < stubs.length; i++) {
            s[i] = IShowcaseCurveState(address(stubs[i]));
        }
    }

    function _assert() internal view {
        harness.assertStates(_states(), legs, NOW_TS, POOL_LIQUIDITY);
    }

    /// @dev The roster is what phase 1 arms and phase 2 fills. If a row is ever dropped from it, the
    ///      showcase silently stops covering that state — so the four states are asserted to be
    ///      PRESENT here, not merely handled if present.
    function test_rosterCoversAllFourCurveStates() public view {
        bool preopen;
        bool mid;
        bool ready;
        bool graduated;
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].state == 0) preopen = true;
            if (legs[i].state == 1) mid = true;
            if (legs[i].state == 2) ready = true;
            if (legs[i].state == 3) graduated = true;
            assertGt(bytes(legs[i].description).length, 40, "every row must carry a feature description");
        }
        assertTrue(preopen, "roster has no pre-open row");
        assertTrue(mid, "roster has no mid-curve row");
        assertTrue(ready, "roster has no ready-to-graduate row");
        assertTrue(graduated, "roster has no graduated row");
    }

    function test_passesOnAHealthyShowcase() public view {
        _assert();
    }

    // ── The negative space: each row's defining property, removed ──

    function test_redWhenTheGraduationIsRemoved() public {
        _graduatedStub().setGraduated(false);
        vm.expectRevert(bytes("post: flare-graduated has NOT graduated"));
        _assert();
    }

    function test_redWhenTheGraduatedVenuePoolIsEmpty() public {
        vm.expectRevert(bytes("post: flare-graduated venue pool holds no liquidity"));
        harness.assertStates(_states(), legs, NOW_TS, 0);
    }

    function test_redWhenTheGraduatedRowStillHoldsTheRaise() public {
        _graduatedStub().setReserve(1 ether);
        vm.expectRevert(bytes("post: flare-graduated graduated with the raise still held"));
        _assert();
    }

    function test_redWhenTheReadyRowHasNotMatured() public {
        _stubFor(2).setMaturity(NOW_TS + 1 hours);
        vm.expectRevert(bytes("post: cinder-ready has not matured (graduate action would not be live)"));
        _assert();
    }

    function test_redWhenTheReadyRowHoldsNoRaise() public {
        _stubFor(2).setReserve(0);
        vm.expectRevert(bytes("post: cinder-ready holds no raise to graduate"));
        _assert();
    }

    function test_redWhenTheReadyRowWasGraduatedAway() public {
        _stubFor(2).setGraduated(true);
        vm.expectRevert(bytes("post: cinder-ready has already graduated"));
        _assert();
    }

    function test_redWhenThePreOpenRowHasAlreadyOpened() public {
        _stubFor(0).setOpenTime(NOW_TS - 1);
        vm.expectRevert(bytes("post: ember-preopen has already opened"));
        _assert();
    }

    function test_redWhenTheMidCurveRowWasNeverFilled() public {
        _stubFor(1).set(NOW_TS - 1 hours, 0, true, false, 0, 0);
        vm.expectRevert(bytes("post: vapor-mid has no partial fill"));
        _assert();
    }

    function _stubFor(uint8 state) internal view returns (StubCurve) {
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].state == state) return stubs[i];
        }
        revert("no row with that state");
    }

    function _graduatedStub() internal view returns (StubCurve) {
        return _stubFor(3);
    }
}
