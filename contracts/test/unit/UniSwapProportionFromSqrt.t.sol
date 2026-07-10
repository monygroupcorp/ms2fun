// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { UniPriceValidatorHarness } from "../helpers/UniPriceValidatorHarness.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";

/// @title UniSwapProportionFromSqrtTest
/// @notice noesis-027a — proves the NEW venue-agnostic entry point
///         `calculateSwapProportionFromSqrtPrice(token, tickLower, tickUpper, sqrtPriceX96)` is the SAME
///         numeraire-correct, direction-correct core as the V4 `calculateSwapProportion`, just fed a
///         caller-supplied spot price (what an Algebra vault passes from `globalState().price`).
///
///         The harness is a full validator constructed with dummy factory addresses, so the V3 TWAP
///         source has no code => TWAP unavailable => only the absolute [35%,65%] clamp fires. That makes
///         the external function deterministic here and lets these tests pin BOTH the raw core value and
///         the clamp wiring.
contract UniSwapProportionFromSqrtTest is Test {
    UniPriceValidatorHarness harness;

    // Any nonzero token address makes ETH (address(0)) sort to currency0, matching production.
    address constant TOKEN = address(0xBEEF);
    int24 constant SPACING = 60;

    function setUp() public {
        harness = new UniPriceValidatorHarness();
    }

    // ── Full range: 5e17 at every price (the theorem), via the new entry point ─────────────────────
    // Ticks approximating P = 1e-3, 1, 1e6 (exact P is irrelevant: full range is 5e17 at ANY price).

    function test_fromSqrt_fullRange_half_lowPrice() public view {
        _assertFullRangeHalf(-69078); // P ≈ 1e-3
    }

    function test_fromSqrt_fullRange_half_unitPrice() public view {
        _assertFullRangeHalf(0); // P = 1
    }

    function test_fromSqrt_fullRange_half_highPrice() public view {
        _assertFullRangeHalf(138163); // P ≈ 1e6
    }

    function _assertFullRangeHalf(int24 spotTick) internal view {
        int24 lower = TickMath.minUsableTick(SPACING);
        int24 upper = TickMath.maxUsableTick(SPACING);
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(spotTick);
        uint256 prop = harness.calculateSwapProportionFromSqrtPrice(TOKEN, lower, upper, sqrtP);
        // Full range is 50% BY VALUE at every price; 5e17 sits inside the clamp band so it passes through.
        // 16-wei tolerance absorbs getAmountsForLiquidity truncation + mulDiv floor at extreme prices.
        assertApproxEqAbs(prop, 5e17, 16, "full-range proportion is 50% by value");
    }

    // ── Direction (the #31 test): at the LOWER tick the position is ~all ETH => token side ≈ 0 => the raw
    //    core is ~0 and the clamp floors to 35%. The INVERTED form would be ~1 => clamp to 65%. So the
    //    35e16 result proves both the direction AND that the clamp is wired into the new entry point. ──

    function test_fromSqrt_boundedLower_tokenSideLow_clampedTo35() public view {
        int24 lower = -6932; // price ≈ 0.5
        int24 upper = 20_794; // price ≈ 8
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(lower);

        // Raw core: token side over total ≈ 0 (not the inverted ~1e18).
        (bool valid, uint256 raw) = harness.computeProportion(sqrtP, TOKEN, lower, upper);
        assertTrue(valid, "in-range at lower boundary");
        assertLt(raw, 5e17, "raw is the TOKEN side (low), never the inverted ETH side");

        uint256 prop = harness.calculateSwapProportionFromSqrtPrice(TOKEN, lower, upper, sqrtP);
        assertEq(prop, 35e16, "clamp floors the ~0 token-side proportion to 35%");
    }

    /// Interior at P = 1, range ≈ [0.5, 8]: raw core ≈ 0.312e18 (token side over total, hand-derived in
    /// UniSwapProportion.t.sol). Below the 35% floor => the new entry point clamps to 35e16, while the raw
    /// core stays 0.312 — proving the clamp, not a hardcoded 50%, and that direction is not inverted.
    function test_fromSqrt_boundedInterior_isTokenSideThenClamped() public view {
        int24 lower = -6932;
        int24 upper = 20_794;
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(0); // P = 1

        (bool valid, uint256 raw) = harness.computeProportion(sqrtP, TOKEN, lower, upper);
        assertTrue(valid, "interior in-range");
        assertApproxEqAbs(raw, 0.3118e18, 0.02e18, "raw is the token side over total (not inverted 0.688)");

        uint256 prop = harness.calculateSwapProportionFromSqrtPrice(TOKEN, lower, upper, sqrtP);
        assertEq(prop, 35e16, "0.312 is below the 35% floor => clamped, not returned as 5e17");
    }

    /// At the UPPER tick the position is ~all token => raw ≈ 1e18 => clamp caps at 65%. Inverted would be
    /// ~0 => clamp to 35%. The 65e16 result is the direction proof on the high side.
    function test_fromSqrt_boundedUpper_tokenSideHigh_clampedTo65() public view {
        int24 lower = -6932;
        int24 upper = 20_794;
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(upper);

        (bool valid, uint256 raw) = harness.computeProportion(sqrtP, TOKEN, lower, upper);
        assertTrue(valid, "in-range at upper boundary");
        assertGt(raw, 5e17, "raw is the TOKEN side (high), never the inverted ETH side");

        uint256 prop = harness.calculateSwapProportionFromSqrtPrice(TOKEN, lower, upper, sqrtP);
        assertEq(prop, 65e16, "clamp caps the ~1e18 token-side proportion to 65%");
    }

    // ── In-band delegation: when the raw core lands inside [35%,65%], the clamp is inert and the new
    //    entry point returns the EXACT core value — proving it delegates to _computeProportionFromSqrtPrice
    //    with no independent (possibly inverted) reimplementation. ────────────────────────────────────

    function test_fromSqrt_inBand_returnsExactCoreValue() public view {
        int24 lower = -6932; // ≈ 0.5
        int24 upper = 6932; // ≈ 2  (log-symmetric range about P = 1)
        // Price just below the center => raw a little under 50%, comfortably inside the clamp band.
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(-1500);

        (bool valid, uint256 raw) = harness.computeProportion(sqrtP, TOKEN, lower, upper);
        assertTrue(valid, "in-range");
        assertGt(raw, 35e16, "raw inside the clamp band (above the floor)");
        assertLt(raw, 65e16, "raw inside the clamp band (below the cap)");
        assertLt(raw, 5e17, "price below center => token side below half (direction, not inverted)");

        uint256 prop = harness.calculateSwapProportionFromSqrtPrice(TOKEN, lower, upper, sqrtP);
        assertEq(prop, raw, "in-band: new entry point returns the exact core proportion (pure delegation)");
    }

    /// Zero spot price degrades to the balanced 50:50 entry, identical to the V4 path's guard.
    function test_fromSqrt_zeroSpot_isBalanced() public view {
        int24 lower = -6932;
        int24 upper = 20_794;
        assertEq(harness.calculateSwapProportionFromSqrtPrice(TOKEN, lower, upper, 0), 5e17, "zero spot => 50%");
    }
}
