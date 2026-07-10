// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";

// ===== Mocks (all view-safe: the validator calls them under STATICCALL) =====

/// @notice Minimal Uniswap V3 pool exposing only `observe`, returning a settable tick-cumulative delta
///         as `[0, delta]` regardless of the requested lookbacks. `delta / window` is the mean tick.
contract MockV3Observe {
    int56 public cumulativeDelta;
    bool public revertObserve;

    function setDelta(int56 d) external {
        cumulativeDelta = d;
    }

    function setRevert(bool r) external {
        revertObserve = r;
    }

    function observe(uint32[] calldata)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(!revertObserve, "observe revert");
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = cumulativeDelta;
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
    }
}

/// @notice Minimal Algebra Integral volatility-oracle plugin (`getTimepoints` analogue of V3 `observe`).
contract MockAlgebraOracle {
    int56 public cumulativeDelta;
    bool public revertGet;

    function setDelta(int56 d) external {
        cumulativeDelta = d;
    }

    function setRevert(bool r) external {
        revertGet = r;
    }

    function getTimepoints(uint32[] calldata)
        external
        view
        returns (int56[] memory tickCumulatives, uint88[] memory volatilityCumulatives)
    {
        require(!revertGet, "getTimepoints revert");
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = cumulativeDelta;
        volatilityCumulatives = new uint88[](2);
    }
}

/// @notice Minimal Algebra pool exposing `plugin()` (the pool's hook, where the TWAP oracle lives).
contract MockAlgebraPool {
    address public pluginAddr;
    bool public revertPlugin;

    constructor(address p) {
        pluginAddr = p;
    }

    function setRevert(bool r) external {
        revertPlugin = r;
    }

    function plugin() external view returns (address) {
        require(!revertPlugin, "plugin revert");
        return pluginAddr;
    }
}

contract UniValidatorPinnedTwapTest is Test {
    UniswapVaultPriceValidator internal validator;

    // Mid-range WETH so tests can pick tokens on either side to exercise both token orderings.
    address internal constant WETH = address(0x8000000000000000000000000000000000000000);
    // token0IsWeth == false: WETH is the HIGHER address (token1), so rawPrice is already ETH-per-token.
    address internal constant TOKEN_LOW = address(0x0000000000000000000000000000000000000001);
    // token0IsWeth == true: WETH is the LOWER address (token0), so the price is inverted.
    address internal constant TOKEN_HIGH = address(0x9000000000000000000000000000000000000000);

    uint32 internal constant TWAP = 1800;

    function setUp() public {
        // v2Factory / v3Factory / poolManager are irrelevant to the pinned-pool path — pass zero.
        validator = new UniswapVaultPriceValidator(WETH, address(0), address(0), address(0), 1000, TWAP);
    }

    // ---- kind validation ----

    function test_kindGte2_reverts() public {
        MockV3Observe pool = new MockV3Observe();
        vm.expectRevert(abi.encodeWithSelector(UniswapVaultPriceValidator.UnsupportedPoolKind.selector, uint8(2)));
        validator.quoteEthForTokensVia(address(pool), 2, 0, TOKEN_LOW, 1e18);

        vm.expectRevert(abi.encodeWithSelector(UniswapVaultPriceValidator.UnsupportedPoolKind.selector, uint8(255)));
        validator.quoteEthForTokensVia(address(pool), 255, 0, TOKEN_LOW, 1e18);
    }

    function test_zeroAmount_returnsZero() public {
        MockV3Observe pool = new MockV3Observe();
        pool.setDelta(0);
        assertEq(validator.quoteEthForTokensVia(address(pool), 0, 0, TOKEN_LOW, 0), 0);
    }

    // ---- kind 0: Uniswap V3 observe path ----

    function test_v3_tickZero_isOneToOne_bothOrderings() public {
        MockV3Observe pool = new MockV3Observe();
        pool.setDelta(0); // mean tick 0 => price 1e18 => 1:1 regardless of orientation

        assertEq(validator.quoteEthForTokensVia(address(pool), 0, 0, TOKEN_LOW, 1e18), 1e18);
        assertEq(validator.quoteEthForTokensVia(address(pool), 0, 0, TOKEN_HIGH, 1e18), 1e18);
    }

    function test_v3_observeReverts_revertsUnavailable() public {
        MockV3Observe pool = new MockV3Observe();
        pool.setRevert(true);
        vm.expectRevert(UniswapVaultPriceValidator.ReferenceTwapUnavailable.selector);
        validator.quoteEthForTokensVia(address(pool), 0, 0, TOKEN_LOW, 1e18);
    }

    function test_v3_noCodePool_revertsUnavailable() public {
        // An address with no contract code: the high-level observe call reverts (extcodesize check),
        // which the validator normalizes to ReferenceTwapUnavailable rather than failing open.
        vm.expectRevert(UniswapVaultPriceValidator.ReferenceTwapUnavailable.selector);
        validator.quoteEthForTokensVia(address(0xBEEF), 0, 0, TOKEN_LOW, 1e18);
    }

    /// @dev window == 0 must fall back to the configured `twapSecondsAgo`. With a FIXED cumulative delta,
    ///      the mean tick is `delta / window`, so the result depends on the effective window: window==0 must
    ///      equal window==TWAP and differ from window==2*TWAP.
    function test_window_zeroFallsBackToConfigured() public {
        MockV3Observe pool = new MockV3Observe();
        pool.setDelta(6000); // arbitrary nonzero cumulative delta

        uint256 qZero = validator.quoteEthForTokensVia(address(pool), 0, 0, TOKEN_LOW, 1e18);
        uint256 qTwap = validator.quoteEthForTokensVia(address(pool), 0, TWAP, TOKEN_LOW, 1e18);
        uint256 qDouble = validator.quoteEthForTokensVia(address(pool), 0, 2 * TWAP, TOKEN_LOW, 1e18);

        assertEq(qZero, qTwap, "window 0 must use twapSecondsAgo");
        assertTrue(qZero != qDouble, "a different window must change the mean tick");
    }

    // ---- kind 1: Algebra plugin/oracle path ----

    function test_algebra_tickZero_isOneToOne() public {
        MockAlgebraOracle oracle = new MockAlgebraOracle();
        oracle.setDelta(0);
        MockAlgebraPool pool = new MockAlgebraPool(address(oracle));

        // MOCK plugin (not a live Cypher fork): exercises plugin() -> getTimepoints -> shared price math.
        assertEq(validator.quoteEthForTokensVia(address(pool), 1, 0, TOKEN_LOW, 1e18), 1e18);
        assertEq(validator.quoteEthForTokensVia(address(pool), 1, 0, TOKEN_HIGH, 1e18), 1e18);
    }

    function test_algebra_matchesV3_forSameDelta() public {
        // The Algebra path must produce the identical price as the V3 path for the same tick-cumulative delta.
        int56 delta = 6000;
        MockV3Observe v3 = new MockV3Observe();
        v3.setDelta(delta);
        MockAlgebraOracle oracle = new MockAlgebraOracle();
        oracle.setDelta(delta);
        MockAlgebraPool alg = new MockAlgebraPool(address(oracle));

        assertEq(
            validator.quoteEthForTokensVia(address(alg), 1, 0, TOKEN_LOW, 1e18),
            validator.quoteEthForTokensVia(address(v3), 0, 0, TOKEN_LOW, 1e18),
            "Algebra and V3 must share the mean-tick price math"
        );
    }

    function test_algebra_pluginZero_revertsUnavailable() public {
        MockAlgebraPool pool = new MockAlgebraPool(address(0));
        vm.expectRevert(UniswapVaultPriceValidator.ReferenceTwapUnavailable.selector);
        validator.quoteEthForTokensVia(address(pool), 1, 0, TOKEN_LOW, 1e18);
    }

    function test_algebra_getTimepointsReverts_revertsUnavailable() public {
        MockAlgebraOracle oracle = new MockAlgebraOracle();
        oracle.setRevert(true);
        MockAlgebraPool pool = new MockAlgebraPool(address(oracle));
        vm.expectRevert(UniswapVaultPriceValidator.ReferenceTwapUnavailable.selector);
        validator.quoteEthForTokensVia(address(pool), 1, 0, TOKEN_LOW, 1e18);
    }

    function test_algebra_pluginCallReverts_revertsUnavailable() public {
        MockAlgebraOracle oracle = new MockAlgebraOracle();
        MockAlgebraPool pool = new MockAlgebraPool(address(oracle));
        pool.setRevert(true); // plugin() itself reverts
        vm.expectRevert(UniswapVaultPriceValidator.ReferenceTwapUnavailable.selector);
        validator.quoteEthForTokensVia(address(pool), 1, 0, TOKEN_LOW, 1e18);
    }

    function test_algebra_noCodePool_revertsUnavailable() public {
        vm.expectRevert(UniswapVaultPriceValidator.ReferenceTwapUnavailable.selector);
        validator.quoteEthForTokensVia(address(0xBEEF), 1, 0, TOKEN_LOW, 1e18);
    }
}
