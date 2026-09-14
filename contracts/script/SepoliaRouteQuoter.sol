// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SepoliaRouteQuoter
/// @notice The on-chain best-route quoter for the Sepolia showcase — the address `cfg.zQuoter`
///         carries on this network, and the reason `BestRouteAcquirer._tryBestRoute` is a live path
///         here rather than dead scaffolding.
///
///         WHY A QUOTER IS WRITTEN RATHER THAN WIRED. `DeployCore` calls `cfg.zQuoter` operator
///         input, and on Ethereum mainnet it is: a canonical quoter is deployed there and the
///         operator points at it. There is no such deployment on Sepolia, and the vendored upstream
///         sources cannot stand in for one — `lib/zRouter/base/zQuoter.sol` is a lens that forwards
///         every call to a hardcoded BASE-chain address, and all three vendored variants are pinned
///         above this tree's `solc = "0.8.28"`. So a showcase that wants the seam exercised has to
///         bring its own, exactly as the Anvil fork does (`AnvilFixedRouteQuoter`).
///
///         WHAT IT IS AND IS NOT. This is a ROUTE TABLE, not a price oracle and not a search. It
///         answers ETH -> token for tokens an operator has registered, and reports the Uniswap V4
///         tier they were registered at. It performs no comparison between venues, because on this
///         network there is nothing to compare: `SeedSepoliaShared` stands the whole showcase up on
///         ONE fee tier, so the pool a vault LPs into, the pool the registry curates as its route,
///         and the pool the acquire leg swaps through are the same pool by construction.
///
///         WHAT IT THEREFORE BUYS, since it names the tier the fixed fallback would have used
///         anyway: the acquisition path the showcase rehearses is the one mainnet will run. Without
///         a quoter, every Sepolia convert takes the fallback leg and `_tryBestRoute` — the quote
///         read, the source decode, the typed dispatch — ships to mainnet never having executed on a
///         real chain. With one, every convert on the wall goes through it.
///
///         `amountOut` IS A FLAG, NOT A PRICE. `BestRouteAcquirer` reads it only as a non-zero
///         "route exists" test; the bound the swap actually executes against is the vault's own
///         oracle-derived floor, from the DAO-pinned reference pool, which this contract cannot
///         influence. Reading a price out of this return value would be wrong.
///
///         AN UNREGISTERED TOKEN IS ANSWERED WITH AN EMPTY ROUTE, which `BestRouteAcquirer` reads as
///         "no viable route" and degrades to the vault's fixed pool. So a vault this quoter has not
///         been told about behaves byte-for-byte as it would with no quoter wired at all — which is
///         what makes deploying it before the roster exists safe.
contract SepoliaRouteQuoter {
    /// @dev Mirrors the upstream nine-member `zQuoter.AMM` that `BestRouteAcquirer` decodes against.
    ///      Only `UNI_V4` is ever reported here; the rest are declared so the ABI this contract
    ///      presents is the ABI the acquirer expects, and so a widening upstream is visible here.
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

    error NotOperator();
    error InvalidRoute();

    event RouteSet(address indexed token, uint256 feeBps);

    /// @notice The deployer, and the only account that may register a route.
    address public immutable operator;

    /// @notice tokenOut -> Uniswap V4 fee in the quoter ABI's BPS units. Zero = no route, and the
    ///         acquirer falls back. `BestRouteAcquirer` multiplies by 100 for the pool fee and maps
    ///         the bps to the paired tick spacing, so 30 here is the fee-3000 / spacing-60 pool.
    mapping(address => uint256) public routeFeeBps;

    constructor(address _operator) {
        operator = _operator;
    }

    /// @notice Register (or clear, with `feeBps == 0`) the V4 tier this token is acquired through.
    /// @dev Called by the seed once a roster token exists and its pool has been given depth. The
    ///      pairing matters and is not automatic: registering a tier the seed has not filled points
    ///      converts at an empty pool, where the vault's oracle floor will refuse them. Register the
    ///      tier the depth went into, and no other.
    function setRoute(address token, uint256 feeBps) external {
        if (msg.sender != operator) revert NotOperator();
        if (token == address(0)) revert InvalidRoute();
        // The acquirer casts this to `uint24(feeBps * 100)` and `uint16(feeBps)`; anything wider is
        // refused there as a truncation risk, so refuse it at the source rather than store a route
        // that silently degrades every convert to the fallback.
        if (feeBps > type(uint16).max) revert InvalidRoute();
        routeFeeBps[token] = feeBps;
        emit RouteSet(token, feeBps);
    }

    /// @notice The `zQuoter.getQuotes` surface `BestRouteAcquirer` calls.
    /// @dev Native ETH in only (`tokenIn == address(0)`), which is the only shape the acquirer asks.
    function getQuotes(bool, address tokenIn, address tokenOut, uint256 swapAmount)
        external
        view
        returns (Quote memory best, Quote[] memory quotes)
    {
        uint256 feeBps = routeFeeBps[tokenOut];
        if (tokenIn != address(0) || feeBps == 0 || swapAmount == 0) {
            return (best, new Quote[](0));
        }
        best = Quote({ source: AMM.UNI_V4, feeBps: feeBps, amountIn: swapAmount, amountOut: 1 });
        quotes = new Quote[](1);
        quotes[0] = best;
    }
}
