// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVaultPriceValidator {
    /// @notice Validate cross-DEX price deviation and pool liquidity depth.
    /// @dev Reverts if manipulation is detected or liquidity is insufficient.
    ///      Returns silently if price is healthy.
    /// @param token Alignment token address to validate price for
    /// @param pendingETH Total ETH about to be swapped (for liquidity depth check)
    function validatePrice(address token, uint256 pendingETH) external view;

    /// @notice Calculate the proportion of ETH to swap vs. hold for LP.
    /// @dev Returns 5e17 (50%) for full-range positions or when no position exists.
    ///      For concentrated positions, returns tick-weighted ratio.
    /// @param token Alignment token address
    /// @param tickLower Vault's current LP position lower tick
    /// @param tickUpper Vault's current LP position upper tick
    /// @param poolManager V4 PoolManager address
    /// @param poolId V4 pool identifier (keccak256 of PoolKey)
    /// @return proportionToSwap 1e18-scaled value (5e17 = 50%, 1e18 = 100%)
    function calculateSwapProportion(
        address token,
        int24 tickLower,
        int24 tickUpper,
        address poolManager,
        bytes32 poolId
    ) external view returns (uint256 proportionToSwap);

    /// @notice Venue-agnostic swap proportion from a caller-supplied `sqrtPriceX96`.
    /// @dev The venue-independent core of {calculateSwapProportion}: it needs only the LP tick range and
    ///      a spot `sqrtPriceX96`, not a V4 PoolManager, so a non-V4 caller (e.g. an Algebra vault reading
    ///      `IAlgebraPool.globalState().price`) can size its own zap-in. Applies the SAME TWAP cross-check
    ///      and absolute [35%,65%] clamp as {calculateSwapProportion}.
    ///
    ///      The numeraire ordering is NOT assumed — the caller passes `ethIsCurrency0` for its own pool.
    ///      A V4 native-ETH pool has ETH = currency0 (address(0) sorts first), so its caller passes `true`.
    ///      An Algebra/Cypher pool is ERC20/ERC20 ordered by WNativeToken-vs-token address, so its caller
    ///      passes `weth < token` (which is `false` when the alignment token sorts below WETH — a real,
    ///      supported ordering). Passing the wrong flag inverts the price direction and mis-sizes the swap,
    ///      so the ordering MUST reflect the pool that produced `sqrtPriceX96`.
    /// @param token Alignment token address (used to resolve the V3 TWAP cross-check pool)
    /// @param tickLower Vault's current LP position lower tick
    /// @param tickUpper Vault's current LP position upper tick
    /// @param sqrtPriceX96 Caller-supplied spot price (Q64.96) to size the swap against
    /// @param ethIsCurrency0 True iff the ETH/WETH numeraire is currency0 (token0) in the caller's pool
    /// @return proportion 1e18-scaled fraction of ETH to swap into `token` (5e17 = 50%)
    function calculateSwapProportionFromSqrtPrice(
        address token,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96,
        bool ethIsCurrency0
    ) external view returns (uint256 proportion);

    /// @notice Quote the ETH value of `amount` of `token` from ONE pinned canonical pool's TWAP.
    /// @dev Reads the pinned `pool`'s time-weighted mean tick over `window` seconds and converts it to
    ///      ETH using canonical mean-tick fixed-point math. This NEVER returns 0 as a fail-open: if the
    ///      pinned pool cannot produce a usable TWAP,
    ///      it reverts (`ReferenceTwapUnavailable`). Callers are expected to supply a registry-guaranteed
    ///      usable pool (the DoS-vs-fail-open tradeoff is intentional). The validator does not read the
    ///      registry itself — the caller resolves the canonical `ReferencePool` and passes its params in.
    /// @param pool Pinned canonical pool to read the TWAP from (WETH/`token`, either token ordering)
    /// @param kind Pool family: 0 = Uniswap V3 (`observe`), 1 = Algebra (`plugin().getTimepoints`);
    ///             any value >= 2 reverts
    /// @param window TWAP lookback in seconds; 0 uses the validator's configured `twapSecondsAgo`
    /// @param token Token to price (the non-WETH leg of `pool`)
    /// @param amount Amount of `token` to value in ETH
    /// @return ethAmount ETH value of `amount` at the pinned pool's TWAP (no slippage deduction applied)
    function quoteEthForTokensVia(address pool, uint8 kind, uint32 window, address token, uint256 amount)
        external
        view
        returns (uint256 ethAmount);
}
