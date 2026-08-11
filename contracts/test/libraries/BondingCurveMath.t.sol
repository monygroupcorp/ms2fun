// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";

/**
 * @title BondingCurveMathTest
 * @notice Test suite for BondingCurveMath — hyperbolic family P(s) = kCoeff / (poleWad - s),
 *         I(s) = -kCoeff * ln(1 - s / poleWad), s = supply / normalizationFactor.
 * @dev The fixtures below are real curves: `normalizationFactor` maps the bonding cap onto s = 1e18,
 *      and every magnitude assertion is two-sided against the closed form. A flat curve fails them.
 */
contract BondingCurveMathTest is Test {
    using BondingCurveMath for BondingCurveMath.Params;

    /// @dev Pole solved for the shipped presets (liquidityReserveBps = 1000 → G = 7.2).
    uint256 internal constant POLE = 1.0438e18;
    /// @dev Bonding cap in base units for a 1e7 normalization factor: s(CAP) = 1e18.
    uint256 internal constant CAP = 1e25;
    uint256 internal constant NORM = 1e7;

    /// @notice Shipped-preset shape: pole 4.38% beyond the cap.
    BondingCurveMath.Params public standardParams;
    /// @notice Flattest shape the parameter band admits (pole = 2e18, ratio 2x).
    BondingCurveMath.Params public gentleParams;
    /// @notice Steepest shape the parameter band admits (pole = 1.02e18, ratio 51x).
    BondingCurveMath.Params public steepParams;

    function setUp() public {
        standardParams = BondingCurveMath.Params({ kCoeff: 1 ether, poleWad: POLE, normalizationFactor: NORM });
        gentleParams = BondingCurveMath.Params({ kCoeff: 1 ether, poleWad: 2e18, normalizationFactor: NORM });
        steepParams = BondingCurveMath.Params({ kCoeff: 1 ether, poleWad: 1.02e18, normalizationFactor: NORM });
    }

    // ============================================
    // Helpers
    // ============================================

    /// @dev Cost of a small probe window at normalized supply `sWad`, i.e. the marginal price times
    ///      the probe width. The probe is 1e-9 of the bonding range, so the secant sits within
    ///      ~1e-9 of the tangent.
    function _priceAt(BondingCurveMath.Params memory p, uint256 sWad) internal pure returns (uint256) {
        uint256 probe = 1e9 * p.normalizationFactor;
        uint256 supply = sWad * p.normalizationFactor;
        return BondingCurveMath.calculateCost(p, supply, probe);
    }

    /// @dev Closed-form last/first price ratio: poleWad / (poleWad - 1e18).
    function _expectedRatio(BondingCurveMath.Params memory p) internal pure returns (uint256) {
        return (p.poleWad * 1e18) / (p.poleWad - 1e18);
    }

    // ============================================
    // 1. Magnitude — the gate the family exists for
    // ============================================

    function test_Magnitude_PriceRatioMatchesClosedForm() public view {
        // last/first price ratio must land on poleWad / (poleWad - 1e18), two-sided.
        // A flat curve reads 1.0 here and fails at every pole in the band.
        uint256 first = _priceAt(standardParams, 0);
        uint256 last = _priceAt(standardParams, 1e18 - 1e9);
        uint256 ratio = (last * 1e18) / first;

        assertApproxEqRel(ratio, _expectedRatio(standardParams), 0.001e18, "standard ratio off closed form");
        assertApproxEqRel(ratio, 23.8310502e18, 0.001e18, "standard ratio off the pinned 23.83x");
    }

    function test_Magnitude_PriceRatioAcrossBand() public view {
        uint256 gentleRatio = (_priceAt(gentleParams, 1e18 - 1e9) * 1e18) / _priceAt(gentleParams, 0);
        uint256 steepRatio = (_priceAt(steepParams, 1e18 - 1e9) * 1e18) / _priceAt(steepParams, 0);

        assertApproxEqRel(gentleRatio, _expectedRatio(gentleParams), 0.001e18, "gentle ratio off closed form");
        assertApproxEqRel(steepRatio, _expectedRatio(steepParams), 0.001e18, "steep ratio off closed form");
        // Two-sided, so neither degenerates to flat and neither runs away.
        assertApproxEqRel(gentleRatio, 2e18, 0.001e18, "gentle should be exactly 2x end to end");
        assertApproxEqRel(steepRatio, 51e18, 0.001e18, "steep should be exactly 51x end to end");
    }

    function test_Magnitude_GraduationMultiple() public view {
        // Final price / average price = (R - 1) / ln R = 7.2 at the shipped pole. The whole range is
        // exactly 1e18 of normalized supply, so the total raise IS the average price per WAD.
        uint256 total = BondingCurveMath.calculateCost(standardParams, 0, CAP);
        uint256 lastPrice = (_priceAt(standardParams, 1e18 - 1e9) * 1e18) / 1e9;

        uint256 g = (lastPrice * 1e18) / total;
        assertApproxEqRel(g, 7.2e18, 0.001e18, "graduation multiple must be 7.2x at the shipped pole");
    }

    function test_Magnitude_PriceShapeAcrossSupply() public view {
        // Measured multipliers of the average price at 0 / 50% / 90% of supply.
        uint256 total = BondingCurveMath.calculateCost(standardParams, 0, CAP);
        uint256 p0 = (_priceAt(standardParams, 0) * 1e18) / 1e9;
        uint256 p50 = (_priceAt(standardParams, 0.5e18) * 1e18) / 1e9;
        uint256 p90 = (_priceAt(standardParams, 0.9e18) * 1e18) / 1e9;

        assertApproxEqRel((p0 * 1e18) / total, 0.302e18, 0.01e18, "price at 0 should be 0.302x average");
        assertApproxEqRel((p50 * 1e18) / total, 0.581e18, 0.01e18, "price at 50% should be 0.581x average");
        assertApproxEqRel((p90 * 1e18) / total, 2.193e18, 0.01e18, "price at 90% should be 2.193x average");
    }

    function test_Magnitude_LastDecileCarriesTheRaise() public view {
        // The early-buyer advantage is the design: the first decile pays ~3.2% of the raise and the
        // last decile ~37.7%. Asserted two-sided so a flatter or a steeper curve both fail.
        uint256 total = BondingCurveMath.calculateCost(standardParams, 0, CAP);
        uint256 firstDecile = BondingCurveMath.calculateCost(standardParams, 0, CAP / 10);
        uint256 lastDecile = BondingCurveMath.calculateCost(standardParams, (CAP * 9) / 10, CAP / 10);

        assertApproxEqRel((firstDecile * 1e18) / total, 0.0316e18, 0.02e18, "first decile share");
        assertApproxEqRel((lastDecile * 1e18) / total, 0.377e18, 0.02e18, "last decile share");
    }

    // ============================================
    // 2. Integral basics
    // ============================================

    function test_calculateIntegral_SamePoints() public view {
        uint256 supply = 1_000_000 * 1e18;
        assertEq(BondingCurveMath.calculateIntegral(standardParams, supply, supply), 0, "integral of a point is zero");
    }

    function test_calculateIntegral_Additivity() public view {
        uint256 a = BondingCurveMath.calculateIntegral(standardParams, 0, CAP / 3);
        uint256 b = BondingCurveMath.calculateIntegral(standardParams, CAP / 3, (2 * CAP) / 3);
        uint256 total = BondingCurveMath.calculateIntegral(standardParams, 0, (2 * CAP) / 3);
        assertEq(a + b, total, "integral additivity");
    }

    function test_calculateIntegral_InvalidBounds() public {
        vm.expectRevert(BondingCurveMath.InvalidBounds.selector);
        this.externalCalculateIntegral(standardParams, 100, 50);
    }

    function test_calculateIntegral_ZeroNormalizationFactor() public {
        BondingCurveMath.Params memory bad = standardParams;
        bad.normalizationFactor = 0;
        vm.expectRevert(BondingCurveMath.NormalizationFactorZero.selector);
        this.externalCalculateIntegral(bad, 0, 1e18);
    }

    function externalCalculateIntegral(BondingCurveMath.Params memory params, uint256 lower, uint256 upper)
        external
        pure
        returns (uint256)
    {
        return BondingCurveMath.calculateIntegral(params, lower, upper);
    }

    function externalCalculateCost(BondingCurveMath.Params memory params, uint256 supply, uint256 amount)
        external
        pure
        returns (uint256)
    {
        return BondingCurveMath.calculateCost(params, supply, amount);
    }

    function externalCalculateRefund(BondingCurveMath.Params memory params, uint256 supply, uint256 amount)
        external
        pure
        returns (uint256)
    {
        return BondingCurveMath.calculateRefund(params, supply, amount);
    }

    // ============================================
    // 3. Domain — the pole is the edge of the world
    // ============================================

    function test_Domain_AtPoleReverts() public {
        uint256 atPole = POLE * NORM;
        vm.expectRevert(BondingCurveMath.SupplyAtOrBeyondPole.selector);
        this.externalCalculateCost(standardParams, atPole, 0);
    }

    function test_Domain_BeyondPoleReverts() public {
        uint256 beyondPole = (POLE + 1e15) * NORM;
        vm.expectRevert(BondingCurveMath.SupplyAtOrBeyondPole.selector);
        this.externalCalculateCost(standardParams, beyondPole, 1e18);
    }

    function test_Domain_JustInsidePoleIsFinite() public view {
        uint256 justInside = POLE * NORM - NORM;
        assertEq(
            BondingCurveMath.calculateCost(standardParams, justInside, 0),
            0,
            "zero amount is zero cost even next to the pole"
        );
    }

    function test_Domain_CapIsStrictlyInsideThePole() public view {
        // The whole bonding range evaluates without reverting, which is the property the pole band
        // exists to preserve.
        assertGt(BondingCurveMath.calculateCost(standardParams, 0, CAP), 0, "full range must price");
    }

    function test_Domain_PathologicalPoleStillEvaluates() public view {
        // At poleWad = 1e18 + 1e6 the library is perfectly well behaved — nothing reverts, nothing
        // overflows — and the graduation price is astronomically high. The library cannot catch
        // this; CurveParamsComputer's band does.
        BondingCurveMath.Params memory pathological =
            BondingCurveMath.Params({ kCoeff: 1 ether, poleWad: 1e18 + 1e6, normalizationFactor: NORM });
        assertGt(BondingCurveMath.calculateCost(pathological, 0, CAP), 0, "pathological pole still prices");
        uint256 first = _priceAt(pathological, 0);
        uint256 last = _priceAt(pathological, 1e18 - 1e9);
        assertGt(last / first, 1e9, "and produces an unreachable graduation price");
    }

    // ============================================
    // 4. Cost
    // ============================================

    function test_calculateCost_ZeroAmount() public view {
        assertEq(BondingCurveMath.calculateCost(standardParams, 0, 0), 0, "zero amount, zero cost");
    }

    function test_calculateCost_MonotonicIncreasing() public view {
        uint256 supply = 0;
        uint256 previousCost = 0;
        uint256 step = CAP / 20;

        for (uint256 i = 0; i < 10; i++) {
            uint256 cost = BondingCurveMath.calculateCost(standardParams, supply, step);
            assertGt(cost, previousCost, "each equal-size slice must cost strictly more");
            previousCost = cost;
            supply += step;
        }
    }

    function test_calculateCost_SequentialEqualsBulk() public view {
        uint256 a = CAP / 6;
        uint256 b = CAP / 5;
        uint256 c = CAP / 4;
        uint256 sequential = BondingCurveMath.calculateCost(standardParams, 0, a)
            + BondingCurveMath.calculateCost(standardParams, a, b)
            + BondingCurveMath.calculateCost(standardParams, a + b, c);
        assertEq(sequential, BondingCurveMath.calculateCost(standardParams, 0, a + b + c), "telescoping");
    }

    function test_calculateCost_SteeperPoleCostsMoreLate() public view {
        uint256 lateSupply = (CAP * 9) / 10;
        uint256 amount = CAP / 100;
        uint256 gentle = BondingCurveMath.calculateCost(gentleParams, lateSupply, amount);
        uint256 steep = BondingCurveMath.calculateCost(steepParams, lateSupply, amount);
        assertGt(steep, gentle * 3, "a tighter pole must charge materially more at the top");
    }

    function test_calculateCost_SubQuantumRoundsToZero() public view {
        // Purchases smaller than normalizationFactor BASE UNITS floor to zero normalized supply.
        // ERC404BondingInstance guards this with PurchaseTooSmall.
        assertEq(BondingCurveMath.calculateCost(standardParams, 0, NORM - 1), 0, "sub-quantum is free");
        assertGt(BondingCurveMath.calculateCost(standardParams, 0, NORM * 1e6), 0, "a real purchase is not");
    }

    // ============================================
    // 5. Refund and sell-side symmetry
    // ============================================

    function test_calculateRefund_ZeroAmount() public view {
        assertEq(BondingCurveMath.calculateRefund(standardParams, CAP / 2, 0), 0, "zero refund");
    }

    function test_calculateRefund_ExceedsSupply() public {
        vm.expectRevert(BondingCurveMath.AmountExceedsSupply.selector);
        this.externalCalculateRefund(standardParams, 100, 101);
    }

    function test_SellSide_BuyThenSellNeverPaysOutMore_Boundaries() public view {
        // Both boundaries and a range of window sizes. The refund is the same integral difference as
        // the cost, so equality is the tight case and any drift must be downward.
        uint256[5] memory supplies = [uint256(0), NORM, CAP / 2, CAP - NORM * 1e6, CAP - NORM];
        uint256[3] memory amounts = [NORM, NORM * 1e6, CAP / 4];

        for (uint256 i = 0; i < supplies.length; i++) {
            for (uint256 j = 0; j < amounts.length; j++) {
                uint256 supply = supplies[i];
                uint256 amount = amounts[j];
                if (supply + amount > CAP) continue;
                uint256 cost = BondingCurveMath.calculateCost(standardParams, supply, amount);
                uint256 refund = BondingCurveMath.calculateRefund(standardParams, supply + amount, amount);
                assertLe(refund, cost, "a round trip must never pay out more than it took in");
            }
        }
    }

    function test_SellSide_FirstAndLastUnit() public view {
        uint256 quantum = NORM * 1e6;

        uint256 firstCost = BondingCurveMath.calculateCost(standardParams, 0, quantum);
        uint256 firstRefund = BondingCurveMath.calculateRefund(standardParams, quantum, quantum);
        assertLe(firstRefund, firstCost, "first unit round trip");

        uint256 lastCost = BondingCurveMath.calculateCost(standardParams, CAP - quantum, quantum);
        uint256 lastRefund = BondingCurveMath.calculateRefund(standardParams, CAP, quantum);
        assertLe(lastRefund, lastCost, "last unit round trip");
        assertGt(lastCost, firstCost * 20, "and the last unit is more than an order of magnitude dearer");
    }

    function test_SellSide_SequentialSellsTelescope() public view {
        uint256 supply = CAP / 2;
        uint256 r1 = BondingCurveMath.calculateRefund(standardParams, supply, CAP / 20);
        uint256 r2 = BondingCurveMath.calculateRefund(standardParams, supply - CAP / 20, CAP / 20);
        uint256 total = BondingCurveMath.calculateRefund(standardParams, supply, CAP / 10);
        assertEq(r1 + r2, total, "split sells telescope exactly");
    }

    // ============================================
    // 6. Normalization factor
    // ============================================

    function test_NormalizationFactor_LargerIsCheaperForTheSameAbsoluteAmount() public view {
        BondingCurveMath.Params memory tenX = standardParams;
        tenX.normalizationFactor = NORM * 10;

        uint256 amount = CAP / 100;
        assertLt(
            BondingCurveMath.calculateCost(tenX, 0, amount),
            BondingCurveMath.calculateCost(standardParams, 0, amount),
            "10x normalization walks 1/10th as far along the curve"
        );
    }

    function test_NormalizationFactor_ShapeIsScaleFree() public view {
        // The dimensionless price ratio does not depend on the normalization factor.
        BondingCurveMath.Params memory tenX = standardParams;
        tenX.normalizationFactor = NORM * 10;

        uint256 base = (_priceAt(standardParams, 1e18 - 1e9) * 1e18) / _priceAt(standardParams, 0);
        uint256 scaled = (_priceAt(tenX, 1e18 - 1e9) * 1e18) / _priceAt(tenX, 0);
        assertApproxEqRel(scaled, base, 0.0001e18, "ratio is scale-free in normalizationFactor");
    }

    // ============================================
    // 7. Gas
    // ============================================

    function test_GasOptimization() public view {
        uint256 gasBefore = gasleft();
        BondingCurveMath.calculateCost(standardParams, CAP / 2, CAP / 100);
        uint256 gasUsed = gasBefore - gasleft();
        console2.log("Gas used for calculateCost:", gasUsed);
        assertLt(gasUsed, 50000, "gas usage should be reasonable");
    }

    // ============================================
    // 8. Fuzz
    // ============================================

    function testFuzz_CalculateCost(uint256 supply, uint256 amount) public view {
        supply = bound(supply, 0, CAP);
        amount = bound(amount, 0, CAP - supply);

        uint256 cost = BondingCurveMath.calculateCost(standardParams, supply, amount);
        if (amount == 0) {
            assertEq(cost, 0, "zero amount, zero cost");
        } else if (amount >= NORM * 1e6) {
            assertGt(cost, 0, "any purchase of a real size costs something");
        }
    }

    function testFuzz_BuySellSymmetry(uint256 supply, uint256 amount) public view {
        supply = bound(supply, 1, CAP);
        amount = bound(amount, 1, supply);

        uint256 refund = BondingCurveMath.calculateRefund(standardParams, supply, amount);
        uint256 cost = BondingCurveMath.calculateCost(standardParams, supply - amount, amount);
        assertLe(refund, cost, "refund never exceeds the cost over the same range");
    }

    function testFuzz_CostMonotonicity(uint256 s1, uint256 s2, uint256 amount) public view {
        // Below a few normalization quanta the integral difference is a handful of wei and the
        // floor rounding in `divWad` can reorder two independent evaluations; size the window so
        // the comparison is about the curve, not about the last wei.
        amount = bound(amount, NORM * 1e6, CAP / 10);
        s1 = bound(s1, 0, CAP / 2);
        s2 = bound(s2, s1 + 1, CAP - amount);

        // Each cost is a difference of two independently floored integrals, so two evaluations can
        // disagree by a few wei on ordering when the two supplies are within one quantum.
        uint256 ROUNDING_TOLERANCE = 8;
        uint256 cost1 = BondingCurveMath.calculateCost(standardParams, s1, amount);
        uint256 cost2 = BondingCurveMath.calculateCost(standardParams, s2, amount);
        assertLe(cost1, cost2 + ROUNDING_TOLERANCE, "cost rises with supply (within rounding)");
    }

    function testFuzz_RefundMonotonicity(uint256 s1, uint256 s2, uint256 amount) public view {
        amount = bound(amount, NORM * 1e6, CAP / 10);
        s1 = bound(s1, amount, CAP / 2);
        s2 = bound(s2, s1 + 1, CAP);

        uint256 ROUNDING_TOLERANCE = 8;
        uint256 refund1 = BondingCurveMath.calculateRefund(standardParams, s1, amount);
        uint256 refund2 = BondingCurveMath.calculateRefund(standardParams, s2, amount);
        assertLe(refund1, refund2 + ROUNDING_TOLERANCE, "refund rises with supply (within rounding)");
    }

    function testFuzz_IntegralAdditivity(uint256 a, uint256 b, uint256 c) public view {
        a = bound(a, 0, CAP / 2);
        b = bound(b, a, (CAP * 3) / 4);
        c = bound(c, b, CAP);

        uint256 int1 = BondingCurveMath.calculateIntegral(standardParams, a, b);
        uint256 int2 = BondingCurveMath.calculateIntegral(standardParams, b, c);
        uint256 intTotal = BondingCurveMath.calculateIntegral(standardParams, a, c);
        assertEq(int1 + int2, intTotal, "integral additivity holds");
    }

    function testFuzz_PriceRatioIsClosedForm(uint256 pole) public view {
        pole = bound(pole, 1.02e18, 2e18);
        BondingCurveMath.Params memory p =
            BondingCurveMath.Params({ kCoeff: 1 ether, poleWad: pole, normalizationFactor: NORM });

        uint256 ratio = (_priceAt(p, 1e18 - 1e9) * 1e18) / _priceAt(p, 0);
        assertApproxEqRel(ratio, _expectedRatio(p), 0.001e18, "ratio tracks the closed form over the whole band");
        assertGt(ratio, 1.9e18, "no pole in the band produces a flat curve");
    }
}
