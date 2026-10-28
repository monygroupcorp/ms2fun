// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SepoliaRouteQuoter
/// @notice The on-chain best-route quoter for the Sepolia showcase: the address `cfg.zQuoter`
///         carries on this network, which makes `BestRouteAcquirer._tryBestRoute` a live path here.
///
///         Sepolia has no canonical quoter to point at, and the vendored upstream sources cannot
///         stand in: `lib/zRouter/base/zQuoter.sol` forwards every call to a hardcoded Base-chain
///         address, and all vendored variants pragma above this tree's `solc = "0.8.28"`. The
///         Anvil fork brings its own quoter the same way (`AnvilFixedRouteQuoter`).
///
///         This is a route table, not a price oracle and not a search. It answers ETH -> token with
///         the venue the seed has put depth into, and compares no venues: each showcase asset has
///         one seeded pool per vault that acquires it.
///
///         The table is keyed by (vault, token) because one asset sits on more than one venue: MS2
///         is both the Uniswap V4 target and the ZAMM target, held by different vaults that each
///         floor their convert against their own venue's price authority. A token-only key would
///         route the ZAMM vault into the Uniswap pool, and the ZAMM leg would never execute.
///         `BestRouteAcquirer` is inlined into its vault, so `getQuotes` sees the vault as
///         `msg.sender`; the acquirer asks the same question and decodes the same reply as on
///         mainnet.
///
///         `amountOut` is a flag, not a price. `BestRouteAcquirer` reads it only as a non-zero
///         "route exists" test; the bound the swap executes against is the vault's own
///         oracle-derived floor, which this contract cannot influence.
///
///         An unregistered (vault, token) pair is answered with an empty route, which
///         `BestRouteAcquirer` reads as "no viable route" and degrades to the vault's own fixed
///         leg. Such a vault behaves exactly as with no quoter wired, which is also the right answer
///         for a vault whose venue the acquirer has no typed leg for.
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
    /// @dev `set` is stored because every other field has a legitimate zero: `UNI_V2` is source 0
    ///      and a ZAMM pool may run `feeOrHook == 0`. Absence routes a vault to its own fixed leg, so
    ///      it must be distinguishable from a zeroed row.
    struct Route {
        AMM source;
        uint256 feeOrHook;
        bool set;
    }

    error NotOperator();
    error InvalidRoute();

    event RouteSet(address indexed vault, address indexed token, AMM source, uint256 feeOrHook);
    event RouteCleared(address indexed vault, address indexed token);
    event OperatorTransferred(address indexed from, address indexed to);

    /// @notice The only account that may write the table. Starts as the deployer and moves with
    ///         `setOperator`.
    /// @dev Not `immutable`: `MigrateOwnership` leaves no capability on the deployer EOA, so the
    ///      operator must be transferable to governance.
    address public operator;

    /// @notice vault -> tokenOut -> the route that vault acquires that token through.
    mapping(address => mapping(address => Route)) public routeOf;

    constructor(address _operator) {
        operator = _operator;
    }

    /// @notice Register the venue `vault` acquires `token` through.
    /// @dev Called by the seed once a vault exists and the pool it will swap in has depth. Register
    ///      the pool the depth went into: a venue with no depth points converts at an empty pool,
    ///      where the vault's oracle floor refuses them.
    ///
    ///      A vault whose venue has no typed leg gets no row. `BestRouteAcquirer` dispatches to
    ///      `swapV2/V3/V4/VZ` only; any other venue is reached through the fallback, and an empty
    ///      route is how a vault says "I cannot route this". The four upstream members this contract
    ///      quotes but cannot execute are therefore refused, since a stored row for one would only
    ///      degrade to the fallback and mislead a reader.
    /// @param feeOrHook The source's second word as `BestRouteAcquirer` will use it: V3/V4 fee in the
    ///        quoter ABI's BPS units (30 -> the fee-3000 / spacing-60 pool), the full ZAMM `feeOrHook`
    ///        word for `ZAMM`, and unused — so required zero — for the two V2 legs.
    function setRoute(address vault, address token, AMM source, uint256 feeOrHook) external {
        if (msg.sender != operator) revert NotOperator();
        if (vault == address(0) || token == address(0)) revert InvalidRoute();
        if (uint256(source) > uint256(AMM.UNI_V4)) revert InvalidRoute(); // no typed leg
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

    /// @notice Hand the table's write permission to another account, the governance Timelock at the
    ///         ownership handover.
    /// @dev Single-step, unlike the two-step `SafeOwnableUUPS` handover: the table is rebuildable
    ///      and a missing row degrades to the vault's fixed-pool leg, so a mis-sent operator costs
    ///      at most a quoter redeployed and re-pointed with `setZQuoter`. The zero address is
    ///      refused because it would freeze the table permanently with every existing row live.
    function setOperator(address newOperator) external {
        if (msg.sender != operator) revert NotOperator();
        if (newOperator == address(0)) revert InvalidRoute();
        emit OperatorTransferred(operator, newOperator);
        operator = newOperator;
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
