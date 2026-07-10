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

    /// @notice Quote the expected ETH output for selling `tokenAmount` alignment tokens.
    /// @dev DEPRECATED — see {quoteEthForTokensVia}. This shotgun path searches a fixed set of Uniswap
    ///      V3 fee tiers and falls back to a V2 spot price, and it RETURNS 0 (fail-open) when no reliable
    ///      price source exists. Callers that must not fail open should read a pinned canonical pool via
    ///      {quoteEthForTokensVia}, which reverts instead. Kept for callers not yet migrated; scheduled
    ///      for removal once none remain.
    /// @param token Alignment token address
    /// @param tokenAmount Amount of tokens to sell
    /// @return ethAmount Expected ETH output at TWAP price (no slippage deduction applied)
    function quoteEthForTokens(address token, uint256 tokenAmount) external view returns (uint256 ethAmount);

    /// @notice Quote the ETH value of `amount` of `token` from ONE pinned canonical pool's TWAP.
    /// @dev Reads the pinned `pool`'s time-weighted mean tick over `window` seconds and converts it to
    ///      ETH using the same mean-tick fixed-point math as {quoteEthForTokens}. Unlike that shotgun
    ///      path, this NEVER returns 0 as a fail-open: if the pinned pool cannot produce a usable TWAP,
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
