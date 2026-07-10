// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { UniPriceValidatorHarness } from "../helpers/UniPriceValidatorHarness.sol";
import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";

/// @title UniSwapProportionTest
/// @notice noesis-034 — unit proof that the zap-in swap proportion is numeraire-correct and points in
///         the RIGHT direction. These are pure math over _computeProportionFromSqrtPrice (via a
///         harness), plus direct tests of the guard/clamp. They run in the default (non-fork) suite —
///         they are the theorems the whole fix exists to establish, and unlike a fork test they cannot
///         be silently skipped.
///
///         The pre-fix formula summed amount0 (wei) and amount1 (token units) and returned 1/(1+P),
///         which at full range equals 5e17 ONLY at P == 1. Every full-range test below uses a price
///         far from 1, so the buggy formula would fail them. The bounded-range tests additionally pin
///         the DIRECTION (token side over total): full range collapses to a constant and cannot.
contract UniSwapProportionTest is Test {
    UniPriceValidatorHarness harness;

    // Any nonzero token address makes ETH (address(0)) sort to currency0, matching production.
    address constant TOKEN = address(0xBEEF);
    int24 constant SPACING = 60;

    function setUp() public {
        harness = new UniPriceValidatorHarness();
    }

    // ── Full range: 5e17 at every price (the theorem this vault relies on) ──────────────────────
    // Ticks approximating P = 1e-3, 1, 1e6 (exact P is irrelevant: full range is 5e17 at ANY price).

    function test_fullRange_isHalf_atLowPrice() public view {
        _assertFullRangeHalf(-69078); // P ≈ 1e-3
    }

    function test_fullRange_isHalf_atUnitPrice() public view {
        _assertFullRangeHalf(0); // P = 1
    }

    function test_fullRange_isHalf_atHighPrice() public view {
        _assertFullRangeHalf(138163); // P ≈ 1e6 (CULT-like). Pre-fix formula → ~1e12, off by ~5e17.
    }

    function _assertFullRangeHalf(int24 spotTick) internal view {
        int24 lower = TickMath.minUsableTick(SPACING);
        int24 upper = TickMath.maxUsableTick(SPACING);
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(spotTick);
        (bool valid, uint256 prop) = harness.computeProportion(sqrtP, TOKEN, lower, upper);
        assertTrue(valid, "full-range must be in-range");
        // Theorem: full-range is 50% BY VALUE at every price. Integer rounding (getAmountsForLiquidity
        // truncation + mulDiv floor) leaves a few-wei deviation at extreme prices — observed max 7 wei
        // at P ≈ 1e-3, i.e. ~1.4e-17 relative. The spec's "±1 wei" is the idealized real-number result;
        // 16 wei is an honest bound that still decisively excludes the buggy 1/(1+P) (~1e12 or ~1e18).
        assertApproxEqAbs(prop, 5e17, 16, "full-range proportion must be 50% by value");
    }

    // ── Bounded range: DIRECTION. Only these can distinguish the correct form from the inverted one,
    //    because full range collapses both to 5e17. ────────────────────────────────────────────────

    /// Price at/near the LOWER tick ⇒ position is ~all ETH (amount1 ≈ 0) ⇒ swap ~nothing ⇒ proportion → 0.
    /// The INVERTED form would return ~1e18 here. This is the trap that hid the original defect.
    function test_boundedRange_atLowerTick_isZero() public view {
        int24 lower = -6932; // price ≈ 0.5
        int24 upper = 20_794; // price ≈ 8
        (bool valid, uint256 prop) = harness.computeProportion(TickMath.getSqrtPriceAtTick(lower), TOKEN, lower, upper);
        assertTrue(valid, "in-range at lower boundary");
        assertEq(prop, 0, "at the lower tick the position is all ETH: swap nothing");
    }

    /// Price at/near the UPPER tick ⇒ position is ~all token (amount0 ≈ 0) ⇒ swap ~everything ⇒ → 1e18.
    function test_boundedRange_atUpperTick_isOne() public view {
        int24 lower = -6932;
        int24 upper = 20_794;
        (bool valid, uint256 prop) = harness.computeProportion(TickMath.getSqrtPriceAtTick(upper), TOKEN, lower, upper);
        assertTrue(valid, "in-range at upper boundary");
        assertEq(prop, 1e18, "at the upper tick the position is all token: swap everything");
    }

    /// Interior case: P = 1, range [P/2, 8P]. Hand derivation with L = 1e18, sqrtP = 1:
    ///   amount0 = (sqrtB - 1)/sqrtB,  amount1 = (1 - sqrtA),  sqrtA = sqrt(0.5), sqrtB = sqrt(8)
    ///   ethValue = amount0 = 0.646447,  tokenValueInEth = amount1 / P = 0.292893
    ///   proportion = 0.292893 / (0.646447 + 0.292893) = 0.31181...  (≈ 0.312e18)
    /// The INVERTED form (ETH side over total) would give 0.688e18. The assertion band excludes it.
    function test_boundedRange_interior_isTokenSideOverTotal() public view {
        int24 lower = -6932; // ≈ P/2
        int24 upper = 20_794; // ≈ 8P
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(0); // P = 1
        (bool valid, uint256 prop) = harness.computeProportion(sqrtP, TOKEN, lower, upper);
        assertTrue(valid, "interior in-range");
        // ≈ 0.312e18, hand-derived above. Tolerance absorbs tick-rounding (the chosen ticks approximate
        // [0.5, 8]); the band [0.27, 0.35] contains 0.312 and firmly excludes the inverted 0.688.
        assertApproxEqAbs(prop, 0.3118e18, 0.02e18, "interior proportion is the TOKEN side over total (not inverted)");
        assertLt(prop, 0.5e18, "must be below 50% (token side), never the inverted 0.688");
    }

    // ── Guard / clamp redesign. The absolute clamp now fires UNCONDITIONALLY (pre-fix it lived only in
    //    the no-TWAP branch, so a target with a live V3 TWAP got no absolute backstop). ──────────────

    /// The critical regression: a TWAP exists (twapValid = true) yet the absolute clamp STILL fires.
    /// Pre-fix, calculateSwapProportion returned the raw 0.9e18 in this path.
    function test_clamp_firesEvenWhenTwapPresent_high() public view {
        // spot == twap ⇒ deviation 0 ⇒ no revert ⇒ clamp caps at 65%.
        assertEq(harness.applyGuards(0.9e18, true, 0.9e18), 65e16, "clamp must cap at 65% even with a TWAP");
    }

    function test_clamp_firesEvenWhenTwapPresent_low() public view {
        assertEq(harness.applyGuards(0.1e18, true, 0.1e18), 35e16, "clamp must floor at 35% even with a TWAP");
    }

    function test_clamp_appliesWithoutTwap() public view {
        assertEq(harness.applyGuards(0.9e18, false, 0), 65e16, "clamp applies in the no-TWAP path too");
    }

    function test_guard_deviationReverts() public {
        // diff = 0.11e18 > 5e16 ⇒ revert regardless of the clamp.
        vm.expectRevert(UniswapVaultPriceValidator.SwapProportionDeviationTooHigh.selector);
        harness.applyGuards(0.5e18, true, 0.61e18);
    }

    function test_guard_withinDeviation_passesThroughClamped() public view {
        // diff = 0.04e18 < 5e16 ⇒ no revert; 0.5e18 is inside [35%,65%] ⇒ returned unchanged.
        assertEq(harness.applyGuards(0.5e18, true, 0.54e18), 0.5e18, "in-band value survives both guards");
    }
}
