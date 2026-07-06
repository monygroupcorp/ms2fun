// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RevenueSplitLib} from "../../src/shared/libraries/RevenueSplitLib.sol";

/// @title RevenueSplitCarveTest
/// @notice Graduation carve-out math: `carveAllowance` (progressive brackets — continuity at
///         breakpoints, monotonicity, worked points) and `splitGraduation` (conservation, the
///         payout priority stack, the tithe, and the pool-floor CLAMP — never a gate).
contract RevenueSplitCarveTest is Test {
    // Bound raises so bracket math can't overflow (r <= 10000: raise * 10000 must fit).
    uint256 constant MAX_RAISE = type(uint256).max / 10000;

    /// @dev The protocol defaults: 50% of the first 4 ETH, 25% of the next 16, 10% beyond 20.
    function _defaults() internal pure returns (RevenueSplitLib.BracketParams memory) {
        return RevenueSplitLib.BracketParams({b1: 4 ether, b2: 20 ether, r1: 5000, r2: 2500, r3: 1000});
    }

    /// @dev Fuzz-safe bracket params: b1 <= b2 (factory-validated invariant), rates <= 10000.
    function _boundParams(
        uint256 b1,
        uint256 b2,
        uint16 r1,
        uint16 r2,
        uint16 r3
    ) internal pure returns (RevenueSplitLib.BracketParams memory p) {
        p.b1 = bound(b1, 0, MAX_RAISE);
        p.b2 = bound(b2, p.b1, MAX_RAISE);
        p.r1 = uint16(bound(r1, 0, 10000));
        p.r2 = uint16(bound(r2, 0, 10000));
        p.r3 = uint16(bound(r3, 0, 10000));
    }

    // ── carveAllowance: worked points from the locked design ─────────────────

    function test_carveAllowance_workedPoints() public pure {
        RevenueSplitLib.BracketParams memory p = _defaults();
        assertEq(RevenueSplitLib.carveAllowance(0, p), 0, "R=0 -> 0");
        assertEq(RevenueSplitLib.carveAllowance(1 ether, p), 0.5 ether, "R=1 -> 0.5");
        assertEq(RevenueSplitLib.carveAllowance(2 ether, p), 1 ether, "R=2 -> 1.0");
        assertEq(RevenueSplitLib.carveAllowance(4 ether, p), 2 ether, "R=4 -> 2.0");
        assertEq(RevenueSplitLib.carveAllowance(12 ether, p), 4 ether, "R=12 -> 4.0");
        assertEq(RevenueSplitLib.carveAllowance(20 ether, p), 6 ether, "R=20 -> 6.0");
        assertEq(RevenueSplitLib.carveAllowance(50 ether, p), 9 ether, "R=50 -> 9.0");
        assertEq(RevenueSplitLib.carveAllowance(100 ether, p), 14 ether, "R=100 -> 14.0");
    }

    /// @notice Continuity at both breakpoints: the marginal rate is <= 1 wei per wei of raise, so
    ///         crossing a breakpoint can never jump the allowance.
    function test_carveAllowance_continuousAtBreakpoints() public pure {
        RevenueSplitLib.BracketParams memory p = _defaults();
        // At b1
        uint256 below = RevenueSplitLib.carveAllowance(p.b1 - 1, p);
        uint256 at    = RevenueSplitLib.carveAllowance(p.b1, p);
        uint256 above = RevenueSplitLib.carveAllowance(p.b1 + 1, p);
        assertLe(at - below, 1, "jump into b1");
        assertLe(above - at, 1, "jump out of b1");
        // At b2
        below = RevenueSplitLib.carveAllowance(p.b2 - 1, p);
        at    = RevenueSplitLib.carveAllowance(p.b2, p);
        above = RevenueSplitLib.carveAllowance(p.b2 + 1, p);
        assertLe(at - below, 1, "jump into b2");
        assertLe(above - at, 1, "jump out of b2");
    }

    /// @notice Fuzzed continuity: one extra wei of raise moves the allowance by at most 1 wei
    ///         (rates are <= 10000 bps = 1x), for ANY valid bracket params — so the curve has no
    ///         discontinuity anywhere, breakpoints included.
    function testFuzz_carveAllowance_lipschitzContinuity(
        uint256 raise,
        uint256 b1,
        uint256 b2,
        uint16 r1,
        uint16 r2,
        uint16 r3
    ) public pure {
        RevenueSplitLib.BracketParams memory p = _boundParams(b1, b2, r1, r2, r3);
        raise = bound(raise, 0, MAX_RAISE - 1);
        uint256 a0 = RevenueSplitLib.carveAllowance(raise, p);
        uint256 a1 = RevenueSplitLib.carveAllowance(raise + 1, p);
        assertGe(a1, a0, "allowance must not decrease");
        assertLe(a1 - a0, 1, "allowance may grow at most 1 wei per wei");
    }

    /// @notice Fuzzed monotonicity: a bigger raise never shrinks the allowance (absolute never
    ///         stops growing even as the RATE falls).
    function testFuzz_carveAllowance_monotonicInRaise(
        uint256 raiseA,
        uint256 raiseB,
        uint256 b1,
        uint256 b2,
        uint16 r1,
        uint16 r2,
        uint16 r3
    ) public pure {
        RevenueSplitLib.BracketParams memory p = _boundParams(b1, b2, r1, r2, r3);
        raiseA = bound(raiseA, 0, MAX_RAISE);
        raiseB = bound(raiseB, raiseA, MAX_RAISE);
        assertLe(
            RevenueSplitLib.carveAllowance(raiseA, p),
            RevenueSplitLib.carveAllowance(raiseB, p),
            "allowance must be monotonic in the raise"
        );
    }

    /// @notice The allowance never exceeds the top marginal rate applied to the whole raise —
    ///         and with the defaults it is always <= 50% of the raise.
    function testFuzz_carveAllowance_boundedByTopRate(uint256 raise) public pure {
        raise = bound(raise, 0, MAX_RAISE);
        uint256 a = RevenueSplitLib.carveAllowance(raise, _defaults());
        assertLe(a, raise / 2, "defaults: allowance <= 50% of raise");
    }

    // ── splitGraduation: conservation + priority stack + tithe ───────────────

    function testFuzz_splitGraduation_conservation(
        uint256 raise,
        uint256 carveEth,
        uint256 minPoolEth
    ) public pure {
        raise = bound(raise, 0, type(uint256).max / 100); // split() multiplies by 19
        carveEth = bound(carveEth, 0, type(uint256).max / 100);
        minPoolEth = bound(minPoolEth, 0, type(uint256).max);
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(raise, carveEth, minPoolEth);
        assertEq(
            g.protocolCut + g.vaultCut + g.creatorCut + g.ethForPool,
            raise,
            "all parts must sum to the raise exactly"
        );
    }

    /// @notice Priority stack: protocol/vault are computed on the FULL raise (alignment not
    ///         dilutable) plus their tithe share of the applied carve; the creator gets 80% of the
    ///         carve; the pool takes the rest.
    function testFuzz_splitGraduation_priorityStackAndTithe(
        uint256 raise,
        uint256 carveEth,
        uint256 minPoolEth
    ) public pure {
        raise = bound(raise, 0, type(uint256).max / 100);
        carveEth = bound(carveEth, 0, type(uint256).max / 100);
        minPoolEth = bound(minPoolEth, 0, type(uint256).max);
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(raise, carveEth, minPoolEth);

        uint256 lp = raise - raise / 100 - (raise * 19) / 100;
        uint256 headroom = lp > minPoolEth ? lp - minPoolEth : 0;
        uint256 carve = carveEth > headroom ? headroom : carveEth;

        assertEq(g.carveApplied, carve, "carve = min(request, headroom)");
        assertEq(g.protocolCut, raise / 100 + carve / 100, "protocol = 1% raise + 1% carve");
        assertEq(g.vaultCut, (raise * 19) / 100 + (carve * 19) / 100, "vault = 19% raise + 19% carve");
        assertEq(g.creatorCut, carve - carve / 100 - (carve * 19) / 100, "creator = 80% of carve (+dust)");
        assertEq(g.ethForPool, lp - carve, "pool = LP80 - carve");
    }

    /// @notice The floor is a carve-CLAMP, never a gate: whenever the LP share reaches the floor,
    ///         the pool keeps at least the floor; when it can't, the carve is zero and the pool
    ///         takes the whole LP share — the function never reverts.
    function testFuzz_splitGraduation_floorClampNeverGates(
        uint256 raise,
        uint256 carveEth,
        uint256 minPoolEth
    ) public pure {
        raise = bound(raise, 0, type(uint256).max / 100);
        carveEth = bound(carveEth, 0, type(uint256).max / 100);
        minPoolEth = bound(minPoolEth, 0, type(uint256).max);
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(raise, carveEth, minPoolEth);

        uint256 lp = raise - raise / 100 - (raise * 19) / 100;
        if (lp >= minPoolEth) {
            assertGe(g.ethForPool, minPoolEth, "pool must keep at least the floor");
        } else {
            assertEq(g.carveApplied, 0, "no headroom -> carve squeezed to zero");
            assertEq(g.ethForPool, lp, "pool takes the whole LP share");
        }
    }

    /// @notice Zero carve reproduces the plain 1/19/80 `split` exactly (historic graduation).
    function testFuzz_splitGraduation_zeroCarveMatchesSplit(uint256 raise, uint256 minPoolEth) public pure {
        raise = bound(raise, 0, type(uint256).max / 100);
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(raise, 0, minPoolEth);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(raise);
        assertEq(g.protocolCut, s.protocolCut);
        assertEq(g.vaultCut, s.vaultCut);
        assertEq(g.creatorCut, 0);
        assertEq(g.ethForPool, s.remainder);
        assertEq(g.carveApplied, 0);
    }

    // ── Minnow cases from the locked design table (minPoolEth = 1 ETH) ───────
    // R=0.8 and R=1: LP80 (0.64 / 0.8) is under the floor -> carve structurally 0, graduates a
    // thin-but-real pool. R=1.5 -> carve 0.2. R=2 -> carve 0.6 (creator nets 0.48).

    function test_minnow_R08_carveZero() public pure {
        uint256 raise = 0.8 ether;
        uint256 requested = RevenueSplitLib.carveAllowance(raise, _defaults()); // 0.4
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(raise, requested, 1 ether);
        assertEq(g.carveApplied, 0, "R=0.8: carve structurally zero");
        assertEq(g.creatorCut, 0);
        assertEq(g.ethForPool, 0.64 ether, "thin-but-real pool");
    }

    function test_minnow_R1_carveZero() public pure {
        uint256 raise = 1 ether;
        uint256 requested = RevenueSplitLib.carveAllowance(raise, _defaults()); // 0.5
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(raise, requested, 1 ether);
        assertEq(g.carveApplied, 0, "R=1: carve structurally zero");
        assertEq(g.ethForPool, 0.8 ether);
    }

    function test_minnow_R15_carvePointTwo() public pure {
        uint256 raise = 1.5 ether;
        uint256 requested = RevenueSplitLib.carveAllowance(raise, _defaults()); // 0.75
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(raise, requested, 1 ether);
        // LP80 = 1.2, floor 1.0 -> headroom clamps the 0.75 allowance to 0.2.
        assertEq(g.carveApplied, 0.2 ether, "R=1.5: carve ~0.2");
        assertEq(g.ethForPool, 1 ether, "pool held at the floor");
    }

    function test_minnow_R2_carvePointSix_creatorNets048() public pure {
        uint256 raise = 2 ether;
        uint256 requested = RevenueSplitLib.carveAllowance(raise, _defaults()); // 1.0
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(raise, requested, 1 ether);
        // LP80 = 1.6, floor 1.0 -> headroom clamps the 1.0 allowance to 0.6.
        assertEq(g.carveApplied, 0.6 ether, "R=2: carve 0.6");
        assertEq(g.creatorCut, 0.48 ether, "creator nets 80% of 0.6");
        assertEq(g.ethForPool, 1 ether, "pool held at the floor");
        assertEq(g.vaultCut, 0.38 ether + 0.114 ether, "vault = 19% raise + 19% carve");
        assertEq(g.protocolCut, 0.02 ether + 0.006 ether, "protocol = 1% raise + 1% carve");
    }

    /// @notice R=4 with full allowance headroom: carve = allowance = 2.0, creator nets 1.6.
    function test_R4_creatorNets16() public pure {
        uint256 raise = 4 ether;
        uint256 requested = RevenueSplitLib.carveAllowance(raise, _defaults()); // 2.0
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(raise, requested, 1 ether);
        assertEq(g.carveApplied, 2 ether, "LP80 = 3.2, headroom 2.2 -> full 2.0 allowance fits");
        assertEq(g.creatorCut, 1.6 ether, "creator nets 1.6");
        assertEq(g.ethForPool, 1.2 ether, "pool keeps 3.2 - 2.0");
    }
}
