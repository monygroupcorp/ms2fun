// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";
import { MockV3DepthPool, MockV3DepthFactory } from "../vaults/ValidatorTwapGuard.t.sol";

/**
 * @title PriceValidatorSpotTwapBand
 * @notice Audit L-6..L-9 pass, finding L-7: every guard in `UniswapVaultPriceValidator` was computed on
 *         the swap PROPORTION, and both shipping vaults open FULL-RANGE positions whose proportion is
 *         5e17 at every price. So on the live path the deviation check compared a constant with itself
 *         and the [35%,65%] clamp saw a number already inside the band — measured worst deviation across
 *         the realistic price band was 5.45e-15 against a 5e16 threshold, ten orders of magnitude of
 *         headroom (`PriceValidatorFullRangeInertGuards`, which still pins that theorem).
 *
 *         The fix does not touch the proportion guards — they are correct, and they bind on the bounded
 *         ranges this shared validator must also serve. It adds the guard that survives the shape: the
 *         caller's spot price must sit within `maxPriceDeviationBps` of the V3 TWAP, which moves whatever
 *         the position's shape is.
 *
 *         Every test here uses the full range the vaults use, so each one is red before the fix — the
 *         reverting cases returned 5e17 without complaint.
 */
contract PriceValidatorSpotTwapBandTest is Test {
    /// @dev Above WETH, so the V3 pool orders the pair the same way a V4 native-ETH pool does.
    address internal constant WETH = address(0x1111);
    address internal constant TOKEN_ABOVE_WETH = address(0xBEEF);
    /// @dev Below WETH, so the V3 pool orders WETH second and its price is the caller's reciprocal.
    address internal constant TOKEN_BELOW_WETH = address(0x0011);

    int24 internal constant SPACING = 60;

    /// @dev The band the sepolia and anvil deploys configure. 10% of price.
    uint256 internal constant DEVIATION_BPS = 1000;

    /// @dev Well above the validator's `MIN_REFERENCE_LIQUIDITY`, so depth is never why a pool is skipped.
    uint128 internal constant DEEP = 1e24;

    /// @dev 1.0001^2000 = 1.2214: 22% of price, comfortably outside a 10% band on either measure.
    int24 internal constant OUTSIDE_BAND = 2000;

    /// @dev 1.0001^500 = 1.0513: 5% of price, inside the band.
    int24 internal constant INSIDE_BAND = 500;

    /// @dev 1.0001^1400 = 1.1503. 15% of PRICE — outside a 10% band; but 7.2% of SQRT price, which would
    ///      be inside one. The tick that tells the two measures apart.
    int24 internal constant OUTSIDE_ON_PRICE_INSIDE_ON_SQRT = 1400;

    MockV3DepthFactory internal factory;

    function setUp() public {
        factory = new MockV3DepthFactory();
    }

    function _validator(address weth) internal returns (UniswapVaultPriceValidator) {
        return new UniswapVaultPriceValidator(weth, address(factory), address(0), DEVIATION_BPS, 1800);
    }

    /// @dev The reference the validator will scan to: deep, and reporting `meanTick` over the window.
    function _reference(int24 meanTick) internal {
        factory.set(3000, address(new MockV3DepthPool(DEEP, meanTick)));
    }

    /// @dev The full range both shipping vaults open (`TickMath.minUsableTick/maxUsableTick`), asked at
    ///      `spotTick` in the caller's own ordering — a V4 native-ETH pool, so ETH is currency0.
    function _fullRangeAt(UniswapVaultPriceValidator validator, address token, int24 spotTick)
        internal
        view
        returns (uint256)
    {
        return validator.calculateSwapProportionFromSqrtPrice(
            token,
            TickMath.minUsableTick(SPACING),
            TickMath.maxUsableTick(SPACING),
            TickMath.getSqrtPriceAtTick(spotTick),
            true
        );
    }

    /// @dev The band guard's other branch. `_requireSpotWithinTwapBand` rejects the high tail — a sqrt
    ///      gap wider than the reference itself, which is a price more than 4x it — before computing
    ///      `sqrtDiff * (spot + ref) / ref`, and the comment beside that line claims the rejection is
    ///      also what keeps the next line inside a uint256.
    ///
    ///      Nothing held that claim. Every other case in this file sits in the band's ordinary
    ///      neighbourhood, where the exact comparison below reaches the same verdict unaided and the
    ///      early reject is pure redundancy — deleting it leaves all eight of them green.
    ///
    ///      It stops being redundant where the reference is small and the spot is large, and the
    ///      INVERTED ordering is what makes a small reference reachable: a TWAP pool that orders WETH
    ///      second is carried across as `2**192 / twapSqrt`, so a high reference tick becomes a tiny
    ///      `refSqrt`. Against a spot high in the range, `sqrtDiff * (spot + ref)` then exceeds what a
    ///      full-width mulDiv can divide back down, and the call reverts with NO DATA.
    ///
    ///      That is the difference this case holds: with the early reject, a pushed pool is refused by
    ///      name; without it, the same call dies in arithmetic, and a caller reading the revert can no
    ///      longer tell a pushed pool from a broken validator.
    function test_theHighTailIsRefusedByTheGuardAndNotByArithmetic() public {
        UniswapVaultPriceValidator validator = _validator(WETH);
        _reference(582_000);

        vm.expectRevert(UniswapVaultPriceValidator.SpotTwapPriceDeviationTooHigh.selector);
        _fullRangeAt(validator, TOKEN_BELOW_WETH, 819_000);
    }

    /// THE FINDING. A spot price 22% off the TWAP, on the position shape the vaults actually open. Before
    /// the fix this returned 5e17 and every guard in the contract stayed silent.
    function test_aPushedSpotIsRefusedOnTheFullRange() public {
        UniswapVaultPriceValidator validator = _validator(WETH);
        _reference(0);

        vm.expectRevert(UniswapVaultPriceValidator.SpotTwapPriceDeviationTooHigh.selector);
        _fullRangeAt(validator, TOKEN_ABOVE_WETH, OUTSIDE_BAND);
    }

    /// Symmetric: a spot pushed the other way is refused too. A band expressed on sqrt deltas would be
    /// asymmetric about the reference.
    function test_aPushedSpotIsRefusedBelowTheTwapToo() public {
        UniswapVaultPriceValidator validator = _validator(WETH);
        _reference(0);

        vm.expectRevert(UniswapVaultPriceValidator.SpotTwapPriceDeviationTooHigh.selector);
        _fullRangeAt(validator, TOKEN_ABOVE_WETH, -OUTSIDE_BAND);
    }

    /// The band is measured on PRICE, the scale `maxPriceDeviationBps` carries at every other reader in
    /// this tree. This tick is 15% of price and 7.2% of sqrt price: an implementation that compared sqrt
    /// deltas against the same number would admit it, and would be admitting a band twice its label.
    function test_theBandIsSpentOnPriceNotOnSqrtPrice() public {
        UniswapVaultPriceValidator validator = _validator(WETH);
        _reference(0);

        vm.expectRevert(UniswapVaultPriceValidator.SpotTwapPriceDeviationTooHigh.selector);
        _fullRangeAt(validator, TOKEN_ABOVE_WETH, OUTSIDE_ON_PRICE_INSIDE_ON_SQRT);
    }

    /// An honest spot inside the band still prices, and still prices at the full-range 50:50. The guard
    /// is a band, not a pin — a vault that reverted on every ordinary tick would be worse than inert.
    function test_anHonestSpotInsideTheBandStillPrices() public {
        UniswapVaultPriceValidator validator = _validator(WETH);
        _reference(0);

        assertApproxEqAbs(
            _fullRangeAt(validator, TOKEN_ABOVE_WETH, INSIDE_BAND), 5e17, 1, "full range is 50:50 at every price"
        );
    }

    /// The numeraire is carried across, the way the proportion path already carries the range. The V3 pool
    /// here orders WETH second, so its tick is the caller's negated: a TWAP at -2000 and a spot at +2000
    /// are the SAME price and must pass. Comparing the two prices as-is would read a 4000-tick gap (49% of
    /// price) and revert.
    function test_anInvertedReferenceIsMappedBeforeItIsCompared() public {
        UniswapVaultPriceValidator validator = _validator(WETH);
        _reference(-OUTSIDE_BAND);

        // 1 wei of round-down off 5e17 is the full-range proportion maths, not the guard: see
        // `PriceValidatorFullRangeInertGuards`, which measures that residue across the whole band.
        assertApproxEqAbs(
            _fullRangeAt(validator, TOKEN_BELOW_WETH, OUTSIDE_BAND),
            5e17,
            1,
            "a reference read in the other ordering is the same price, not a 49% deviation"
        );
    }

    /// And the mapping does not disable the guard: a genuinely pushed spot against an inverted reference
    /// is still refused.
    function test_anInvertedReferenceStillCatchesAPushedSpot() public {
        UniswapVaultPriceValidator validator = _validator(WETH);
        _reference(-OUTSIDE_BAND);

        vm.expectRevert(UniswapVaultPriceValidator.SpotTwapPriceDeviationTooHigh.selector);
        _fullRangeAt(validator, TOKEN_BELOW_WETH, -OUTSIDE_BAND);
    }

    /// No reference pool, no cross-check: a token with no deep V3 pair is the shipping shape for a fresh
    /// launch, and it must still price rather than revert. The clamp remains its only backstop, which is
    /// what the finding says and what the fix leaves alone.
    function test_withNoReferencePoolThePathIsUnchanged() public {
        UniswapVaultPriceValidator validator = _validator(WETH);

        assertApproxEqAbs(
            _fullRangeAt(validator, TOKEN_ABOVE_WETH, OUTSIDE_BAND), 5e17, 1, "no reference, no price guard"
        );
    }

    /// A zero band admits no deviation at all and would revert every conversion against a live pool; a
    /// band above 100% is wider than the guard's own early reject can express. Both are refused at deploy,
    /// where a misconfiguration is cheap to see, rather than at the first conversion.
    function test_aDegenerateBandIsRefusedAtDeploy() public {
        vm.expectRevert(UniswapVaultPriceValidator.PriceValidatorMisconfigured.selector);
        new UniswapVaultPriceValidator(WETH, address(factory), address(0), 0, 1800);

        vm.expectRevert(UniswapVaultPriceValidator.PriceValidatorMisconfigured.selector);
        new UniswapVaultPriceValidator(WETH, address(factory), address(0), 10_001, 1800);
    }
}
