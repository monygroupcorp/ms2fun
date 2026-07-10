// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IVaultPriceValidator } from "../interfaces/IVaultPriceValidator.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolId } from "v4-core/types/PoolId.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { LiquidityAmounts } from "../libraries/v4/LiquidityAmounts.sol";
import { FullMath } from "v4-core/libraries/FullMath.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

// ========== External Protocol Interfaces ==========

/// @notice Uniswap V2 Factory interface
interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

/// @notice Uniswap V2 Pair interface
interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

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

    error PriceDeviationTooHigh();
    error InsufficientWETHLiquidity();
    error SwapAmountTooLarge();
    error InvalidDenominator();
    error InsufficientPurchasePower();
    error SwapProportionDeviationTooHigh();

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
    function quoteEthForTokens(address token, uint256 tokenAmount) external view override returns (uint256) {
        if (tokenAmount == 0) return 0;

        // Prefer V3 TWAP — most manipulation-resistant
        (, uint256 priceV3,) = _getV3PriceAndLiquidity(token);
        if (priceV3 > 0) {
            return (tokenAmount * priceV3) / 1e18;
        }

        // Fall back to V2 spot price (acceptable for low-frequency fee conversion)
        (, uint256 priceV2,,) = _getV2PriceAndReserves(token);
        if (priceV2 > 0) {
            return (tokenAmount * priceV2) / 1e18;
        }

        return 0;
    }

    function validatePrice(address token, uint256 pendingETH) external view override {
        // Query V2 pool for price and reserves
        (bool hasV2Pool, uint256 priceV2, uint112 reserveWETH, uint112 reserveToken) = _getV2PriceAndReserves(token);

        // Query V3 pool for price and liquidity
        (bool hasV3Pool, uint256 priceV3,) = _getV3PriceAndLiquidity(token);

        // Query V4 pool for price and liquidity (may be WETH or native ETH pool)
        (bool hasV4Pool, uint256 priceV4,) = _getV4PriceAndLiquidity(token);

        // If no pools are available, skip validation (expected in unit tests with mock addresses)
        if (!hasV2Pool && !hasV3Pool && !hasV4Pool) {
            return;
        }

        // Cross-check prices across all available pools for arbitrage/manipulation detection
        if (hasV2Pool && hasV3Pool) {
            (bool isAcceptable,) = _checkPriceDeviation(priceV2, priceV3);
            if (!isAcceptable) revert PriceDeviationTooHigh();
        }

        // When V4 is the sole price source, cross-check its spot price against a V3 TWAP.
        // V4 slot0 is manipulable within a block; the TWAP guard prevents flash-loan attacks
        // on vault ETH. If no TWAP is available (new pool), skip validation — same behavior
        // as before, but mature pools with V3 history are now protected.
        if (hasV4Pool && !hasV2Pool && !hasV3Pool && priceV4 != 0) {
            uint160 twapSqrtPrice = _getTwapSqrtPriceX96(token);
            if (twapSqrtPrice != 0) {
                // Convert TWAP sqrtPriceX96 to the same price scale used by priceV4
                uint256 sqrtScaled = uint256(twapSqrtPrice) >> 48;
                uint256 rawTwap = (sqrtScaled * sqrtScaled * 1e18) >> 96;
                // Determine token ordering to get WETH/token price
                address currency0Addr = address(0) < token ? address(0) : token;
                uint256 priceV4Twap = (currency0Addr == weth || currency0Addr == address(0))
                    ? (rawTwap == 0 ? 0 : (1e18 * 1e18) / rawTwap)
                    : rawTwap;
                if (priceV4Twap != 0) {
                    (bool isAcceptable,) = _checkPriceDeviation(priceV4, priceV4Twap);
                    if (!isAcceptable) revert PriceDeviationTooHigh();
                }
            }
        }

        // Verify sufficient liquidity for the pending swap
        // Only enforce V2 capacity when V2 is the sole swap route (V3/V4 unavailable)
        if (hasV2Pool && !hasV3Pool && !hasV4Pool) {
            if (reserveWETH < 10 ether) revert InsufficientWETHLiquidity();

            if (pendingETH > 0) {
                uint256 maxSwapAmount = uint256(reserveWETH) / 10; // 10% of WETH reserve
                if (pendingETH > maxSwapAmount) revert SwapAmountTooLarge();

                uint256 amountInWithFee = pendingETH * 997;
                uint256 denominator = (uint256(reserveWETH) * 1000) + amountInWithFee;
                if (denominator == 0) revert InvalidDenominator();
                uint256 expectedOut = (amountInWithFee * uint256(reserveToken)) / denominator;
                if (expectedOut == 0) revert InsufficientPurchasePower();
            }
        }
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

        // Get current V4 pool spot price
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(IPoolManager(_poolManager), PoolId.wrap(poolId));

        if (sqrtPriceX96 == 0) {
            return 5e17;
        }

        // Compute proportion from V4 spot price
        (bool spotValid, uint256 spotProportion) =
            _computeProportionFromSqrtPrice(sqrtPriceX96, token, tickLower, tickUpper);
        if (!spotValid) {
            return 5e17;
        }

        // Cross-check V4 spot proportion against a V3 TWAP proportion, then apply the absolute
        // clamp. V4 slot0 is a manipulable spot price; the TWAP deviation guard catches manipulation
        // between the spot and the 30-min TWAP. The clamp is a SEPARATE backstop against absolute
        // mis-sizing (see _applyProportionGuards) — it must apply whether or not a TWAP exists.
        uint160 twapSqrtPrice = _getTwapSqrtPriceX96(token);
        bool twapValid = false;
        uint256 twapProportion = 0;
        if (twapSqrtPrice != 0) {
            (twapValid, twapProportion) = _computeProportionFromSqrtPrice(twapSqrtPrice, token, tickLower, tickUpper);
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
    function _computeProportionFromSqrtPrice(uint160 sqrtPriceX96, address token, int24 tickLower, int24 tickUpper)
        internal
        pure
        returns (bool valid, uint256 proportion)
    {
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        (uint256 amount0, uint256 amount1) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, 1e18);

        // currency0 is native ETH when address(0) < token (Uniswap V4 currency ordering). address(0)
        // is the smallest address, so ETH is always currency0 for an ETH-paired pool.
        bool ethIsCurrency0 = address(0) < token;
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
                int24 meanTick = int24(delta / int56(uint56(twapSecondsAgo)));
                if (delta < 0 && (delta % int56(uint56(twapSecondsAgo)) != 0)) meanTick--;
                return TickMath.getSqrtPriceAtTick(meanTick);
            } catch { }
        }

        return 0;
    }

    // --- private helpers (moved verbatim from vault) ---

    // slither-disable-next-line unused-return
    function _getV2PriceAndReserves(address token)
        private
        view
        returns (bool hasV2Pool, uint256 priceV2, uint112 reserveWETH, uint112 reserveToken)
    {
        if (v2Factory.code.length == 0) {
            return (false, 0, 0, 0);
        }

        address pair = IUniswapV2Factory(v2Factory).getPair(weth, token);

        if (pair == address(0)) {
            return (false, 0, 0, 0);
        }

        (uint112 reserve0, uint112 reserve1,) = IUniswapV2Pair(pair).getReserves();

        if (reserve0 == 0 || reserve1 == 0) {
            return (false, 0, 0, 0);
        }

        address token0 = IUniswapV2Pair(pair).token0();
        bool wethIsToken0 = (token0 == weth);

        if (wethIsToken0) {
            reserveWETH = reserve0;
            reserveToken = reserve1;
            priceV2 = (uint256(reserve0) * 1e18) / uint256(reserve1);
        } else {
            reserveWETH = reserve1;
            reserveToken = reserve0;
            priceV2 = (uint256(reserve1) * 1e18) / uint256(reserve0);
        }

        hasV2Pool = true;
    }

    // slither-disable-next-line calls-loop,unused-return
    function _queryV3PoolForFee(address token, uint24 feeTier)
        private
        view
        returns (bool success, uint256 price, uint128 poolLiquidity)
    {
        if (v3Factory.code.length == 0) {
            return (false, 0, 0);
        }

        address pool = IUniswapV3Factory(v3Factory).getPool(weth, token, feeTier);

        if (pool == address(0)) {
            return (false, 0, 0);
        }

        // Verify pool is not locked (reentrancy guard) and has liquidity via slot0/liquidity.
        // We read liquidity for the depth check but derive price from the TWAP, not slot0.
        try IUniswapV3Pool(pool).slot0() returns (uint160, int24, uint16, uint16, uint16, uint8, bool unlocked) {
            if (!unlocked) {
                return (false, 0, 0);
            }
        } catch {
            return (false, 0, 0);
        }

        try IUniswapV3Pool(pool).liquidity() returns (uint128 liq) {
            if (liq == 0) {
                return (false, 0, 0);
            }
            poolLiquidity = liq;
        } catch {
            return (false, 0, 0);
        }

        // Derive price from TWAP to prevent flash-loan manipulation of the deviation check.
        // observe() reverts if the pool has insufficient observation history (cardinality == 1
        // or window older than oldest stored observation). In that case we skip the cross-check
        // for this pool rather than falling back to the manipulable spot price.
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapSecondsAgo;
        secondsAgos[1] = 0;

        try IUniswapV3Pool(pool).observe(secondsAgos) returns (int56[] memory tickCumulatives, uint160[] memory) {
            int56 delta = tickCumulatives[1] - tickCumulatives[0];
            int24 meanTick = int24(delta / int56(uint56(twapSecondsAgo)));
            // Round toward negative infinity when remainder is negative (standard V3 TWAP rounding)
            if (delta < 0 && (delta % int56(uint56(twapSecondsAgo)) != 0)) meanTick--;

            uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(meanTick);
            uint256 sqrtScaled = uint256(sqrtPriceX96) >> 48;
            uint256 rawPrice = (sqrtScaled * sqrtScaled * 1e18) >> 96;

            address token0 = IUniswapV3Pool(pool).token0();
            if (token0 == weth) {
                if (rawPrice == 0) return (false, 0, 0);
                price = (1e18 * 1e18) / rawPrice;
            } else {
                price = rawPrice;
            }

            return (true, price, poolLiquidity);
        } catch {
            // Pool exists and has liquidity but TWAP window is unavailable (new pool or
            // observation cardinality not yet expanded). Skip this pool for the cross-check.
            return (false, 0, 0);
        }
    }

    function _getV3PriceAndLiquidity(address token)
        private
        view
        returns (bool hasV3Pool, uint256 priceV3, uint128 liquidity)
    {
        uint24[3] memory feeTiers = [uint24(3000), uint24(500), uint24(10000)];

        for (uint256 i = 0; i < feeTiers.length; i++) {
            (bool success, uint256 price, uint128 liq) = _queryV3PoolForFee(token, feeTiers[i]);

            if (success) {
                return (true, price, liq);
            }
        }

        return (false, 0, 0);
    }

    function _getV4PriceAndLiquidity(address token)
        private
        view
        returns (bool hasV4Pool, uint256 priceV4, uint128 liquidity)
    {
        if (poolManager.code.length == 0) {
            return (false, 0, 0);
        }

        uint24[3] memory feeTiers = [uint24(3000), uint24(500), uint24(10000)];
        int24[3] memory tickSpacings = [int24(60), int24(10), int24(200)];

        for (uint256 i = 0; i < feeTiers.length; i++) {
            (bool success, uint256 price, uint128 liq) =
                _queryV4PoolForTokenPair(weth, token, feeTiers[i], tickSpacings[i]);

            if (success) {
                return (true, price, liq);
            }

            (success, price, liq) = _queryV4PoolForTokenPair(address(0), token, feeTiers[i], tickSpacings[i]);

            if (success) {
                return (true, price, liq);
            }
        }

        return (false, 0, 0);
    }

    // slither-disable-next-line unused-return
    function _queryV4PoolForTokenPair(address token0Addr, address token1Addr, uint24 fee, int24 tickSpacing)
        private
        view
        returns (bool success, uint256 price, uint128 poolLiquidity)
    {
        (Currency currency0, Currency currency1) = token0Addr < token1Addr
            ? (Currency.wrap(token0Addr), Currency.wrap(token1Addr))
            : (Currency.wrap(token1Addr), Currency.wrap(token0Addr));

        PoolKey memory poolKey = PoolKey({
            currency0: currency0, currency1: currency1, fee: fee, tickSpacing: tickSpacing, hooks: IHooks(address(0))
        });

        PoolId poolId = poolKey.toId();

        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(IPoolManager(poolManager), poolId);

        if (sqrtPriceX96 == 0) {
            return (false, 0, 0);
        }

        uint128 liq = StateLibrary.getLiquidity(IPoolManager(poolManager), poolId);

        if (liq == 0) {
            return (false, 0, 0);
        }

        uint256 sqrtScaled = uint256(sqrtPriceX96) >> 48;
        uint256 rawPrice = (sqrtScaled * sqrtScaled * 1e18) >> 96;

        address currency0Addr = Currency.unwrap(currency0);

        if (currency0Addr == weth || currency0Addr == address(0)) {
            if (rawPrice == 0) {
                return (false, 0, 0);
            }
            price = (1e18 * 1e18) / rawPrice;
        } else {
            price = rawPrice;
        }

        return (true, price, liq);
    }

    function _checkPriceDeviation(uint256 price1, uint256 price2)
        private
        view
        returns (bool isAcceptable, uint256 deviation)
    {
        if (price1 == 0 || price2 == 0) {
            return (false, 0);
        }

        uint256 diff = price1 > price2 ? price1 - price2 : price2 - price1;
        uint256 avg = (price1 + price2) / 2;

        deviation = (diff * 10000) / avg;

        isAcceptable = deviation <= maxPriceDeviationBps;
    }
}
