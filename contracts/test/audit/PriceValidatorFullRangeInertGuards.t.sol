// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";

/// @notice Audit PoC (cluster item D): at the FULL-RANGE ticks every shipping vault uses
///         (`UniAlignmentVault.convertAndAddLiquidity` -> `TickMath.minUsableTick/maxUsableTick`),
///         `calculateSwapProportion` returns exactly 5e17 at ANY spot price. Therefore:
///           - the spot-vs-TWAP deviation guard (`diff > 5e16 -> revert`) can never fire,
///           - the `[35e16, 65e16]` clamp can never bind,
///           - and the whole `_getTwapSqrtPriceX96` scan, `MIN_REFERENCE_LIQUIDITY` included,
///             changes no output.
///
///         Two consequences, and they point opposite ways — which is why this is filed as a
///         no-op rather than a vulnerability:
///           (a) there is no manipulation-driven MIS-SIZING to exploit: the sizing is price-
///               independent by construction, so moving spot buys an attacker nothing here;
///           (b) the guards are, today, dead weight on the shipping path, and the vault's real
///               anti-manipulation floor is elsewhere (`_floorTokenOut` ->
///               `quoteEthForTokensVia`, the owner-pinned reference-pool TWAP).
///
///         `src/peripherals/UniswapVaultPriceValidator.sol:353-358` already states the theorem in
///         so many words ("For a FULL-RANGE position this reduces to exactly 5e17 at every price").
///         This test proves it holds in the deployed code, across the full representable price range.
contract PriceValidatorFullRangeInertGuardsTest is Test {
    UniswapVaultPriceValidator internal validator;
    address internal token = address(uint160(uint256(keccak256("alignmentToken"))));

    int24 internal constant SPACING = 60;

    function setUp() public {
        // A v3Factory WITH code that names no pool: the TWAP scan runs in full (no
        // `PriceValidatorMisconfigured`) and legitimately finds nothing, which is the shipping
        // shape for a token with no deep V3 pair.
        EmptyV3Factory factory = new EmptyV3Factory();
        validator = new UniswapVaultPriceValidator(
            address(uint160(0xEEEE)), // weth
            address(factory),
            address(uint160(0xDDDD)), // poolManager (unused on this entry point)
            500,
            1800
        );
    }

    /// @dev The measurement that decides the finding. Over the band any real ETH/token pool can be
    ///      pushed into (|tick| <= 200000 is a price ratio of ~5e8 in either direction), the
    ///      full-range proportion never moves off 50% by more than dust:
    ///        - the spot-vs-TWAP deviation guard fires at diff > 5e16 and can never be approached,
    ///        - the [35e16, 65e16] clamp never binds,
    ///        - so `_getTwapSqrtPriceX96`, `MIN_REFERENCE_LIQUIDITY` and the whole TWAP scan change
    ///          no output on the shipping path.
    function test_fullRange_guardsAreInertAcrossTheRealisticBand() public {
        int24 lower = TickMath.minUsableTick(SPACING);
        int24 upper = TickMath.maxUsableTick(SPACING);

        uint256 worst;
        int24 worstTick;
        for (int24 t = -200000; t <= 200000; t += 1000) {
            uint160 sqrtP = TickMath.getSqrtPriceAtTick(t);
            uint256 p = validator.calculateSwapProportionFromSqrtPrice(token, lower, upper, sqrtP, true);
            assertGt(p, 35e16, "clamp floor must not bind in the realistic band");
            assertLt(p, 65e16, "clamp ceiling must not bind in the realistic band");
            uint256 d = p > 5e17 ? p - 5e17 : 5e17 - p;
            if (d > worst) {
                worst = d;
                worstTick = t;
            }
        }

        emit log_named_int("worst tick in |tick| <= 200000       ", worstTick);
        emit log_named_decimal_uint("worst |proportion - 50%| there       ", worst, 18);
        emit log_named_decimal_uint("deviation-guard threshold (diff)     ", 5e16, 18);

        // spot and TWAP proportions each sit within `worst` of 50%, so their difference is <= 2*worst.
        assertLt(2 * worst, 5e16 / 1e6, "deviation guard is unreachable by six orders of magnitude");
    }

    /// @dev But the filing's stronger phrasing — inert "at any manipulation magnitude" — does not
    ///      hold. At the tails of the representable tick range the truncation in
    ///      `LiquidityAmounts.getAmountsForLiquidity` pulls the proportion far enough off 50% that
    ///      the clamp actually binds. Those prices are ~1e35:1 and unreachable for a live pool, but
    ///      the guards are not literally dead code.
    function test_fullRange_clampDoesBindAtTheTailOfTheTickRange() public {
        int24 lower = TickMath.minUsableTick(SPACING);
        int24 upper = TickMath.maxUsableTick(SPACING);

        uint256 tail = validator.calculateSwapProportionFromSqrtPrice(
            token, lower, upper, TickMath.getSqrtPriceAtTick(-880000), true
        );
        emit log_named_decimal_uint("full-range proportion at tick -880000", tail, 18);
        assertEq(tail, 35e16, "the 35% clamp floor DOES bind at the low tail");
    }

    /// @dev Control: on a BOUNDED range the same code does move, and the clamp DOES bind — so the
    ///      guards are not dead code in general, only on the shape the vaults actually use.
    function test_boundedRange_proportionMoves_andTheClampBinds() public view {
        int24 lower = -6000;
        int24 upper = 6000;

        uint256 low = validator.calculateSwapProportionFromSqrtPrice(
            token, lower, upper, TickMath.getSqrtPriceAtTick(-5940), true
        );
        uint256 mid =
            validator.calculateSwapProportionFromSqrtPrice(token, lower, upper, TickMath.getSqrtPriceAtTick(0), true);
        uint256 high = validator.calculateSwapProportionFromSqrtPrice(
            token, lower, upper, TickMath.getSqrtPriceAtTick(5940), true
        );

        assertEq(low, 35e16, "bounded range near the lower tick is clamped up to the 35% floor");
        assertEq(mid, 5e17, "bounded range at mid price is 50%");
        assertEq(high, 65e16, "bounded range near the upper tick is clamped down to the 65% ceiling");
    }
}

contract EmptyV3Factory {
    function getPool(address, address, uint24) external pure returns (address) {
        return address(0);
    }
}
