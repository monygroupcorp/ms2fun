// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";

/**
 * @title CurveParamsComputerTest
 * @notice The magnitude gate: a preset x nftCount matrix asserting, for every cell, the last/first
 *         price ratio AND the graduation price, each two-sided against the closed form.
 * @dev Every assertion here is written so that a flat curve fails it. Direction-only checks
 *      (assertGt on a rising price) are deliberately absent — they pass on a one-wei rise.
 */
contract CurveParamsComputerTest is Test {
    CurveParamsComputer internal computer;
    address internal owner = address(0xA11CE);

    /// @dev Shipped presets (DeployCore): NICHE / STANDARD / HYPE, all at reserve = 1000 bps.
    uint256 internal constant NICHE_TARGET = 5 ether;
    uint256 internal constant NICHE_UNIT = 1_000_000_000;
    uint256 internal constant STANDARD_TARGET = 25 ether;
    uint256 internal constant STANDARD_UNIT = 1_000_000;
    uint256 internal constant HYPE_TARGET = 50 ether;
    uint256 internal constant HYPE_UNIT = 1_000;

    uint256 internal constant RESERVE_BPS = 1000;

    /// @dev Pinned expected pole for reserve = 1000 bps (G = 7.2).
    uint256 internal constant PINNED_POLE = 1.0438e18;

    function setUp() public {
        computer = new CurveParamsComputer(owner);
    }

    // ============================================
    // Helpers
    // ============================================

    function _maxBondingSupply(uint256 nftCount, uint256 unitPerNFT, uint256 bps) internal pure returns (uint256) {
        uint256 totalSupply = nftCount * unitPerNFT * 1e18;
        return totalSupply - (totalSupply * bps) / 10000;
    }

    function _liquidityReserve(uint256 nftCount, uint256 unitPerNFT, uint256 bps) internal pure returns (uint256) {
        return (nftCount * unitPerNFT * 1e18 * bps) / 10000;
    }

    /// @dev Marginal price per 1e18 base units, measured over a probe window of `maxSupply / 1e9`.
    function _pricePerToken(BondingCurveMath.Params memory p, uint256 supply, uint256 probe)
        internal
        pure
        returns (uint256)
    {
        return (BondingCurveMath.calculateCost(p, supply, probe) * 1e18) / probe;
    }

    /// @dev The whole matrix cell: raise, ratio and graduation price, all two-sided.
    function _assertCell(uint256 nftCount, uint256 targetETH, uint256 unitPerNFT, uint256 bps) internal view {
        BondingCurveMath.Params memory p = computer.computeCurveParams(nftCount, targetETH, unitPerNFT, bps);
        uint256 maxSupply = _maxBondingSupply(nftCount, unitPerNFT, bps);
        uint256 probe = maxSupply / 1e9;

        // (a) the raise is still pinned to targetETH
        uint256 raise = BondingCurveMath.calculateCost(p, 0, maxSupply);
        assertApproxEqRel(raise, targetETH, 0.000001e18, "raise must stay pinned to targetETH");

        // (b) a single normalization quantum is never free (no zero-cost prefix)
        assertGt(BondingCurveMath.calculateCost(p, 0, p.normalizationFactor * 1e6), 0, "quantum must cost something");

        // (c) last/first price ratio, against the closed form poleWad / (poleWad - 1e18)
        uint256 first = _pricePerToken(p, 0, probe);
        uint256 last = _pricePerToken(p, maxSupply - probe, probe);
        uint256 ratio = (last * 1e18) / first;
        uint256 expectedRatio = (p.poleWad * 1e18) / (p.poleWad - 1e18);
        assertApproxEqRel(ratio, expectedRatio, 0.001e18, "price ratio off the closed form");
        // The end-to-end ratio always exceeds the graduation multiple for this family, and the
        // multiple is >= 1 by construction — so a flat curve fails here at every reserve.
        assertGt(
            ratio, computer.targetGraduationMultiple(bps), "a curve that ends near where it started is not a curve"
        );

        // (d) the graduation price: the curve must end where the pool opens.
        //     poolOpenPrice = LP share of the raise / tokens seeded into the pool.
        uint256 poolOpenPrice = (((targetETH * 8) / 10) * 1e18) / _liquidityReserve(nftCount, unitPerNFT, bps);
        assertApproxEqRel(last, poolOpenPrice, 0.005e18, "curve end price must match the pool opening price");
    }

    // ============================================
    // 1. The preset x nftCount matrix
    // ============================================

    /// @dev NICHE admits at most 79 NFTs (DN404 uint96 total-supply ceiling at 1e9 units/NFT), so
    ///      the matrix does not assert on counts that cannot be created on chain.
    function test_Matrix_Niche() public view {
        uint256[3] memory counts = [uint256(1), 10, 79];
        for (uint256 i = 0; i < counts.length; i++) {
            _assertCell(counts[i], NICHE_TARGET, NICHE_UNIT, RESERVE_BPS);
        }
    }

    function test_Matrix_Standard() public view {
        uint256[4] memory counts = [uint256(10), 100, 1000, 10000];
        for (uint256 i = 0; i < counts.length; i++) {
            _assertCell(counts[i], STANDARD_TARGET, STANDARD_UNIT, RESERVE_BPS);
        }
    }

    function test_Matrix_Hype() public view {
        uint256[4] memory counts = [uint256(10), 100, 1000, 10000];
        for (uint256 i = 0; i < counts.length; i++) {
            _assertCell(counts[i], HYPE_TARGET, HYPE_UNIT, RESERVE_BPS);
        }
    }

    function test_Matrix_PoleIsInvariantInScale() public view {
        // The shape is scale-free in targetETH, unitPerNFT and nftCount — but only in those.
        uint256 a = computer.computeCurveParams(10, NICHE_TARGET, NICHE_UNIT, RESERVE_BPS).poleWad;
        uint256 b = computer.computeCurveParams(10000, HYPE_TARGET, HYPE_UNIT, RESERVE_BPS).poleWad;
        assertEq(a, b, "same reserve, same pole");
        assertApproxEqRel(a, PINNED_POLE, 0.001e18, "the solver must reproduce the pinned 1.0438e18");
    }

    // ============================================
    // 2. The reserve is the lever, and the solve tracks it
    // ============================================

    function test_Reserve_DifferentBpsProducesADifferentPoleAndStillHitsParity() public view {
        // This is the test that catches a future setPreset retune: with the pole hardcoded for
        // bps = 1000, parity at bps = 2000 breaks silently.
        uint256 bps = 2000;
        BondingCurveMath.Params memory p = computer.computeCurveParams(1000, STANDARD_TARGET, STANDARD_UNIT, bps);

        assertTrue(p.poleWad != PINNED_POLE, "a different reserve must move the pole");
        // G = 0.8 * (1 - 0.2) / 0.2 = 3.2 → eps ~ 0.156
        assertApproxEqRel(p.poleWad, 1.156e18, 0.005e18, "pole for bps=2000");
        assertApproxEqRel(
            computer.graduationMultipleAt(p.poleWad),
            computer.targetGraduationMultiple(bps),
            0.000001e18,
            "achieved multiple must match the target"
        );

        _assertCell(1000, STANDARD_TARGET, STANDARD_UNIT, bps);
    }

    function test_Reserve_TargetMultipleMatchesTheParityIdentity() public view {
        assertEq(computer.targetGraduationMultiple(1000), 7.2e18, "G = 0.8 * 9 at bps = 1000");
        assertEq(computer.targetGraduationMultiple(2000), 3.2e18, "G = 0.8 * 4 at bps = 2000");
    }

    function test_Reserve_UnreachableTargetReverts() public {
        // A reserve so thin that no pole inside the band reaches parity must fail loudly at create,
        // not ship an off-parity curve.
        vm.expectRevert(CurveParamsComputer.ParityTargetUnreachable.selector);
        computer.computeCurveParams(1000, STANDARD_TARGET, STANDARD_UNIT, 100);

        vm.expectRevert(CurveParamsComputer.ParityTargetUnreachable.selector);
        computer.computeCurveParams(1000, STANDARD_TARGET, STANDARD_UNIT, 8000);
    }

    function test_Solve_IsIndependentOfTheOwnerProbe() public {
        BondingCurveMath.Params memory before =
            computer.computeCurveParams(1000, STANDARD_TARGET, STANDARD_UNIT, RESERVE_BPS);

        // Move the probe to the far end of the band: the solve must still land on the same pole.
        vm.prank(owner);
        computer.setCurveWeights(0.025 ether, 1.9e18);

        BondingCurveMath.Params memory afterProbe =
            computer.computeCurveParams(1000, STANDARD_TARGET, STANDARD_UNIT, RESERVE_BPS);

        assertApproxEqRel(afterProbe.poleWad, before.poleWad, 0.000001e18, "probe cannot move the solved pole");
        assertApproxEqRel(afterProbe.poleWad, PINNED_POLE, 0.001e18, "and it is still the pinned pole");
    }

    function test_Solve_AmplitudeWeightDoesNotChangeTheShapeOrTheRaise() public {
        BondingCurveMath.Params memory before =
            computer.computeCurveParams(1000, STANDARD_TARGET, STANDARD_UNIT, RESERVE_BPS);

        vm.prank(owner);
        computer.setCurveWeights(1 ether, PINNED_POLE);

        BondingCurveMath.Params memory afterWeight =
            computer.computeCurveParams(1000, STANDARD_TARGET, STANDARD_UNIT, RESERVE_BPS);

        assertEq(afterWeight.poleWad, before.poleWad, "amplitude weight is not a shape knob");
        uint256 maxSupply = _maxBondingSupply(1000, STANDARD_UNIT, RESERVE_BPS);
        assertApproxEqRel(
            BondingCurveMath.calculateCost(afterWeight, 0, maxSupply),
            BondingCurveMath.calculateCost(before, 0, maxSupply),
            0.000001e18,
            "and the raise is pinned either way"
        );
    }

    // ============================================
    // 3. The parameter band
    // ============================================

    function test_Band_RefusesAPoleBelowTheFloor() public {
        vm.prank(owner);
        vm.expectRevert(CurveParamsComputer.PoleOutOfBand.selector);
        computer.setCurveWeights(0.025 ether, 1.02e18 - 1);
    }

    function test_Band_RefusesAPoleAboveTheCeiling() public {
        vm.prank(owner);
        vm.expectRevert(CurveParamsComputer.PoleOutOfBand.selector);
        computer.setCurveWeights(0.025 ether, 2e18 + 1);
    }

    function test_Band_RefusesTheNumericallyPlausiblePole() public {
        // 1e18 + 1e6 is strictly beyond the cap, the library evaluates it without complaint, and the
        // graduation price it implies is unreachable. A bare `> 1e18` check would accept it.
        vm.prank(owner);
        vm.expectRevert(CurveParamsComputer.PoleOutOfBand.selector);
        computer.setCurveWeights(0.025 ether, 1e18 + 1e6);
    }

    function test_Band_AcceptsBothEndpoints() public {
        vm.prank(owner);
        computer.setCurveWeights(0.025 ether, 1.02e18);
        assertEq(computer.poleWad(), 1.02e18, "floor is inclusive");

        vm.prank(owner);
        computer.setCurveWeights(0.025 ether, 2e18);
        assertEq(computer.poleWad(), 2e18, "ceiling is inclusive");
    }

    function test_Band_RefusesAZeroAmplitude() public {
        vm.prank(owner);
        vm.expectRevert(CurveParamsComputer.KWeightZero.selector);
        computer.setCurveWeights(0, PINNED_POLE);
    }

    function test_Band_OnlyOwner() public {
        vm.expectRevert(Ownable.Unauthorized.selector);
        computer.setCurveWeights(0.025 ether, PINNED_POLE);
    }

    // ============================================
    // 4. Closed forms
    // ============================================

    function test_GraduationMultipleAt_PinnedPole() public view {
        assertApproxEqRel(computer.graduationMultipleAt(PINNED_POLE), 7.2e18, 0.0001e18, "G(1.0438) = 7.2");
    }

    function test_GraduationMultipleAt_IsMonotoneDecreasing() public view {
        uint256 prev = type(uint256).max;
        for (uint256 pole = 1.02e18; pole <= 2e18; pole += 0.02e18) {
            uint256 g = computer.graduationMultipleAt(pole);
            assertLt(g, prev, "G must decrease as the pole moves away from the cap");
            prev = g;
        }
    }

    function testFuzz_SolveHitsParity(uint256 bps) public view {
        // Every reserve the band can serve must solve to a pole that hits its own parity target.
        bps = bound(bps, 700, 3000);
        uint256 targetG = computer.targetGraduationMultiple(bps);
        uint256 pole = computer.solvePole(targetG);
        assertGe(pole, computer.MIN_POLE_WAD(), "solved pole is inside the band");
        assertLe(pole, computer.MAX_POLE_WAD(), "solved pole is inside the band");
        assertApproxEqRel(computer.graduationMultipleAt(pole), targetG, 0.000001e18, "solve hits its target");
    }
}
