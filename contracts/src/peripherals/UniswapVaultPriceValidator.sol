// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IVaultPriceValidator } from "../interfaces/IVaultPriceValidator.sol";
import { IAlgebraPool, IVolatilityOracle } from "../interfaces/algebra/IAlgebra.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolId } from "v4-core/types/PoolId.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { LiquidityAmounts } from "../libraries/v4/LiquidityAmounts.sol";
import { FullMath } from "v4-core/libraries/FullMath.sol";

// ========== External Protocol Interfaces ==========

/// @notice Uniswap V3 Factory interface
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

/// @notice Uniswap V3 Pool interface
interface IUniswapV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function liquidity() external view returns (uint128);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

contract UniswapVaultPriceValidator is IVaultPriceValidator {
    using StateLibrary for IPoolManager;

    error SwapProportionDeviationTooHigh();
    /// @notice The pinned canonical pool could not produce a usable TWAP. Thrown by
    ///         {quoteEthForTokensVia} INSTEAD OF returning 0 — this is the anti-fail-open guarantee.
    error ReferenceTwapUnavailable();
    /// @notice `kind` passed to {quoteEthForTokensVia} is not a supported pool family (only 0 and 1 are).
    error UnsupportedPoolKind(uint8 kind);

    address public immutable weth;
    address public immutable v2Factory;
    address public immutable v3Factory;
    address public immutable poolManager;
    uint256 public immutable maxPriceDeviationBps;
    /// @notice TWAP window used for V3 price queries. Defaults to 30 minutes.
    uint32 public immutable twapSecondsAgo;

    constructor(
        // slither-disable-next-line missing-zero-check
        address _weth,
        // slither-disable-next-line missing-zero-check
        address _v2Factory,
        // slither-disable-next-line missing-zero-check
        address _v3Factory,
        // slither-disable-next-line missing-zero-check
        address _poolManager,
        uint256 _maxPriceDeviationBps,
        uint32 _twapSecondsAgo
    ) {
        weth = _weth;
        v2Factory = _v2Factory;
        v3Factory = _v3Factory;
        poolManager = _poolManager;
        maxPriceDeviationBps = _maxPriceDeviationBps;
        twapSecondsAgo = _twapSecondsAgo == 0 ? 1800 : _twapSecondsAgo;
    }

    // --- IVaultPriceValidator ---

    /// @inheritdoc IVaultPriceValidator
    function quoteEthForTokensVia(address pool, uint8 kind, uint32 window, address token, uint256 amount)
        external
        view
        override
        returns (uint256)
    {
        // Invalid pool family is a caller/config error — reject before doing anything else.
        if (kind >= 2) revert UnsupportedPoolKind(kind);
        if (amount == 0) return 0;

        // window == 0 falls back to the validator's configured TWAP window (constructor-guaranteed non-zero).
        uint32 win = window == 0 ? twapSecondsAgo : window;

        int56 tickCumulativeDelta = _pinnedTwapTickDelta(pool, kind, win);

        // Token ordering is canonical (token0 = lower address) for both Uniswap V3 and Algebra factories,
        // so WETH is token0 iff `weth < token` — no token0() call needed (Algebra's minimal interface omits it).
        (bool ok, uint256 ethPerToken) = _ethPerTokenFromTwapDelta(tickCumulativeDelta, win, weth < token);

        // NO fail-open: a zero / unusable price means the pinned pool cannot serve as a reference.
        if (!ok) revert ReferenceTwapUnavailable();

        return (amount * ethPerToken) / 1e18;
    }

    /// @dev Reads the tick-cumulative delta over `window` from the pinned `pool`. `kind == 0` uses the
    ///      Uniswap V3 `observe`; `kind == 1` uses the Algebra volatility-oracle plugin's `getTimepoints`.
    ///      ANY failure to obtain the delta (pool has no code, insufficient observation history, missing
    ///      or reverting plugin) reverts `ReferenceTwapUnavailable` — never a silent 0. Callers must have
    ///      already rejected `kind >= 2`.
    function _pinnedTwapTickDelta(address pool, uint8 kind, uint32 window) private view returns (int56) {
        // A no-code target's high-level call reverts via the compiler's extcodesize pre-check, which
        // try/catch does NOT trap (it reverts with empty data). Guard it explicitly so an absent pool
        // is the named ReferenceTwapUnavailable, never a bare revert and never a fail-open.
        if (pool.code.length == 0) revert ReferenceTwapUnavailable();

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;

        if (kind == 0) {
            try IUniswapV3Pool(pool).observe(secondsAgos) returns (int56[] memory tickCumulatives, uint160[] memory) {
                return tickCumulatives[1] - tickCumulatives[0];
            } catch {
                revert ReferenceTwapUnavailable();
            }
        }

        // kind == 1 (Algebra): the TWAP oracle lives on the pool's plugin (hook), not the pool itself.
        try IAlgebraPool(pool).plugin() returns (address oracle) {
            if (oracle == address(0)) revert ReferenceTwapUnavailable();
            try IVolatilityOracle(oracle).getTimepoints(secondsAgos) returns (
                int56[] memory tickCumulatives, uint88[] memory
            ) {
                return tickCumulatives[1] - tickCumulatives[0];
            } catch {
                revert ReferenceTwapUnavailable();
            }
        } catch {
            revert ReferenceTwapUnavailable();
        }
    }

    /// @dev Converts a tick-cumulative delta over `window` seconds into a WETH-per-`token` price
    ///      (1e18-scaled): mean tick → sqrtPriceX96 → 1e18-scaled ETH-per-token price via the canonical
    ///      512-bit FullMath derivation ({_priceFromSqrtPriceX96}). Returns ok=false when the price rounds
    ///      to zero, so the pinned-pool caller reverts rather than fail-open with a zero quote.
    function _ethPerTokenFromTwapDelta(int56 tickCumulativeDelta, uint32 window, bool token0IsWeth)
        private
        pure
        returns (bool ok, uint256 ethPerToken)
    {
        int24 meanTick = _meanTickFromCumulativeDelta(tickCumulativeDelta, window);
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(meanTick);
        return _priceFromSqrtPriceX96(sqrtPriceX96, token0IsWeth);
    }

    /// @dev Standard Uniswap V3 TWAP mean tick: integer-divide the tick-cumulative delta by the window,
    ///      rounding toward negative infinity (decrement when the delta is negative and the division is
    ///      inexact). Single implementation shared by the pinned-pool ({_ethPerTokenFromTwapDelta}) and
    ///      V3-TWAP ({_getTwapSqrtPriceX96}) readers so the rounding cannot drift between them.
    function _meanTickFromCumulativeDelta(int56 delta, uint32 window) private pure returns (int24 meanTick) {
        meanTick = int24(delta / int56(uint56(window)));
        if (delta < 0 && (delta % int56(uint56(window)) != 0)) meanTick--;
    }

    /// @dev Derives a 1e18-scaled ETH-per-token price from a Q64.96 sqrt price using the canonical 512-bit
    ///      FullMath split — the same overflow-safe path as {_tokenValueInEth}. This REPLACES the former
    ///      `(sqrtPriceX96 >> 48)**2` derivation, which discarded up to 48 low bits before squaring (material
    ///      precision loss) and overflow-reverted for extreme-priced tokens, bricking the live oracle floor.
    ///      `rawPrice` is the pool's token1/token0 price (1e18-scaled); when WETH is token0 the pool price is
    ///      token-per-ETH, so it is inverted to ETH-per-token. Returns ok=false when the price rounds to zero.
    function _priceFromSqrtPriceX96(uint160 sqrtPriceX96, bool token0IsWeth)
        private
        pure
        returns (bool ok, uint256 ethPerToken)
    {
        uint256 rawPrice;
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
            rawPrice = FullMath.mulDiv(ratioX192, 1e18, 1 << 192);
        } else {
            uint256 ratioX128 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
            rawPrice = FullMath.mulDiv(ratioX128, 1e18, 1 << 128);
        }
        if (rawPrice == 0) return (false, 0);

        ethPerToken = token0IsWeth ? (1e18 * 1e18) / rawPrice : rawPrice;
        if (ethPerToken == 0) return (false, 0);
        return (true, ethPerToken);
    }

    // slither-disable-next-line unused-return
    function calculateSwapProportion(
        address token,
        int24 tickLower,
        int24 tickUpper,
        address _poolManager,
        bytes32 poolId
    ) external view override returns (uint256 proportionToSwap) {
        // If no LP position yet (zero ticks), use balanced 50:50 entry
        if (tickLower == 0 && tickUpper == 0) {
            return 5e17; // 50%
        }

        // Skip calculation if poolManager has no code (mock address)
        if (_poolManager.code.length == 0) {
            return 5e17;
        }

        // Get current V4 pool spot price and delegate to the venue-agnostic core so the numeraire +
        // direction fix cannot drift between the V4 and non-V4 (Algebra) entry points.
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(IPoolManager(_poolManager), PoolId.wrap(poolId));

        // A V4 alignment pool is native-ETH-paired: ETH = address(0) sorts first, so ETH is ALWAYS
        // currency0. Pass ethIsCurrency0 = true to preserve the pre-refactor V4 numeraire exactly.
        return _swapProportionFromSqrtPrice(token, tickLower, tickUpper, sqrtPriceX96, true);
    }

    /// @inheritdoc IVaultPriceValidator
    function calculateSwapProportionFromSqrtPrice(
        address token,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96,
        bool ethIsCurrency0
    ) external view override returns (uint256 proportion) {
        return _swapProportionFromSqrtPrice(token, tickLower, tickUpper, sqrtPriceX96, ethIsCurrency0);
    }

    /// @dev Venue-agnostic swap-proportion core shared by {calculateSwapProportion} (V4 spot) and
    ///      {calculateSwapProportionFromSqrtPrice} (caller-supplied spot). Computes the proportion at
    ///      `sqrtPriceX96`, cross-checks it against a V3 TWAP proportion, and applies the absolute
    ///      [35%,65%] clamp. A zero / out-of-range spot degrades to the balanced 50:50 entry (5e17),
    ///      identical to the pre-refactor V4 behavior.
    function _swapProportionFromSqrtPrice(
        address token,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96,
        bool ethIsCurrency0
    ) private view returns (uint256) {
        if (sqrtPriceX96 == 0) {
            return 5e17;
        }

        (bool spotValid, uint256 spotProportion) =
            _computeProportionFromSqrtPrice(sqrtPriceX96, ethIsCurrency0, tickLower, tickUpper);
        if (!spotValid) {
            return 5e17;
        }

        // Cross-check the spot proportion against a V3 TWAP proportion, then apply the absolute clamp.
        // A slot0/globalState spot price is manipulable within a block; the TWAP deviation guard catches
        // manipulation between the spot and the 30-min TWAP. The clamp is a SEPARATE backstop against
        // absolute mis-sizing (see _applyProportionGuards) — it must apply whether or not a TWAP exists.
        //
        // The TWAP pool is Uniswap V3 WETH/`token`, ordered by `weth < token`. That is the SAME address
        // comparison an Algebra caller uses to derive `ethIsCurrency0`, so the caller's flag already
        // matches the TWAP pool's ordering; for the V4 path the flag is `true`, exactly the pre-refactor
        // numeraire. Reusing it keeps spot and TWAP proportions on one numeraire without a second read.
        uint160 twapSqrtPrice = _getTwapSqrtPriceX96(token);
        bool twapValid = false;
        uint256 twapProportion = 0;
        if (twapSqrtPrice != 0) {
            (twapValid, twapProportion) =
                _computeProportionFromSqrtPrice(twapSqrtPrice, ethIsCurrency0, tickLower, tickUpper);
        }

        return _applyProportionGuards(spotProportion, twapValid, twapProportion);
    }

    /// @dev Applies the two independent swap-proportion guards and returns the guarded proportion.
    ///      (1) Spot-vs-TWAP deviation check — catches price manipulation between the manipulable V4
    ///          spot price and the V3 TWAP. Kept, but it is COMMON-MODE BLIND to absolute error:
    ///          both operands come from the same computation, so a systematic bias cancels and can
    ///          never trip this check. It is therefore NOT sufficient on its own.
    ///      (2) Absolute clamp to [35%, 65%] — applied UNCONDITIONALLY (previously it lived only in
    ///          the no-TWAP branch, leaving TWAP-covered targets with no backstop against absolute
    ///          mis-sizing, which is exactly the failure mode that shipped). Full-range positions are
    ///          50/50 BY VALUE at every price; this band bounds worst-case swap mis-sizing.
    function _applyProportionGuards(uint256 spotProportion, bool twapValid, uint256 twapProportion)
        internal
        pure
        returns (uint256)
    {
        if (twapValid) {
            uint256 diff =
                spotProportion > twapProportion ? spotProportion - twapProportion : twapProportion - spotProportion;
            // A >5% (5e16) shift in proportion corresponds to a significant price manipulation.
            if (diff > 5e16) revert SwapProportionDeviationTooHigh();
        }

        if (spotProportion < 35e16) spotProportion = 35e16;
        if (spotProportion > 65e16) spotProportion = 65e16;
        return spotProportion;
    }

    /// @dev Computes the fraction of pending ETH to swap INTO the alignment token for a zap-in to the
    ///      [tickLower, tickUpper] position at the given price. Returns (false, 0) when the price is
    ///      outside the tick range (both position amounts zero).
    ///
    ///      Both position legs are valued in ONE numeraire (ETH) before ratioing. The ORIGINAL bug
    ///      summed amount0 (wei of ETH) and amount1 (alignment-token units) — dimensionally invalid —
    ///      which returned 1/(1+P) instead of the correct proportion and silently stranded ETH.
    ///
    ///      Derivation. Let E = pending ETH, s = ETH swapped, P = tokens per ETH. Post-swap the vault
    ///      holds (E - s) ETH and s*P tokens, which must match the position's required amount0:amount1
    ///      (ETH:token) ratio:
    ///          (E - s) / (s*P) = amount0 / amount1
    ///        ⇒ s/E = amount1 / (P*amount0 + amount1) = tokenValueInEth / (ethValue + tokenValueInEth)
    ///      i.e. the TOKEN side over the total. At the LOWER tick the position is ~all ETH
    ///      (amount1 ≈ 0) ⇒ proportion → 0 (swap ~nothing); at the UPPER tick ~all token ⇒ → 1e18.
    ///      For a FULL-RANGE position this reduces to exactly 5e17 at every price — but that is a
    ///      theorem about the vault's configuration, NOT hardcoded here: this validator is a shared
    ///      IVaultPriceValidator and must be correct for bounded ranges too.
    ///      The numeraire ordering is supplied by the caller (`ethIsCurrency0`), NOT derived from the
    ///      token address: a V4 native-ETH pool always has ETH = currency0, but an Algebra/Cypher pool is
    ///      ERC20/ERC20 ordered by WNativeToken-vs-token address, so its WETH leg can be currency1. A
    ///      hardcoded `address(0) < token` (always true) would invert the direction for a token0-token pool
    ///      and strand ETH or token in the vault.
    function _computeProportionFromSqrtPrice(
        uint160 sqrtPriceX96,
        bool ethIsCurrency0,
        int24 tickLower,
        int24 tickUpper
    ) internal pure returns (bool valid, uint256 proportion) {
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        (uint256 amount0, uint256 amount1) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, 1e18);

        uint256 ethValue = ethIsCurrency0 ? amount0 : amount1;
        uint256 tokenAmount = ethIsCurrency0 ? amount1 : amount0;

        // Value the token leg in ETH so both legs share one numeraire.
        uint256 tokenValueInEth = _tokenValueInEth(sqrtPriceX96, tokenAmount, ethIsCurrency0);

        uint256 denom = ethValue + tokenValueInEth;
        if (denom == 0) {
            return (false, 0);
        }

        proportion = FullMath.mulDiv(tokenValueInEth, 1e18, denom);
        if (proportion > 1e18) proportion = 1e18;
        return (true, proportion);
    }

    /// @dev Converts `tokenAmount` alignment-token units to their ETH value at `sqrtPriceX96`, using
    ///      overflow-safe 512-bit math (the canonical Uniswap OracleLibrary.getQuoteAtTick split so
    ///      sqrtPriceX96**2 never overflows uint256). With ETH as currency0 the pool price P is
    ///      tokens-per-ETH, so token→ETH divides by P (multiply by 2**192 / sqrtPriceX96**2); with ETH
    ///      as currency1 it multiplies by P instead.
    function _tokenValueInEth(uint160 sqrtPriceX96, uint256 tokenAmount, bool ethIsCurrency0)
        private
        pure
        returns (uint256)
    {
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
            return ethIsCurrency0
                ? FullMath.mulDiv(1 << 192, tokenAmount, ratioX192)
                : FullMath.mulDiv(ratioX192, tokenAmount, 1 << 192);
        } else {
            uint256 ratioX128 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
            return ethIsCurrency0
                ? FullMath.mulDiv(1 << 128, tokenAmount, ratioX128)
                : FullMath.mulDiv(ratioX128, tokenAmount, 1 << 128);
        }
    }

    /// @dev Queries V3 pools (across standard fee tiers) for a TWAP-derived sqrtPriceX96.
    ///      Returns 0 if no V3 pool has sufficient observation history.
    function _getTwapSqrtPriceX96(address token) private view returns (uint160) {
        if (v3Factory.code.length == 0) return 0;

        uint24[3] memory feeTiers = [uint24(3000), uint24(500), uint24(10000)];
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapSecondsAgo;
        secondsAgos[1] = 0;

        for (uint256 i = 0; i < feeTiers.length; i++) {
            address pool = IUniswapV3Factory(v3Factory).getPool(weth, token, feeTiers[i]);
            if (pool == address(0)) continue;

            try IUniswapV3Pool(pool).liquidity() returns (uint128 liq) {
                if (liq == 0) continue;
            } catch {
                continue;
            }

            try IUniswapV3Pool(pool).observe(secondsAgos) returns (int56[] memory tickCumulatives, uint160[] memory) {
                int56 delta = tickCumulatives[1] - tickCumulatives[0];
                return TickMath.getSqrtPriceAtTick(_meanTickFromCumulativeDelta(delta, twapSecondsAgo));
            } catch { }
        }

        return 0;
    }
}
