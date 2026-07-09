// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Configurable stand-in for zQuoter.getQuotes used to unit-test BestRouteAcquirer.
///         Mirrors the ABI the acquirer decodes: the 5-source AMM enum and the Quote tuple. Can be
///         told to return a specific best route, an empty (no-route) best, or to revert the view
///         call — exercising the acquirer's typed-dispatch, empty-route fallback, and quoter-revert
///         fallback paths respectively.
contract MockZQuoter {
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

    Quote internal _best;
    bool public shouldRevert;

    error MockQuoterReverted();

    /// @notice Set the best route the mock reports (amountOut == 0 signals no viable route).
    function setBest(AMM source, uint256 feeBps, uint256 amountIn, uint256 amountOut) external {
        _best = Quote(source, feeBps, amountIn, amountOut);
    }

    /// @notice Force getQuotes to revert (models an undeployed/broken quoter).
    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function getQuotes(
        bool,
        /*exactOut*/
        address,
        /*tokenIn*/
        address,
        /*tokenOut*/
        uint256 /*swapAmount*/
    )
        external
        view
        returns (Quote memory best, Quote[] memory quotes)
    {
        if (shouldRevert) revert MockQuoterReverted();
        best = _best;
        quotes = new Quote[](1);
        quotes[0] = _best;
    }
}
