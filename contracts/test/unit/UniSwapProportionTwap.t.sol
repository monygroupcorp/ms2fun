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
///         Deliberately NOT pinned: which pool the scan picks when several are usable (`noesis-293`), and
///         the numeraire the V4 entry point assumes for the TWAP (`noesis-294`). Asserting today's
///         behaviour on either would encode a defect and go red on its fix.
contract UniSwapProportionTwapTest is Test {
    address constant WETH = address(0x1111);
    address constant TOKEN = address(0xBEEF);
    int24 constant SPACING = 60;

    // A symmetric bounded range: at its geometric midpoint (tick 0) the position is 50% by value, so the
    // proportion is comparable to the full-range case and the clamp is not what is being measured.
    int24 constant BOUNDED_LOWER = -6000;
    int24 constant BOUNDED_UPPER = 6000;

    MockV3TwapFactory factory;
    UniswapVaultPriceValidator validator;

    function setUp() public {
        factory = new MockV3TwapFactory();
        validator = new UniswapVaultPriceValidator(WETH, address(0), address(factory), address(0), 1000, 1800);
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
}
