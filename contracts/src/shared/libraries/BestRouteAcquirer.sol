// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice On-chain best-route quote surface (zQuoter.getQuotes). Enum order MUST match the
///         upstream quoter's `AMM` for the source word to mean what we think it means; the names
///         and order here are the nine-member mainnet `zQuoter.AMM`, of which only the first five
///         are single-hop AMM sources this library knows how to execute. The other four are quoted
///         but deliberately unmapped, and degrade to the caller's fixed-pool fallback — no route is
///         ever dispatched through the generic `snwap`/`snwapMulti` executor (arbitrary-target +
///         arbitrary-calldata = drain surface).
///
///         MIRRORING AN UPSTREAM ENUM IS NOT ENOUGH ON ITS OWN, which is why `_tryBestRoute` range-
///         checks the source word before it ever becomes an `AMM`. See the note there: upstream
///         ships new immutable versions rather than editing in place, so a member we have never
///         seen is a routine event and must not be able to revert an acquisition.
///
///         The declared return type below is the shape documentation and the selector source. It is
///         NOT what the reply is decoded through — `_tryBestRoute` decodes the head by hand.
///
///         THESE NAMES ARE MAINNET'S AND ARE NOT PORTABLE ACROSS CHAINS. Base's quoter is not merely
///         a differently-sized `AMM` — it puts AERO at index 1, where this enum reads SUSHI, so a
///         Base deployment must re-derive the mapping rather than reuse it. The range check keeps an
///         unknown index safe; it cannot keep a *reused* index honest.
interface IBestRouteQuoter {
    enum AMM {
        UNI_V2,
        SUSHI,
        ZAMM,
        UNI_V3,
        UNI_V4,
        CURVE,
        LIDO,
        WETH_WRAP,
        V4_HOOKED
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
///        floor: engaged when the quoter is unset, reverts, is not a contract, answers too short,
///        returns an empty route, or reports a source this library does not map. This keeps today's
///        behavior intact when best-route is unavailable, and NOTHING a quoter returns can revert
///        the quote read — see `_tryBestRoute` on why that needed a hand decode.
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
    ///      fixed-pool fallback: quoter unset, quoter reverts, quoter is not a contract, reply too
    ///      short, unrecognised source word, empty route, or a source with no safe typed leg.
    ///      `getQuotes` runs against ETH (`address(0)`) in.
    ///
    ///      WHY THIS IS A `staticcall` AND A HAND DECODE, NOT `try`/`catch`. A Solidity
    ///      `try C(a).f() returns (T) { } catch { }` does NOT catch a failure to decode the REPLY:
    ///      the callee returns successfully and the decode then runs in OUR frame, after the catch
    ///      has stopped applying. Measured in `BestRouteAcquirer.t.sol` — with the reply decoded
    ///      through a typed five-member `AMM`, a quoter answering `source == 5` and a quoter with no
    ///      code at all BOTH propagate a revert past the catch, and the designed "unmappable source
    ///      -> fallback" branch below is never reached. That is not a hypothetical drift: the
    ///      mainnet `zQuoter.AMM` carries nine members, upstream ships new immutable versions rather
    ///      than editing in place, and the operator wires the address by hand via `setZQuoter`. The
    ///      blast radius of getting it wrong is every acquisition on every family at once, with
    ///      `setZQuoter(0)` on each factory as the only recovery.
    ///
    ///      So the reply is taken as raw bytes and the source word is RANGE-CHECKED BEFORE it is
    ///      cast to `AMM`. A member we have never seen — a tenth one, after this enum was widened to
    ///      upstream's nine — degrades to the fallback like any other unmappable source. Nothing the
    ///      quoter can return reverts here.
    ///
    ///      The typed swap below is deliberately OUTSIDE all of this so a swap revert — most
    ///      importantly a `received < minOut` breach on the chosen best route — propagates and
    ///      reverts the convert, exactly as the fixed leg does today. A best route is NEVER silently
    ///      re-routed to a different pool on swap failure.
    function _tryBestRoute(address zRouter, address zQuoter, address tokenOut, uint256 ethAmount, uint256 minOut)
        private
        returns (bool ok, uint256 amountReceived)
    {
        if (zQuoter == address(0)) return (false, 0);

        (bool called, bytes memory reply) =
            zQuoter.staticcall(abi.encodeCall(IBestRouteQuoter.getQuotes, (false, address(0), tokenOut, ethAmount)));
        if (!called) return (false, 0); // quoter reverted -> fallback

        // `(Quote best, Quote[] quotes)`: `Quote` is four static words, so `best` is inlined in the
        // head and the fifth word is the offset to `quotes`. Requiring the whole head rejects a reply
        // from an address with no code (empty returndata) and any other truncated answer. `quotes` is
        // deliberately left undecoded — it is never read, and not decoding it is one less surface.
        if (reply.length < 0xa0) return (false, 0);

        (uint256 rawSource, uint256 feeBps,, uint256 amountOut) =
            abi.decode(reply, (uint256, uint256, uint256, uint256));

        if (amountOut == 0) return (false, 0); // no viable route -> fallback
        // The range check the typed decode could not do for us. Unknown member -> fallback.
        if (rawSource > uint256(type(IBestRouteQuoter.AMM).max)) return (false, 0);

        IBestRouteQuoter.AMM source = IBestRouteQuoter.AMM(rawSource);

        if (source == IBestRouteQuoter.AMM.UNI_V4) {
            // Both casts below are lossy above `type(uint16).max`, and they truncate DIFFERENTLY —
            // a fee that overflowed would pick one pool for the swap and a tick spacing derived from
            // another number entirely. Refuse rather than swap through whatever that lands on. The
            // real tiers are 1/5/30/100 bps, so this rejects nothing a working quoter reports.
            if (feeBps > type(uint16).max) return (false, 0);
            (, amountReceived) = IBestRouteRouter(zRouter).swapV4{ value: ethAmount }(
                address(this),
                false,
                uint24(feeBps * 100), // 1/5/30/100 bps -> 100/500/3000/10000 pips
                _spacingFromBps(uint16(feeBps)),
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
                feeBps, // ZAMM feeOrHook — a full uint256 (may encode a hook address), NOT a bps
                address(0),
                tokenOut,
                0,
                0,
                ethAmount,
                minOut,
                block.timestamp // != type(uint256).max -> hooked ZAMM (matches vault's fixed leg)
            );
        } else if (source == IBestRouteQuoter.AMM.UNI_V3) {
            if (feeBps > type(uint16).max) return (false, 0); // see the UNI_V4 note on the cast
            (, amountReceived) = IBestRouteRouter(zRouter).swapV3{ value: ethAmount }(
                address(this),
                false,
                uint24(feeBps * 100), // bps -> v3 fee units
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
            // CURVE / LIDO / WETH_WRAP / V4_HOOKED: quoted by upstream, no typed leg here. Reached,
            // not unreachable — this is the branch the old typed decode reverted before ever getting to.
            return (false, 0);
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
