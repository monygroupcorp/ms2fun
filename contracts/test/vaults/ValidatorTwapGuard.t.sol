// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";

/// @notice Minimal Uniswap V3 pool for the depth-gate tests: a settable `liquidity()` and a settable mean
///         tick served as the tick-cumulative delta `observe` returns over the requested window.
contract MockV3DepthPool {
    uint128 public liq;
    int24 public meanTick;

    constructor(uint128 _liq, int24 _meanTick) {
        liq = _liq;
        meanTick = _meanTick;
    }

    function liquidity() external view returns (uint128) {
        return liq;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = int56(meanTick) * int56(uint56(secondsAgos[0]));
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
    }
}

/// @notice Minimal V3 factory keyed by fee tier; token ordering is irrelevant to what the validator reads.
contract MockV3DepthFactory {
    mapping(uint24 => address) public pools;

    function set(uint24 fee, address pool) external {
        pools[fee] = pool;
    }

    function getPool(address, address, uint24 fee) external view returns (address) {
        return pools[fee];
    }
}

/// @title ValidatorTwapGuardTest
/// @notice noesis-398 — the TWAP deviation reference in `UniswapVaultPriceValidator._getTwapSqrtPriceX96`
///         must be depth-gated: a pool below the minimum reference liquidity can never be selected as the
///         reference the manipulable spot price is cross-checked against, so a dust / single-wei pool with
///         attacker-controlled `observe` cumulatives cannot drive the guard.
///
///         Selection is observed through the deviation guard itself: the reference pool carries a mean tick
///         far from the spot price, so IF it is selected the spot-vs-TWAP proportion difference exceeds the
///         5% band and the call reverts `SwapProportionDeviationTooHigh`. A reference that is skipped leaves
///         `twapValid` false, the deviation branch does not run, and the call returns the clamped spot
///         proportion. A bounded, symmetric range at spot tick 0 sits at 50% by value — inside the
///         [35%,65%] clamp — so the clamp does not mask whether the deviation guard ran.
contract ValidatorTwapGuardTest is Test {
    address constant WETH = address(0x1111);
    address constant TOKEN = address(0xBEEF);

    // Symmetric bounded range: at tick 0 the position is 50% by value, so the spot proportion is 5e17,
    // inside the clamp band. A reference mean tick near the range edge yields a proportion far from 5e17.
    int24 constant BOUNDED_LOWER = -6000;
    int24 constant BOUNDED_UPPER = 6000;
    int24 constant FAR_REFERENCE_TICK = 5900; // near the upper edge => reference proportion far above 50%

    // The deep-pool fixtures used across the validator's existing suites; well above the depth floor.
    uint128 constant DEEP_LIQUIDITY = 1e24;
    // Mirrors the contract's private `MIN_REFERENCE_LIQUIDITY`; a change to it surfaces here as a
    // boundary-test failure rather than passing silently.
    uint128 constant FLOOR = 1e15;

    MockV3DepthFactory factory;
    UniswapVaultPriceValidator validator;

    function setUp() public {
        factory = new MockV3DepthFactory();
        validator = new UniswapVaultPriceValidator(WETH, address(factory), address(0), 1000, 1800);
    }

    function _swapProportionAtSpotZero() internal view returns (uint256) {
        return validator.calculateSwapProportionFromSqrtPrice(
            TOKEN, BOUNDED_LOWER, BOUNDED_UPPER, TickMath.getSqrtPriceAtTick(0), true
        );
    }

    // ── A single-wei reference pool is NOT selected ───────────────────────────────────────────────

    /// @notice A 1-wei-liquidity pool carries a mean tick that would trip the deviation guard if it were
    ///         chosen as the reference. Because it is below the depth floor it is skipped, no deviation
    ///         check runs, and the call returns the clamped spot proportion instead of reverting.
    function test_singleWeiPool_notSelectedAsReference() public {
        factory.set(3000, address(new MockV3DepthPool(1, FAR_REFERENCE_TICK)));

        uint256 proportion = _swapProportionAtSpotZero();
        assertApproxEqAbs(proportion, 5e17, 1e15, "a single-wei pool must not have supplied the reference");
    }

    // ── A deep reference pool IS selected ─────────────────────────────────────────────────────────

    /// @notice The identical far mean tick, in a pool that clears the depth floor, is selected as the
    ///         reference; the spot-vs-TWAP difference exceeds the 5% band and the call reverts. This is
    ///         the counterpart that proves the single-wei skip above is the depth gate, not an inert path.
    function test_deepPool_isSelectedAsReference() public {
        factory.set(3000, address(new MockV3DepthPool(DEEP_LIQUIDITY, FAR_REFERENCE_TICK)));

        vm.expectRevert(UniswapVaultPriceValidator.SwapProportionDeviationTooHigh.selector);
        _swapProportionAtSpotZero();
    }

    // ── A sub-floor pool is skipped and the scan continues to a deep pool ─────────────────────────

    /// @notice A sub-floor pool at the first fee tier must not short-circuit selection: the scan continues
    ///         and a deep pool at a later tier becomes the reference. Both carry the far tick, so selecting
    ///         either would revert — proving the deep pool at the second tier is the one chosen.
    function test_subFloorPoolSkipped_scanContinuesToDeepPool() public {
        factory.set(3000, address(new MockV3DepthPool(FLOOR - 1, FAR_REFERENCE_TICK)));
        factory.set(500, address(new MockV3DepthPool(DEEP_LIQUIDITY, FAR_REFERENCE_TICK)));

        vm.expectRevert(UniswapVaultPriceValidator.SwapProportionDeviationTooHigh.selector);
        _swapProportionAtSpotZero();
    }

    // ── Boundary: exactly at the floor qualifies; one wei below does not ───────────────────────────

    /// @notice A pool holding exactly the floor liquidity qualifies (the comparison is a strict "below the
    ///         floor is skipped"), so it is selected and the far tick trips the guard.
    function test_exactlyAtFloor_qualifies() public {
        factory.set(3000, address(new MockV3DepthPool(FLOOR, FAR_REFERENCE_TICK)));

        vm.expectRevert(UniswapVaultPriceValidator.SwapProportionDeviationTooHigh.selector);
        _swapProportionAtSpotZero();
    }

    /// @notice One wei below the floor is skipped; with no other pool the deviation check does not run and
    ///         the clamped spot proportion is returned.
    function test_oneBelowFloor_skipped() public {
        factory.set(3000, address(new MockV3DepthPool(FLOOR - 1, FAR_REFERENCE_TICK)));

        uint256 proportion = _swapProportionAtSpotZero();
        assertApproxEqAbs(proportion, 5e17, 1e15, "a below-floor pool must not have supplied the reference");
    }

    // ── The no-reference / clamp-only path is unchanged ───────────────────────────────────────────

    /// @notice With no eligible pool at any tier there is no TWAP reference, so the deviation check is
    ///         skipped and the absolute [35%,65%] clamp is the sole backstop — the escalated no-reference
    ///         design question is out of scope for this item and this pins that it is untouched. At a spot
    ///         near the top of the range the unclamped proportion is far above 65%, so the clamp fires.
    function test_noEligiblePool_clampOnlyPathUnchanged() public view {
        uint256 proportion = validator.calculateSwapProportionFromSqrtPrice(
            TOKEN, BOUNDED_LOWER, BOUNDED_UPPER, TickMath.getSqrtPriceAtTick(5900), true
        );
        assertEq(proportion, 65e16, "no reference => clamp is the sole backstop, unchanged by the depth gate");
    }
}
