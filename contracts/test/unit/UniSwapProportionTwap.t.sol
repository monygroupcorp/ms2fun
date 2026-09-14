// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";

/// @notice Minimal Uniswap V3 pool for the TWAP scan: a settable `liquidity()` and a settable mean tick
///         served as the tick-cumulative delta `observe` returns over the requested window. `revertObserve`
///         models a pool with insufficient observation history (the real pool reverts `OLD`).
contract MockV3TwapPool {
    uint128 public liq;
    int24 public meanTick;
    bool public revertObserve;

    constructor(uint128 _liq, int24 _meanTick, bool _revertObserve) {
        liq = _liq;
        meanTick = _meanTick;
        revertObserve = _revertObserve;
    }

    function liquidity() external view returns (uint128) {
        return liq;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(!revertObserve, "OLD");
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = int56(meanTick) * int56(uint56(secondsAgos[0]));
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
    }
}

/// @notice Minimal V3 factory keyed by fee tier. Token ordering is irrelevant to what the validator reads,
///         so the pair arguments are ignored.
contract MockV3TwapFactory {
    mapping(uint24 => address) public pools;

    function set(uint24 fee, address pool) external {
        pools[fee] = pool;
    }

    function getPool(address, address, uint24 fee) external view returns (address) {
        return pools[fee];
    }
}

/// @title UniSwapProportionTwapTest
/// @notice noesis-295 — the first unit coverage of `UniswapVaultPriceValidator._getTwapSqrtPriceX96`, the
///         reference the swap-proportion deviation guard cross-checks the manipulable spot price against.
///         `UniPriceValidatorHarness` deliberately tests the proportion math WITHOUT a TWAP pool, and
///         `UniValidatorPinnedTwap.t.sol` covers the pinned `quoteEthForTokensVia` reader, which is a
///         different code path. The scan itself was unexercised.
///
///         What is pinned here: (1) a FULL-RANGE position is 50% by value at every price and therefore
///         cannot trip the deviation guard however far the TWAP disagrees — the property both shipped
///         vaults rely on (`UniAlignmentVault:373-374`, `CypherAlignmentVault:85-86`); (2) a zero-liquidity
///         pool is skipped and the scan continues; (3) a pool whose `observe` reverts is skipped and the
///         scan continues; (4) with no pool at any tier the deviation check does not run and the absolute
///         [35%, 65%] clamp still applies.
///
///         noesis-294 is pinned here now that it is fixed: the TWAP leg is computed in the coordinates of
///         the V3 pool the TWAP was read out of, not the caller's. See the three tests at the foot of this
///         file, which use a token sorting BELOW WETH — the only case where the two orderings differ.
///
///         Deliberately NOT pinned: which pool the scan picks when several are usable (`noesis-293`).
contract UniSwapProportionTwapTest is Test {
    address constant WETH = address(0x1111);
    address constant TOKEN = address(0xBEEF);
    /// @dev Sorts BELOW WETH, so the V3 `weth`/`token` pool orders WETH SECOND and its price is the
    ///      inverse of the V4 native-ETH pool's. Every other address in this file sorts above WETH, where
    ///      the two orderings agree and noesis-294 is invisible.
    address constant TOKEN_BELOW_WETH = address(0x0011);
    int24 constant SPACING = 60;

    // A symmetric bounded range: at its geometric midpoint (tick 0) the position is 50% by value, so the
    // proportion is comparable to the full-range case and the clamp is not what is being measured.
    int24 constant BOUNDED_LOWER = -6000;
    int24 constant BOUNDED_UPPER = 6000;

    MockV3TwapFactory factory;
    UniswapVaultPriceValidator validator;

    function setUp() public {
        factory = new MockV3TwapFactory();
        validator = new UniswapVaultPriceValidator(WETH, address(factory), address(0), 1000, 1800);
    }

    // ── (1) Full range is inert to the TWAP ────────────────────────────────────────────────────────

    /// @notice A full-range position is 50% by value at EVERY price, so the spot and TWAP proportions are
    ///         equal by construction and their difference can never exceed the 5% deviation band. This is
    ///         why the guard is a no-op for both shipped vaults, and it is not recorded anywhere else.
    function test_fullRange_isFiftyPercent_evenWhenTheTwapDisagreesWildly() public {
        factory.set(3000, address(new MockV3TwapPool(1e24, int24(600000), false)));

        uint256 proportion = validator.calculateSwapProportionFromSqrtPrice(
            TOKEN,
            TickMath.minUsableTick(SPACING),
            TickMath.maxUsableTick(SPACING),
            TickMath.getSqrtPriceAtTick(0),
            true
        );

        assertApproxEqAbs(proportion, 5e17, 16, "full range is 50% by value at every price");
    }

    // ── (2) A zero-liquidity pool is skipped ──────────────────────────────────────────────────────

    /// @notice An existing but empty pool must not be accepted as the reference; the scan continues to the
    ///         next fee tier. Pinned via the observable consequence: the empty pool carries a TWAP far
    ///         enough from spot to trip the guard, and the call still succeeds.
    function test_zeroLiquidityPoolIsSkipped_scanContinues() public {
        factory.set(3000, address(new MockV3TwapPool(0, int24(5000), false)));
        factory.set(500, address(new MockV3TwapPool(1e24, int24(0), false)));

        uint256 proportion = validator.calculateSwapProportionFromSqrtPrice(
            TOKEN, BOUNDED_LOWER, BOUNDED_UPPER, TickMath.getSqrtPriceAtTick(0), true
        );

        assertApproxEqAbs(proportion, 5e17, 1e15, "the empty pool must not have supplied the reference");
    }

    // ── (3) A pool with insufficient history is skipped ───────────────────────────────────────────

    /// @notice `observe` reverting (the real pool's `OLD` on insufficient observation history) must be
    ///         caught and the scan continued, not propagated. Same observable consequence as above.
    function test_revertingObservePoolIsSkipped_scanContinues() public {
        factory.set(3000, address(new MockV3TwapPool(1e24, int24(5000), true)));
        factory.set(500, address(new MockV3TwapPool(1e24, int24(0), false)));

        uint256 proportion = validator.calculateSwapProportionFromSqrtPrice(
            TOKEN, BOUNDED_LOWER, BOUNDED_UPPER, TickMath.getSqrtPriceAtTick(0), true
        );

        assertApproxEqAbs(proportion, 5e17, 1e15, "a reverting observe must be caught, not propagated");
    }

    // ── (4) No TWAP at all: the deviation check does not run, the clamp still does ─────────────────

    /// @notice With no V3 pool at any tier there is no TWAP, so the deviation check is skipped — but the
    ///         absolute [35%, 65%] clamp is a SEPARATE backstop and must still apply. Pinned at a price
    ///         near the top of the range, where the unclamped proportion is far above 65%.
    function test_noTwapPool_deviationCheckSkipped_clampStillApplies() public view {
        uint256 proportion = validator.calculateSwapProportionFromSqrtPrice(
            TOKEN, BOUNDED_LOWER, BOUNDED_UPPER, TickMath.getSqrtPriceAtTick(5900), true
        );

        assertEq(proportion, 65e16, "the absolute clamp must apply with no TWAP present");
    }

    // ── (5) noesis-294 — the TWAP leg is read in the TWAP pool's coordinates ──────────────────────

    /// @notice An HONEST market must not trip the deviation guard. A V4 alignment pool is native-ETH
    ///         paired, so its price is tokens-per-ETH and the caller's flag is unconditionally `true`; the
    ///         V3 pool the TWAP comes from holds the same pair as `token`/`WETH` when the token sorts
    ///         below WETH, so the same real price is quoted upside down — tick `t` there is tick `-t`
    ///         here. Agreeing to the last wei, the two used to read 44 points apart and revert
    ///         `SwapProportionDeviationTooHigh` against a pool nobody had touched.
    function test_twapOnTheInverseOrdering_honestMarketDoesNotTripTheGuard() public {
        // The same price as the spot below, quoted the way a `token`/WETH V3 pool quotes it.
        factory.set(3000, address(new MockV3TwapPool(1e24, int24(-3000), false)));

        uint256 proportion = validator.calculateSwapProportionFromSqrtPrice(
            TOKEN_BELOW_WETH, BOUNDED_LOWER, BOUNDED_UPPER, TickMath.getSqrtPriceAtTick(3000), true
        );

        // Spot and TWAP now agree exactly, so the deviation guard passes and the absolute clamp is all
        // that acts: the raw proportion at tick 3000 on this range is ~72%, above the 65% ceiling.
        assertEq(proportion, 65e16, "an honest inverse-ordered TWAP must pass the deviation guard");
    }

    /// @notice The ordering is not just a flag — it is a flag AND a range. On a range symmetric about tick
    ///         0 the mapped and un-mapped intervals coincide and carrying only the flag looks correct; on
    ///         an asymmetric one it is not. Here the honest price sits a factor of two BELOW a [1, 4]
    ///         range, so the position is entirely ETH and both legs owe 0. Reading the inverted price
    ///         against the un-mapped range instead places it mid-range at ~50%, half the band away from a
    ///         spot of 0, and reverts.
    function test_twapOnTheInverseOrdering_asymmetricRangeIsMappedNotJustFlipped() public {
        // Tick 13863 is a price of ~4; tick 6932 is ~2, the inverse quote of the ~0.5 spot below.
        factory.set(3000, address(new MockV3TwapPool(1e24, int24(6932), false)));

        uint256 proportion = validator.calculateSwapProportionFromSqrtPrice(
            TOKEN_BELOW_WETH, int24(0), int24(13863), TickMath.getSqrtPriceAtTick(-6932), true
        );

        // Below its range the position wants no token at all; the clamp floor is what is returned.
        assertEq(proportion, 35e16, "the range must be carried into the TWAP pool's tick space");
    }

    /// @notice Non-vacuity: reading the TWAP in its own coordinates must not disarm the guard. Same
    ///         inverse-ordered pool, but its TWAP is a genuine factor away from the spot — the deviation
    ///         the guard exists for — and the call must still revert.
    function test_twapOnTheInverseOrdering_realDeviationStillReverts() public {
        // An honest quote of the spot would be tick -3000; this pool says the price has not moved at all.
        factory.set(3000, address(new MockV3TwapPool(1e24, int24(0), false)));

        vm.expectRevert(UniswapVaultPriceValidator.SwapProportionDeviationTooHigh.selector);
        validator.calculateSwapProportionFromSqrtPrice(
            TOKEN_BELOW_WETH, BOUNDED_LOWER, BOUNDED_UPPER, TickMath.getSqrtPriceAtTick(3000), true
        );
    }
}
