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
        validator = new UniswapVaultPriceValidator(WETH, address(0), address(0), 1000, TWAP);
    }

    // ---- kind validation ----

    /// @dev Kind 1 was the Algebra reference family, and it left the tree when CYPHER wound down.
    ///      The parameter stays so a second oracle family can be added without moving this signature,
    ///      but 0 is the only value served today. Pinned across the retired ordinal as well as the
    ///      never-assigned ones, so re-introducing a family means re-introducing its branch here
    ///      rather than having a stale caller silently read an Algebra pool through the V3 `observe`.
    function test_kindNonZero_reverts() public {
        MockV3Observe pool = new MockV3Observe();

        uint8[3] memory kinds = [uint8(1), 2, 255];
        for (uint256 i = 0; i < kinds.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(UniswapVaultPriceValidator.UnsupportedPoolKind.selector, kinds[i]));
            validator.quoteEthForTokensVia(address(pool), kinds[i], 0, TOKEN_LOW, 1e18);
        }
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
}
