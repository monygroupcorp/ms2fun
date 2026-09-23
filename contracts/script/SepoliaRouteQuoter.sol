// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SepoliaRouteQuoter
/// @notice The on-chain best-route quoter for the Sepolia showcase — the address `cfg.zQuoter`
///         carries on this network, and the reason `BestRouteAcquirer._tryBestRoute` is a live path
///         here rather than dead scaffolding.
///
///         WHY A QUOTER IS WRITTEN RATHER THAN WIRED. `DeployCore` takes `cfg.zQuoter` as operator
///         input, and on Ethereum mainnet it is: a canonical quoter is deployed there and the
///         operator points at it. There is no such deployment on Sepolia, and the vendored upstream
///         sources cannot stand in for one — `lib/zRouter/base/zQuoter.sol` is a lens that forwards
///         every call to a hardcoded BASE-chain address, and all three vendored variants are pinned
///         above this tree's `solc = "0.8.28"`. So a showcase that wants the seam exercised has to
///         bring its own, exactly as the Anvil fork does (`AnvilFixedRouteQuoter`).
///
///         WHAT IT IS AND IS NOT. This is a ROUTE TABLE, not a price oracle and not a search. It
///         answers ETH -> token with the venue the seed has already put depth into, and it performs
///         no comparison between venues, because on this network there is nothing to compare: each
///         showcase asset has exactly one seeded pool per vault that acquires it.
///
///         WHY THE TABLE IS KEYED BY THE VAULT THAT ASKS, AND NOT BY THE TOKEN ALONE. The showcase
///         deliberately carries one asset across more than one venue: MS2 is the Uniswap V4 target
///         AND the ZAMM target. Those are different vaults, LPing on different venues, each flooring
///         its convert against its own venue's price authority. A table keyed by token alone cannot
///         tell them apart: one UNI_V4 row for MS2 answers the ZAMM vault too, and that vault buys on
///         the Uniswap pool instead, against a floor derived from its own venue's TWAP. The ZAMM leg
///         the showcase exists to rehearse would then never execute on this chain at all.
///
///         `BestRouteAcquirer` is inlined into its vault, so `getQuotes` sees the VAULT as
///         `msg.sender`, and a row is registered against it. Nothing about the caller changes: the
///         acquirer asks the same question and decodes the same reply it will on mainnet. What
///         changes is that this table can say "this vault acquires on its own venue", which on this
///         ABI is said by having no row — see the note on `setRoute`.
///
///         `amountOut` IS A FLAG, NOT A PRICE. `BestRouteAcquirer` reads it only as a non-zero
///         "route exists" test; the bound the swap actually executes against is the vault's own
///         oracle-derived floor, from the price authority its family pins, which this contract
///         cannot influence. Reading a price out of this return value would be wrong.
///
///         AN UNREGISTERED (VAULT, TOKEN) PAIR IS ANSWERED WITH AN EMPTY ROUTE, which
///         `BestRouteAcquirer` reads as "no viable route" and degrades to the vault's own fixed leg.
///         So a vault this quoter has not been told about behaves byte-for-byte as it would with no
///         quoter wired at all — which is what makes deploying it before the roster exists safe, and
///         what makes it the right answer for a vault whose venue the acquirer has no typed leg for.
contract SepoliaRouteQuoter {
    /// @dev Mirrors the upstream nine-member `zQuoter.AMM` that `BestRouteAcquirer` decodes against.
    ///      The last four are declared so the ABI this contract presents is the ABI the acquirer
    ///      expects, and so a widening upstream is visible here; they are refused as route sources.
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

    /// @notice One row: the venue a single vault acquires a single token on.
    /// @dev `set` is carried rather than inferred, because every field a row holds has a legitimate
    ///      zero — `UNI_V2` is source 0, and a ZAMM pool may genuinely run `feeOrHook == 0`. Absence
    ///      is the answer that routes a vault to its own fixed leg, so it must not be guessable.
    struct Route {
        AMM source;
        uint256 feeOrHook;
        bool set;
    }

    error NotOperator();
    error InvalidRoute();

    event RouteSet(address indexed vault, address indexed token, AMM source, uint256 feeOrHook);
    event RouteCleared(address indexed vault, address indexed token);

    /// @notice The deployer, and the only account that may write the table.
    address public immutable operator;

    /// @notice vault -> tokenOut -> the route that vault acquires that token through.
    mapping(address => mapping(address => Route)) public routeOf;

    constructor(address _operator) {
        operator = _operator;
    }

    /// @notice Register the venue `vault` acquires `token` through.
    /// @dev Called by the seed once a vault exists and the pool it will swap in has depth. The
    ///      pairing matters and is not automatic: registering a venue the seed has not filled points
    ///      converts at an empty pool, where the vault's oracle floor will refuse them. Register the
    ///      pool the depth went into, and no other.
    ///
    ///      A VAULT WHOSE VENUE HAS NO TYPED LEG GETS NO ROW. `BestRouteAcquirer` dispatches to
    ///      `swapV2/V3/V4/VZ` and nothing else; a vault on any other venue reaches it through the
    ///      fallback by design. The honest row for such a vault is no row: "I cannot route this" is
    ///      what an empty route means, and it is
    ///      what puts the vault on the venue it LPs into. Hence the refusal below of the four
    ///      upstream members this library quotes but cannot execute — storing one would be storing a
    ///      row that can only degrade to the fallback, indistinguishable in effect from absence and
    ///      misleading to read.
    /// @param feeOrHook The source's second word as `BestRouteAcquirer` will use it: V3/V4 fee in the
    ///        quoter ABI's BPS units (30 -> the fee-3000 / spacing-60 pool), the full ZAMM `feeOrHook`
    ///        word for `ZAMM`, and unused — so required zero — for the two V2 legs.
    function setRoute(address vault, address token, AMM source, uint256 feeOrHook) external {
        if (msg.sender != operator) revert NotOperator();
        if (vault == address(0) || token == address(0)) revert InvalidRoute();
        if (uint256(source) > uint256(AMM.UNI_V4)) revert InvalidRoute(); // no typed leg — see above
        // The acquirer casts a V3/V4 fee to `uint24(feeOrHook * 100)` and `uint16(feeOrHook)`;
        // anything wider is refused there as a truncation risk, so refuse it at the source rather
        // than store a route that silently degrades every convert to the fallback.
        if ((source == AMM.UNI_V4 || source == AMM.UNI_V3) && feeOrHook > type(uint16).max) {
            revert InvalidRoute();
        }
        // `swapV2` carries no fee word at all (the factory is chosen by the deadline sentinel), so a
        // fee stored against one would be a number nothing reads.
        if ((source == AMM.UNI_V2 || source == AMM.SUSHI) && feeOrHook != 0) revert InvalidRoute();

        routeOf[vault][token] = Route({ source: source, feeOrHook: feeOrHook, set: true });
        emit RouteSet(vault, token, source, feeOrHook);
    }

    /// @notice Drop a row, returning that vault to its own fixed-pool leg for that token.
    function clearRoute(address vault, address token) external {
        if (msg.sender != operator) revert NotOperator();
        delete routeOf[vault][token];
        emit RouteCleared(vault, token);
    }

    /// @notice The `zQuoter.getQuotes` surface `BestRouteAcquirer` calls.
    /// @dev Native ETH in only (`tokenIn == address(0)`), which is the only shape the acquirer asks.
    ///      `msg.sender` is the vault: the acquirer is an inlined internal library, so the staticcall
    ///      leaves the vault's own frame.
    function getQuotes(bool, address tokenIn, address tokenOut, uint256 swapAmount)
        external
        view
        returns (Quote memory best, Quote[] memory quotes)
    {
        Route memory route = routeOf[msg.sender][tokenOut];
        if (!route.set || tokenIn != address(0) || swapAmount == 0) {
            return (best, new Quote[](0));
        }
        best = Quote({ source: route.source, feeBps: route.feeOrHook, amountIn: swapAmount, amountOut: 1 });
        quotes = new Quote[](1);
        quotes[0] = best;
    }
}
