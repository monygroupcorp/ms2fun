// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { FullMath } from "v4-core/libraries/FullMath.sol";

/// @notice Minimal Uniswap V3 pool exposing only `observe`, returning `[0, delta]` so the validator's
///         pinned-pool path derives `meanTick = delta / window`.
contract MockV3Observe {
    int56 public cumulativeDelta;

    function setDelta(int56 d) external {
        cumulativeDelta = d;
    }

    function observe(uint32[] calldata)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = cumulativeDelta;
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
    }
}

/// @notice The pre-noesis-063 lossy `(sqrtPriceX96 >> 48)**2` price derivation, kept ONLY to prove the
///         validator's new canonical FullMath path (F2) both survives inputs that overflow-reverted here
///         and never rounds below the truncated value.
contract LegacyShiftPrice {
    function rawPrice(uint160 sqrtPriceX96) external pure returns (uint256) {
        uint256 sqrtScaled = uint256(sqrtPriceX96) >> 48;
        return (sqrtScaled * sqrtScaled * 1e18) >> 96;
    }
}

/// @title UniValidatorPricePrecisionTest
/// @notice Pins finding F2 (noesis-063): the pinned-pool oracle floor (`quoteEthForTokensVia`) must use
///         the canonical 512-bit FullMath price derivation, NOT the lossy/overflow-prone `>>48`-then-square
///         shift. The floor feeds `minOut` for all three vault families, so a wrong or reverting quote
///         directly bricks vault ETH protection.
contract UniValidatorPricePrecisionTest is Test {
    UniswapVaultPriceValidator internal validator;
    LegacyShiftPrice internal legacy;

    // WETH mid-range so TOKEN_LOW makes `weth < token` false (token0IsWeth == false → ethPerToken == rawPrice,
    // the un-inverted token1/token0 price — the simplest orientation to assert against a reference).
    address internal constant WETH = address(0x8000000000000000000000000000000000000000);
    address internal constant TOKEN_LOW = address(0x0000000000000000000000000000000000000001);

    uint32 internal constant TWAP = 1800;

    function setUp() public {
        validator = new UniswapVaultPriceValidator(WETH, address(0), address(0), address(0), 1000, TWAP);
        legacy = new LegacyShiftPrice();
    }

    function _poolAtMeanTick(int24 meanTick) internal returns (MockV3Observe pool) {
        pool = new MockV3Observe();
        pool.setDelta(int56(meanTick) * int56(uint56(TWAP)));
    }

    /// @dev At a moderate tick both derivations are in range; the validator's quote must equal the exact
    ///      FullMath reference (proving it uses FullMath, not the shift) and must never be BELOW the
    ///      truncating legacy value (the shift can only underestimate).
    function test_moderateTick_matchesFullMathReference_andBeatsLegacy() public {
        int24 meanTick = 50_000;
        MockV3Observe pool = _poolAtMeanTick(meanTick);
        uint160 sp = TickMath.getSqrtPriceAtTick(meanTick);

        // token0IsWeth == false ⇒ ethPerToken == rawPrice == sqrtPriceX96^2 * 1e18 / 2^192 (low branch: sp < 2^128).
        uint256 expected = FullMath.mulDiv(uint256(sp) * uint256(sp), 1e18, 1 << 192);

        uint256 quote = validator.quoteEthForTokensVia(address(pool), 0, TWAP, TOKEN_LOW, 1e18);
        assertEq(quote, expected, "quote must equal the canonical FullMath price");

        uint256 lossy = legacy.rawPrice(sp);
        assertGe(quote, lossy, "FullMath must not round below the truncating >>48 shift");
    }

    /// @dev The headline F2 defect: at a high tick the legacy `>>48`-then-square overflow-reverts (bricking
    ///      the floor for that token), while the FullMath path returns a positive quote at the same price.
    function test_highTick_legacyOverflows_fullMathSurvives() public {
        int24 meanTick = 800_000; // < MAX_TICK (887272); sqrtPriceX96 here is far above 2^146
        MockV3Observe pool = _poolAtMeanTick(meanTick);
        uint160 sp = TickMath.getSqrtPriceAtTick(meanTick);

        bool legacyOverflowed;
        try legacy.rawPrice(sp) returns (uint256) {
            legacyOverflowed = false;
        } catch {
            legacyOverflowed = true;
        }
        assertTrue(legacyOverflowed, "legacy >>48 path must overflow-revert at this tick");

        uint256 quote = validator.quoteEthForTokensVia(address(pool), 0, TWAP, TOKEN_LOW, 1e18);
        assertGt(quote, 0, "FullMath path must return a usable quote where legacy bricked");
    }

    /// @dev The FullMath split must stay overflow-safe across the ENTIRE valid tick range, right up to the
    ///      extremes, so no reachable TWAP price can revert the floor.
    function test_extremeTicks_neverOverflow() public {
        int24[4] memory ticks =
            [int24(TickMath.MIN_TICK + 1), int24(-400_000), int24(400_000), int24(TickMath.MAX_TICK - 1)];
        for (uint256 i = 0; i < ticks.length; i++) {
            MockV3Observe pool = _poolAtMeanTick(ticks[i]);
            // Must not revert with overflow; may legitimately revert ReferenceTwapUnavailable when the price
            // rounds to zero (fail-closed, not fail-open) — that is caught and asserted as acceptable.
            try validator.quoteEthForTokensVia(address(pool), 0, TWAP, TOKEN_LOW, 1e18) returns (
                uint256
            ) {
            // ok: a finite quote
            }
            catch (bytes memory reason) {
                bytes4 sel = bytes4(reason);
                assertEq(
                    sel,
                    UniswapVaultPriceValidator.ReferenceTwapUnavailable.selector,
                    "only a zero-price fail-closed is allowed; never an arithmetic overflow"
                );
            }
        }
    }
}
