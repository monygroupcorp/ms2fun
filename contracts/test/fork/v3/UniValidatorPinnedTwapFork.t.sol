// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ForkTestBase } from "../helpers/ForkTestBase.sol";
import { UniswapVaultPriceValidator } from "../../../src/peripherals/UniswapVaultPriceValidator.sol";

/**
 * @title UniValidatorPinnedTwapFork
 * @notice Fork tests for {UniswapVaultPriceValidator.quoteEthForTokensVia} against a deep, mature
 *         Uniswap V3 pool (WETH/USDC 0.3%). Self-skips when run without a fork (WETH has no code).
 * @dev Run with: forge test --mp test/fork/v3/UniValidatorPinnedTwapFork.t.sol --fork-url $MAINNET_RPC_URL -vv
 */
contract UniValidatorPinnedTwapForkTest is ForkTestBase {
    UniswapVaultPriceValidator internal validator;

    function setUp() public {
        loadAddresses(); // vm.skip(true) if not forked
        validator = new UniswapVaultPriceValidator(
            WETH, UNISWAP_V2_FACTORY, UNISWAP_V3_FACTORY, UNISWAP_V4_POOL_MANAGER, 1000, 1800
        );
    }

    /// @notice The pinned V3 read must equal the shotgun quote on the SAME pool: the shotgun tries the
    ///         0.3% tier first (== WETH_USDC_V3_03), same window (1800s), same mean-tick math.
    function test_via_matchesShotgun_onDeepV3Pool() public {
        uint256 amount = 1_000e6; // 1,000 USDC (6 decimals)

        uint256 viaQuote = validator.quoteEthForTokensVia(WETH_USDC_V3_03, 0, 0, USDC, amount);
        uint256 shotgun = validator.quoteEthForTokens(USDC, amount);

        assertGt(viaQuote, 0, "pinned read must produce a nonzero ETH value");
        assertEq(viaQuote, shotgun, "pinned V3 read must match the shotgun on the same pool");

        // Sanity band: 1,000 USDC is well under 10 ETH and comfortably over 0.001 ETH at any realistic price.
        assertLt(viaQuote, 10 ether, "quote implausibly high");
        assertGt(viaQuote, 0.001 ether, "quote implausibly low");
    }

    /// @notice Explicit window equal to the configured default must match the window==0 fallback.
    function test_via_explicitWindowMatchesDefault() public {
        uint256 amount = 1_000e6;
        uint256 qZero = validator.quoteEthForTokensVia(WETH_USDC_V3_03, 0, 0, USDC, amount);
        uint256 qExplicit = validator.quoteEthForTokensVia(WETH_USDC_V3_03, 0, 1800, USDC, amount);
        assertEq(qZero, qExplicit, "window 0 must equal the configured twapSecondsAgo");
    }

    /// @notice No fail-open: a non-pool address (no observation history / no code) must revert.
    function test_via_revertsOnNoObservationHistory() public {
        // Skip cleanly when not forked (setUp's vm.skip already handles it, but guard the assertion too).
        if (WETH.code.length == 0) return;
        vm.expectRevert(UniswapVaultPriceValidator.ReferenceTwapUnavailable.selector);
        validator.quoteEthForTokensVia(address(0xdead), 0, 0, USDC, 1_000e6);
    }
}
