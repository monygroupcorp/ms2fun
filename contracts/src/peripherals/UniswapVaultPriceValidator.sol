// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IVaultPriceValidator } from "../interfaces/IVaultPriceValidator.sol";
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
    /// @notice The caller's spot price is further from the V3 TWAP than `maxPriceDeviationBps` allows.
    /// @dev Both shipping vaults open full-range positions, which are 50/50 by value at every price, so
    ///      the proportion guards never move on them. This guard is measured on price, which moves
    ///      whatever the position's shape is.
    error SpotTwapPriceDeviationTooHigh();
    /// @notice The pinned canonical pool could not produce a usable TWAP.
    /// @dev Thrown by {quoteEthForTokensVia} instead of returning 0, so a missing reference never fails open.
    error ReferenceTwapUnavailable();
    /// @notice `kind` passed to {quoteEthForTokensVia} is not a supported pool family (only 0 is).
    error UnsupportedPoolKind(uint8 kind);
    /// @notice `v3Factory` is codeless, or `maxPriceDeviationBps` is outside (0, 10_000].
    /// @dev A codeless factory is a misconfiguration, never a per-token state; {_getTwapSqrtPriceX96}
    ///      reverts rather than degrade every vault to the clamp-only floor. A real factory with no pool
    ///      for a token is an expected condition and returns 0.
    error PriceValidatorMisconfigured();

    address public immutable weth;
    address public immutable v3Factory;
    address public immutable poolManager;
    uint256 public immutable maxPriceDeviationBps;
    /// @notice TWAP window used for V3 price queries. Defaults to 30 minutes.
    uint32 public immutable twapSecondsAgo;

    /// @notice Minimum in-range liquidity a V3 pool must hold to be eligible as the TWAP deviation
    ///         reference in {_getTwapSqrtPriceX96}. A pool below this floor is skipped and the scan
    ///         continues to the next fee tier, so the cross-check is never anchored to a pool whose
    ///         cumulatives an attacker can set for the cost of a single wei of liquidity.
    ///
    ///         V3 `liquidity()` is the in-range depth (`L ≈ sqrt(x·y)` scaled): any economically
    ///         meaningful WETH-paired pool sits many orders of magnitude above `1e15`, a dust pool far
    ///         below. The value has no on-chain anchor. When no pool clears the floor the TWAP is
    ///         treated as absent.
    uint128 private constant MIN_REFERENCE_LIQUIDITY = 1e15;

    constructor(
        // slither-disable-next-line missing-zero-check
        address _weth,
        // slither-disable-next-line missing-zero-check
        address _v3Factory,
        // slither-disable-next-line missing-zero-check
        address _poolManager,
        uint256 _maxPriceDeviationBps,
        uint32 _twapSecondsAgo
    ) {
        // `maxPriceDeviationBps` is the band of the spot-vs-TWAP price guard. Zero admits no deviation
        // and would revert every conversion against a live pool; above 100% the band is wider than the
        // `sqrtDiff > refSqrt` reject can express, so the number would not describe what is enforced.
        if (_maxPriceDeviationBps == 0 || _maxPriceDeviationBps > 10_000) revert PriceValidatorMisconfigured();
        weth = _weth;
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
        if (kind != 0) revert UnsupportedPoolKind(kind);
        if (amount == 0) return 0;

        // window == 0 falls back to the validator's configured TWAP window (constructor-guaranteed non-zero).
        uint32 win = window == 0 ? twapSecondsAgo : window;

        int56 tickCumulativeDelta = _pinnedTwapTickDelta(pool, kind, win);

        // Token ordering is canonical (token0 = lower address) on a Uniswap V3 factory, so WETH is token0
        // iff `weth < token` — no token0() call needed.
        (bool ok, uint256 ethPerToken) = _ethPerTokenFromTwapDelta(tickCumulativeDelta, win, weth < token);

        // A zero / unusable price means the pinned pool cannot serve as a reference; never return 0.
        if (!ok) revert ReferenceTwapUnavailable();

        return (amount * ethPerToken) / 1e18;
    }

    /// @dev Reads the tick-cumulative delta over `window` from the pinned `pool` via the Uniswap V3
    ///      `observe`. Any failure to obtain the delta (pool has no code, insufficient observation history)
    ///      reverts `ReferenceTwapUnavailable`, never a silent 0. Callers must have already rejected `kind != 0`.
    function _pinnedTwapTickDelta(
        address pool,
        uint8,
        /* kind */
        uint32 window
    )
        private
        view
        returns (int56)
    {
        // A no-code target's high-level call reverts via the compiler's extcodesize pre-check, which
        // try/catch does NOT trap (it reverts with empty data). Guard it explicitly so an absent pool
        // is the named ReferenceTwapUnavailable, never a bare revert and never a fail-open.
        if (pool.code.length == 0) revert ReferenceTwapUnavailable();

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;

        try IUniswapV3Pool(pool).observe(secondsAgos) returns (int56[] memory tickCumulatives, uint160[] memory) {
            return tickCumulatives[1] - tickCumulatives[0];
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
    ///      FullMath split, the same overflow-safe path as {_tokenValueInEth}; no low bits are discarded
    ///      before squaring and extreme prices do not overflow.
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
        // No LP position yet (zero ticks): balanced 50:50 entry.
        if (tickLower == 0 && tickUpper == 0) {
            return 5e17; // 50%
        }

        // A poolManager without code (mock address) gets the balanced entry.
        if (_poolManager.code.length == 0) {
            return 5e17;
        }

        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(IPoolManager(_poolManager), PoolId.wrap(poolId));

        // A V4 alignment pool is native-ETH-paired: ETH = address(0) sorts first, so ETH is always
        // currency0. This is the spot ordering only; the TWAP cross-check reads its own ordering off the
        // V3 pool it queries, which for a token sorting below WETH is not this one.
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
    ///      `sqrtPriceX96`, requires that price to sit within `maxPriceDeviationBps` of the V3 TWAP,
    ///      cross-checks the proportion against a V3 TWAP proportion, and applies the absolute [35%,65%]
    ///      clamp. A zero / out-of-range spot degrades to the balanced 50:50 entry (5e17).
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
        // manipulation between the spot and the TWAP. The clamp is a separate backstop against absolute
        // mis-sizing (see _applyProportionGuards) and applies whether or not a TWAP exists.
        //
        // Each proportion is computed on the ordering of the pool it came from. The spot uses the
        // caller's `ethIsCurrency0`; the TWAP uses the ordering of the V3 WETH/`token` pool it was read
        // from, which `_getTwapSqrtPriceX96` returns alongside the price. The two can differ: a V4
        // alignment pool is native-ETH-paired (flag always `true`) while the V3 pool orders WETH second
        // for any token sorting below WETH. Proportions on opposite numeraires are not comparable and
        // would either trip `SwapProportionDeviationTooHigh` against an honest pool or leave `twapValid`
        // false and skip the deviation guard.
        (uint160 twapSqrtPrice, bool twapEthIsCurrency0) = _getTwapSqrtPriceX96(token);
        bool twapValid = false;
        uint256 twapProportion = 0;
        if (twapSqrtPrice != 0) {
            // The price guard runs first and is not conditioned on `twapValid`. The guards below work on
            // the proportion, which is 5e17 at every price for the full-range positions both shipping
            // vaults open, so they cannot observe a manipulated spot there. A price this far from the TWAP
            // is a pushed pool whatever the position's shape, and `twapValid` going false is itself one
            // way a wrong price shows up.
            _requireSpotWithinTwapBand(sqrtPriceX96, twapSqrtPrice, twapEthIsCurrency0 == ethIsCurrency0);

            // `tickLower`/`tickUpper` are stated in the CALLER's pool, so when the TWAP pool orders the
            // pair the other way round the range is carried across with the price. Inverting a price maps
            // tick `t` to `-t`, so the interval becomes `[-tickUpper, -tickLower]`, exact in tick space
            // (inverting `sqrtPriceX96` would round). Carrying only the flag is right solely for a range
            // symmetric about tick 0.
            (int24 twapLower, int24 twapUpper) =
                twapEthIsCurrency0 == ethIsCurrency0 ? (tickLower, tickUpper) : (-tickUpper, -tickLower);
            (twapValid, twapProportion) =
                _computeProportionFromSqrtPrice(twapSqrtPrice, twapEthIsCurrency0, twapLower, twapUpper);
        }

        return _applyProportionGuards(spotProportion, twapValid, twapProportion);
    }

    /// @dev Applies the two independent swap-proportion guards and returns the guarded proportion.
    ///      Both work on the proportion and are blind on a full-range position, whose proportion is 5e17
    ///      at every price; `_requireSpotWithinTwapBand` has already run on the price and is the guard
    ///      that binds on that path. These two serve the bounded ranges this shared validator also handles.
    ///      (1) Spot-vs-TWAP deviation check: catches manipulation between the V4 spot and the V3 TWAP.
    ///          Both operands come from the same computation, so a systematic bias cancels and never
    ///          trips it; it is not sufficient alone.
    ///      (2) Absolute clamp to [35%, 65%], applied unconditionally (with or without a TWAP). Full-range
    ///          positions are 50/50 by value at every price; the band bounds worst-case swap mis-sizing.
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

    /// @dev Requires the caller's spot price to sit within `maxPriceDeviationBps` of the V3 TWAP.
    ///
    ///      This guard holds for every position shape. `_applyProportionGuards` works on the swap
    ///      proportion, which for a full-range position is 5e17 at every price (see
    ///      {_computeProportionFromSqrtPrice}), so there its deviation check sees two identical operands
    ///      and its clamp sees a number already inside the band. Measuring the divergence on price
    ///      makes it visible for every shape.
    ///
    ///      `sameOrdering` carries the numeraire across, as the proportion path does for the range. A V4
    ///      native-ETH pool always has ETH as currency0; the V3 pool orders the pair by address, so its
    ///      WETH leg can be currency1, and comparing the prices as-is would compare a price against its
    ///      reciprocal. The reciprocal of a Q64.96 sqrt price is `2**192 / s`, exact to within one ulp of
    ///      a 96-bit fraction, far below the tightest configurable band.
    ///
    ///      The deviation is measured on price, the scale `maxPriceDeviationBps` carries elsewhere in this
    ///      tree (`_floorTokenOut`). Comparing sqrt deltas directly would admit a band roughly twice as
    ///      wide as its label.
    function _requireSpotWithinTwapBand(uint160 spotSqrtPriceX96, uint160 twapSqrtPriceX96, bool sameOrdering)
        private
        view
    {
        uint256 spotSqrt = spotSqrtPriceX96;
        // 2**192 / s is the same price read in the other numeraire: s = sqrt(P) * 2**96, so the reciprocal
        // price's sqrt is 2**96 / sqrt(P) = 2**192 / s. Done in tick space instead it would round to a
        // whole tick, and a tick is a basis point of price — the very unit of the band being enforced.
        uint256 refSqrt = sameOrdering ? uint256(twapSqrtPriceX96) : (uint256(1) << 192) / uint256(twapSqrtPriceX96);

        uint256 sqrtDiff = spotSqrt > refSqrt ? spotSqrt - refSqrt : refSqrt - spotSqrt;
        // Only reachable above the reference, where a sqrt gap wider than the reference itself is a price
        // more than 4x it — past any admissible band, since the knob is capped at 10000 bps. Below it the
        // gap can never reach the reference, so the exact comparison below takes that side alone.
        // Rejecting the high tail here also keeps the next line inside a uint256.
        if (sqrtDiff > refSqrt) revert SpotTwapPriceDeviationTooHigh();
        // |P_s - P_r| / P_r == |s_s - s_r| * (s_s + s_r) / s_r^2. Divided by the reference in one
        // full-width step so the s^2 term never has to fit in a word; what remains is <= 3 * s_r.
        uint256 scaledPriceDiff = FullMath.mulDiv(sqrtDiff, spotSqrt + refSqrt, refSqrt);
        if (scaledPriceDiff * 10_000 > refSqrt * maxPriceDeviationBps) revert SpotTwapPriceDeviationTooHigh();
    }

    /// @dev Computes the fraction of pending ETH to swap INTO the alignment token for a zap-in to the
    ///      [tickLower, tickUpper] position at the given price. Returns (false, 0) when the price is
    ///      outside the tick range (both position amounts zero).
    ///
    ///      Both position legs are valued in one numeraire (ETH) before ratioing; amount0 (wei of ETH) and
    ///      amount1 (token units) cannot be summed directly.
    ///
    ///      Derivation. Let E = pending ETH, s = ETH swapped, P = tokens per ETH. Post-swap the vault
    ///      holds (E - s) ETH and s*P tokens, which must match the position's required amount0:amount1
    ///      (ETH:token) ratio:
    ///          (E - s) / (s*P) = amount0 / amount1
    ///        ⇒ s/E = amount1 / (P*amount0 + amount1) = tokenValueInEth / (ethValue + tokenValueInEth)
    ///      i.e. the TOKEN side over the total. At the LOWER tick the position is ~all ETH
    ///      (amount1 ≈ 0) ⇒ proportion → 0 (swap ~nothing); at the UPPER tick ~all token ⇒ → 1e18.
    ///      For a FULL-RANGE position this reduces to exactly 5e17 at every price — but that is a
    ///      theorem about the vault's configuration, not hardcoded here: this validator is shared and must
    ///      be correct for bounded ranges too.
    ///      The numeraire ordering is supplied by the caller (`ethIsCurrency0`), not derived from the
    ///      token address: a V4 native-ETH pool always has ETH = currency0, but an ERC20/ERC20 pool is
    ///      ordered by WNativeToken-vs-token address, so its WETH leg can be currency1. Assuming
    ///      `address(0) < token` would invert the direction and strand ETH or token in the vault.
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

    /// @dev Queries V3 pools (across standard fee tiers) for a TWAP-derived sqrtPriceX96. A pool must
    ///      clear the {MIN_REFERENCE_LIQUIDITY} depth floor to be eligible; sub-floor pools are skipped
    ///      so the deviation reference cannot be captured by a dust-liquidity pool. Returns 0 if no
    ///      pool clears the floor with sufficient observation history, an expected result for a token
    ///      with no deep V3 pool; the caller then applies the clamp-only floor.
    ///      A codeless `v3Factory` is never legitimate (a real factory always has code) and reverts
    ///      rather than silently degrading every vault behind the validator to the clamp-only floor.
    ///
    ///      Returns the pool's numeraire ordering alongside the price. Every pool this scan can pick is a
    ///      V3 `weth`/`token` pair ordered by address, so `weth < token` is a property of the pool the
    ///      price came from, never of the caller's venue. `ethIsCurrency0` is meaningless when the price
    ///      is 0 and the caller ignores it then.
    function _getTwapSqrtPriceX96(address token) private view returns (uint160, bool ethIsCurrency0) {
        if (v3Factory.code.length == 0) revert PriceValidatorMisconfigured();
        ethIsCurrency0 = weth < token;

        uint24[3] memory feeTiers = [uint24(3000), uint24(500), uint24(10000)];
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapSecondsAgo;
        secondsAgos[1] = 0;

        for (uint256 i = 0; i < feeTiers.length; i++) {
            address pool = IUniswapV3Factory(v3Factory).getPool(weth, token, feeTiers[i]);
            if (pool == address(0)) continue;

            // Depth gate: a dust pool's `observe` cumulatives are attacker-controlled.
            try IUniswapV3Pool(pool).liquidity() returns (uint128 liq) {
                if (liq < MIN_REFERENCE_LIQUIDITY) continue;
            } catch {
                continue;
            }

            try IUniswapV3Pool(pool).observe(secondsAgos) returns (int56[] memory tickCumulatives, uint160[] memory) {
                int56 delta = tickCumulatives[1] - tickCumulatives[0];
                return
                    (TickMath.getSqrtPriceAtTick(_meanTickFromCumulativeDelta(delta, twapSecondsAgo)), ethIsCurrency0);
            } catch { }
        }

        return (0, ethIsCurrency0);
    }
}
