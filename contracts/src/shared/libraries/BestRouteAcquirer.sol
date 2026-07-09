// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice On-chain best-route quote surface (zQuoter.getQuotes). The base quoter
///         (`zQuoterBase`) only ever reports one of these five single-hop sources, and every one of
///         them maps to a typed zRouter leg below — so no route is ever dispatched through the
///         generic `snwap`/`snwapMulti` executor (arbitrary-target + arbitrary-calldata = drain
///         surface). Enum order MUST match `zQuoterBase.AMM` for correct ABI decoding.
interface IBestRouteQuoter {
    enum AMM {
        UNI_V2,
        SUSHI,
        ZAMM,
        UNI_V3,
        UNI_V4
    }

    struct Quote {
        AMM source;
        uint256 feeBps;
        uint256 amountIn;
        uint256 amountOut;
    }

    function getQuotes(bool exactOut, address tokenIn, address tokenOut, uint256 swapAmount)
        external
        view
        returns (Quote memory best, Quote[] memory quotes);
}

/// @notice Typed zRouter legs only. Deliberately excludes `snwap`/`snwapMulti`: those send tokens to
///         an arbitrary executor and run arbitrary calldata (LiFi/Transit-class drain surface). The
///         acquirer maps a quoted source to exactly one of these, so it never widens the call surface.
interface IBestRouteRouter {
    function swapV2(
        address to,
        bool exactOut,
        address tokenIn,
        address tokenOut,
        uint256 swapAmount,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut);

    function swapV3(
        address to,
        bool exactOut,
        uint24 swapFee,
        address tokenIn,
        address tokenOut,
        uint256 swapAmount,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut);

    function swapV4(
        address to,
        bool exactOut,
        uint24 swapFee,
        int24 tickSpace,
        address tokenIn,
        address tokenOut,
        uint256 swapAmount,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut);

    function swapVZ(
        address to,
        bool exactOut,
        uint256 feeOrHook,
        address tokenIn,
        address tokenOut,
        uint256 idIn,
        uint256 idOut,
        uint256 swapAmount,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut);
}

/// @title BestRouteAcquirer
/// @notice Shared ETH -> alignment-token *acquisition* helper for the alignment vaults (Front 2 of
///         the unified router). Picks the deepest single-hop pool via an on-chain `zQuoter.getQuotes`
///         and dispatches to the matching TYPED zRouter leg (`swapV2/V3/V4/VZ`). The LP-add step
///         stays venue-native per family and is NOT handled here.
/// @dev Design invariants (locked, rth 2026-07-09):
///      - TYPED dispatch only. A quoted source with no typed leg the vault can call is treated as
///        "no usable route" and degrades to the caller's fixed-pool fallback — it is NEVER routed
///        through the generic `snwap` executor.
///      - `minOut` is the vault's own oracle-derived floor, passed in and enforced as the router
///        `amountLimit` (the router reverts on `received < minOut`). The helper never widens it.
///      - Fixed-pool fallback (the vault's pre-existing `swapV4`/`swapVZ` leg) is preserved as a
///        floor: engaged when the quoter is unset, reverts, returns an empty route, or reports an
///        unmappable source. This keeps today's behavior intact when best-route is unavailable.
///      Called as an `internal` (inlined) library, so `address(this)`, `msg.value`/balance, and the
///      swap recipient are the *vault's* — identical execution context to the direct call it replaces.
library BestRouteAcquirer {
    /// @notice Acquire `tokenOut` with `ethAmount` for a Uni-family vault: best-route typed dispatch,
    ///         falling back to the vault's fixed `swapV4(fallbackFee, fallbackTickSpacing)` pool.
    /// @param zRouter zRouter address (typed legs).
    /// @param zQuoter zQuoter address for on-chain best-route selection; `address(0)` = fallback only.
    /// @param tokenOut Alignment token to buy (ETH in is `address(0)`).
    /// @param ethAmount ETH to spend (exact-in).
    /// @param minOut Oracle-floored minimum token out; enforced as the router `amountLimit`.
    /// @param fallbackFee Fixed-pool V4 fee for the fallback leg.
    /// @param fallbackTickSpacing Fixed-pool V4 tick spacing for the fallback leg.
    /// @param fallbackDeadline Deadline for the fallback leg (vault preserves its current value).
    /// @return amountReceived Alignment tokens received (>= minOut, enforced by the router).
    function acquireViaV4(
        address zRouter,
        address zQuoter,
        address tokenOut,
        uint256 ethAmount,
        uint256 minOut,
        uint24 fallbackFee,
        int24 fallbackTickSpacing,
        uint256 fallbackDeadline
    ) internal returns (uint256 amountReceived) {
        (bool ok, uint256 out) = _tryBestRoute(zRouter, zQuoter, tokenOut, ethAmount, minOut);
        if (ok) return out;

        (, amountReceived) = IBestRouteRouter(zRouter).swapV4{ value: ethAmount }(
            address(this),
            false,
            fallbackFee,
            fallbackTickSpacing,
            address(0),
            tokenOut,
            ethAmount,
            minOut,
            fallbackDeadline
        );
    }

    /// @notice Acquire `tokenOut` with `ethAmount` for a ZAMM-family vault: best-route typed dispatch,
    ///         falling back to the vault's fixed `swapVZ(fallbackFeeOrHook)` pool.
    /// @param zRouter zRouter address (typed legs).
    /// @param zQuoter zQuoter address for on-chain best-route selection; `address(0)` = fallback only.
    /// @param tokenOut Alignment token to buy (ETH in is `address(0)`).
    /// @param ethAmount ETH to spend (exact-in).
    /// @param minOut Oracle-floored minimum token out; enforced as the router `amountLimit`.
    /// @param fallbackFeeOrHook Fixed-pool ZAMM feeOrHook for the fallback leg.
    /// @param fallbackDeadline Deadline for the fallback leg (vault preserves its current value).
    /// @return amountReceived Alignment tokens received (>= minOut, enforced by the router).
    function acquireViaVZ(
        address zRouter,
        address zQuoter,
        address tokenOut,
        uint256 ethAmount,
        uint256 minOut,
        uint256 fallbackFeeOrHook,
        uint256 fallbackDeadline
    ) internal returns (uint256 amountReceived) {
        (bool ok, uint256 out) = _tryBestRoute(zRouter, zQuoter, tokenOut, ethAmount, minOut);
        if (ok) return out;

        (, amountReceived) = IBestRouteRouter(zRouter).swapVZ{ value: ethAmount }(
            address(this), false, fallbackFeeOrHook, address(0), tokenOut, 0, 0, ethAmount, minOut, fallbackDeadline
        );
    }

    /// @dev Query the on-chain quoter and, when the best route maps to a typed leg, execute it with
    ///      `minOut` as the `amountLimit`. Returns `(false, 0)` to signal the caller to use its
    ///      fixed-pool fallback: quoter unset, quoter reverts / is not a contract (caught), empty
    ///      route, or a source with no safe typed leg. `getQuotes` runs against ETH (`address(0)`) in.
    function _tryBestRoute(address zRouter, address zQuoter, address tokenOut, uint256 ethAmount, uint256 minOut)
        private
        returns (bool ok, uint256 amountReceived)
    {
        if (zQuoter == address(0)) return (false, 0);

        // The try/catch scopes ONLY the on-chain quote (a view call): a quoter that reverts or is not
        // a contract degrades to the fixed-pool fallback. The typed swap below is deliberately OUTSIDE
        // the catch so a swap revert — most importantly a `received < minOut` breach on the chosen best
        // route — propagates and reverts the convert, exactly as the fixed leg does today. A best route
        // is NEVER silently re-routed to a different pool on swap failure.
        IBestRouteQuoter.Quote memory best;
        try IBestRouteQuoter(zQuoter).getQuotes(false, address(0), tokenOut, ethAmount) returns (
            IBestRouteQuoter.Quote memory b, IBestRouteQuoter.Quote[] memory
        ) {
            best = b;
        } catch {
            return (false, 0); // quoter reverted / not a contract -> fallback
        }

        if (best.amountOut == 0) return (false, 0); // no viable route -> fallback

        IBestRouteQuoter.AMM source = best.source;

        if (source == IBestRouteQuoter.AMM.UNI_V4) {
            (, amountReceived) = IBestRouteRouter(zRouter).swapV4{ value: ethAmount }(
                address(this),
                false,
                uint24(best.feeBps * 100), // 1/5/30/100 bps -> 100/500/3000/10000 pips
                _spacingFromBps(uint16(best.feeBps)),
                address(0),
                tokenOut,
                ethAmount,
                minOut,
                block.timestamp
            );
        } else if (source == IBestRouteQuoter.AMM.ZAMM) {
            (, amountReceived) = IBestRouteRouter(zRouter).swapVZ{ value: ethAmount }(
                address(this),
                false,
                best.feeBps, // ZAMM feeOrHook
                address(0),
                tokenOut,
                0,
                0,
                ethAmount,
                minOut,
                block.timestamp // != type(uint256).max -> hooked ZAMM (matches vault's fixed leg)
            );
        } else if (source == IBestRouteQuoter.AMM.UNI_V3) {
            (, amountReceived) = IBestRouteRouter(zRouter).swapV3{ value: ethAmount }(
                address(this),
                false,
                uint24(best.feeBps * 100), // bps -> v3 fee units
                address(0),
                tokenOut,
                ethAmount,
                minOut,
                block.timestamp
            );
        } else if (source == IBestRouteQuoter.AMM.UNI_V2) {
            (, amountReceived) = IBestRouteRouter(zRouter).swapV2{ value: ethAmount }(
                address(this),
                false,
                address(0),
                tokenOut,
                ethAmount,
                minOut,
                block.timestamp // normal deadline -> Uniswap V2 factory
            );
        } else if (source == IBestRouteQuoter.AMM.SUSHI) {
            (, amountReceived) = IBestRouteRouter(zRouter).swapV2{ value: ethAmount }(
                address(this),
                false,
                address(0),
                tokenOut,
                ethAmount,
                minOut,
                type(uint256).max // sentinel -> SushiSwap factory (zRouter.swapV2 convention)
            );
        } else {
            return (false, 0); // unmappable source -> fallback (unreachable for zQuoterBase)
        }

        return (true, amountReceived);
    }

    /// @dev Recover the V4 tick spacing paired with a fee-in-bps by `zQuoterBase` (1/5/30/100 bps ->
    ///      1/10/60/200), mirroring `zQuoterBase._spacingFromBps` so the executed pool matches quote.
    function _spacingFromBps(uint16 bps) private pure returns (int24) {
        if (bps == 1) return 1;
        if (bps == 5) return 10;
        if (bps == 30) return 60;
        if (bps == 100) return 200;
        return int24(uint24(bps));
    }
}
