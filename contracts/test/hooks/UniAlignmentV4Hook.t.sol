// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { BalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { BeforeSwapDelta, BeforeSwapDeltaLibrary } from "v4-core/types/BeforeSwapDelta.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { LPFeeLibrary } from "v4-core/libraries/LPFeeLibrary.sol";
import { UniAlignmentV4Hook } from "../../src/factories/erc404/hooks/UniAlignmentV4Hook.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/**
 * @title UniAlignmentV4HookTest
 * @notice Unit tests for UniAlignmentV4Hook's pure/config surface — constructor validation, immutables,
 *         owner-only LP-fee management, the beforeSwap LP-fee override, and the poolManager-only guards.
 * @dev These tests drive the REAL `UniAlignmentV4Hook` (deployed via `deployCodeTo` at a 0xCC-permission
 *      address so its constructor's `validateHookPermissions()` passes) — NOT a hand-written mirror.
 *      A mirror of the hook's swap logic drifted once (the #109 Option-B move of the ETH-buy tithe from
 *      afterSwap into beforeSwap) and would drift again; the durable fix is to stop mirroring. The full
 *      swap-shape / fee-settlement / queue-flush behavior is proven against a REAL v4-core PoolManager in
 *      `UniAlignmentV4Hook_RealSettlement.t.sol` (the single source of swap-behavior truth). These tests
 *      therefore never drive a swap through a PoolManager — they exercise only the surface callable
 *      directly on the hook with a placeholder manager address.
 */
contract UniAlignmentV4HookTest is Test {
    UniAlignmentV4Hook public hook;
    MockVault public mockVault;

    /// @notice Non-contract placeholder manager: the constructor only needs it non-zero, and the
    ///         guard/override tests prank it as `msg.sender` to satisfy `onlyPoolManager` (no swap is ever
    ///         routed through it).
    address public poolManagerPlaceholder = address(0xBEEF);

    address public owner = address(0x1);
    address public alice = address(0x2);

    address public constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address public mockToken = address(0x2222222222222222222222222222222222222222);
    /// @notice The fixed project instance the hook credits — distinct from any swapper/router address.
    address public projectInstance = address(0x7777777777777777777777777777777777777777);

    uint256 constant DEFAULT_HOOK_FEE_BIPS = 100; // 1%
    uint24 constant DEFAULT_LP_FEE_RATE = 3000; // 0.3%

    // Events (must match production)
    event LpFeeRateUpdated(uint24 newRate);

    function setUp() public {
        mockVault = new MockVault();

        // Deploy the REAL hook at a 0xCC-permission address so validateHookPermissions() passes.
        // 0xCC = beforeSwap|afterSwap|beforeSwapReturnDelta|afterSwapReturnDelta in the low 14 bits.
        deployCodeTo(
            "UniAlignmentV4Hook.sol:UniAlignmentV4Hook",
            _ctorArgs(projectInstance, DEFAULT_HOOK_FEE_BIPS),
            _hookAddr(0x4242)
        );
        hook = UniAlignmentV4Hook(payable(_hookAddr(0x4242)));
    }

    // ========== Helpers ==========

    function _hookAddr(uint160 seed) internal pure returns (address) {
        return address((seed << 14) | uint160(0x00CC));
    }

    function _ctorArgs(address benefactor, uint256 hookFeeBips) internal view returns (bytes memory) {
        return abi.encode(
            IPoolManager(poolManagerPlaceholder),
            IAlignmentVault(payable(address(mockVault))),
            WETH,
            owner,
            benefactor,
            hookFeeBips,
            DEFAULT_LP_FEE_RATE
        );
    }

    /// @notice Realistic pool key: currency0=native ETH, currency1=token
    function _ethTokenPoolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)), // Native ETH — always currency0
            currency1: Currency.wrap(mockToken),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    /// @notice A sell (zeroForOne=false) so beforeSwap's shape-1 (exact-input ETH buy) fee branch is NOT
    ///         taken — the override tests assert the LP-fee override in isolation, without routing a take
    ///         through the placeholder manager.
    function _sellParams(uint256 tokenAmount) internal pure returns (IPoolManager.SwapParams memory) {
        return
            IPoolManager.SwapParams({ zeroForOne: false, amountSpecified: -int256(tokenAmount), sqrtPriceLimitX96: 0 });
    }

    // ========== Initialization Tests ==========

    function test_constructor_storesParametersCorrectly() public view {
        assertEq(address(hook.poolManager()), poolManagerPlaceholder);
        assertEq(address(hook.vault()), address(mockVault));
        assertEq(hook.owner(), owner);
    }

    function test_constructor_setsImmutableHookFee() public view {
        assertEq(hook.hookFeeBips(), DEFAULT_HOOK_FEE_BIPS, "hookFeeBips should be set at deploy");
    }

    function test_constructor_setsInitialLpFeeRate() public view {
        assertEq(hook.lpFeeRate(), DEFAULT_LP_FEE_RATE, "lpFeeRate should be set at deploy");
    }

    function test_constructor_setsImmutableBenefactor() public view {
        assertEq(hook.benefactor(), projectInstance, "benefactor should be set at deploy");
    }

    function test_constructor_rejectsZeroBenefactor() public {
        // The ctor's zero-benefactor guard reverts before validateHookPermissions; deployCodeTo bubbles it.
        vm.expectRevert(UniAlignmentV4Hook.InvalidAddress.selector);
        deployCodeTo(
            "UniAlignmentV4Hook.sol:UniAlignmentV4Hook", _ctorArgs(address(0), DEFAULT_HOOK_FEE_BIPS), _hookAddr(0x4243)
        );
    }

    // ========== hookFeeBips Immutability ==========

    function test_hookFeeBips_isImmutable() public view {
        // hookFeeBips is immutable — no setter exists. This test documents the design: it can only be set
        // at construction. There is no setHookFeeBips() on the hook.
        assertEq(hook.hookFeeBips(), DEFAULT_HOOK_FEE_BIPS);
    }

    // ========== Fee Calculation (pure arithmetic) ==========

    function test_feeCalculation_standardRate() public pure {
        uint256 ethMoved = 1000e18;
        uint256 expectedFee = (ethMoved * DEFAULT_HOOK_FEE_BIPS) / 10000;
        assertEq(expectedFee, 10e18, "1% of 1000e18 = 10e18");
    }

    // ========== LP Fee Rate Management ==========

    function test_setLpFeeRate_byOwner() public {
        vm.prank(owner);
        hook.setLpFeeRate(5000);
        assertEq(hook.lpFeeRate(), 5000);
    }

    function test_setLpFeeRate_validRates() public {
        vm.startPrank(owner);

        hook.setLpFeeRate(0);
        assertEq(hook.lpFeeRate(), 0, "Should allow 0 LP fee");

        hook.setLpFeeRate(3000);
        assertEq(hook.lpFeeRate(), 3000, "Should allow 3000 (0.3%)");

        hook.setLpFeeRate(uint24(LPFeeLibrary.MAX_LP_FEE));
        assertEq(hook.lpFeeRate(), uint24(LPFeeLibrary.MAX_LP_FEE), "Should allow max fee");

        vm.stopPrank();
    }

    function test_setLpFeeRate_ownerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        hook.setLpFeeRate(5000);
    }

    function test_setLpFeeRate_rejectsAboveMax() public {
        vm.prank(owner);
        vm.expectRevert(UniAlignmentV4Hook.RateTooHigh.selector);
        hook.setLpFeeRate(uint24(LPFeeLibrary.MAX_LP_FEE + 1));
    }

    function test_setLpFeeRate_emitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit LpFeeRateUpdated(7500);
        hook.setLpFeeRate(7500);
    }

    // ========== beforeSwap: LP-fee override + guard ==========

    function test_beforeSwap_returnsLpFeeWithOverrideFlag() public {
        PoolKey memory key = _ethTokenPoolKey();
        // Sell params: shape-1 (exact-input ETH buy) fee branch is skipped, so beforeSwap returns the pure
        // LP-fee override with a zero delta.
        IPoolManager.SwapParams memory params = _sellParams(1 ether);

        vm.prank(poolManagerPlaceholder);
        (bytes4 selector, BeforeSwapDelta bsDelta, uint24 fee) = hook.beforeSwap(alice, key, params, bytes(""));

        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(
            BeforeSwapDelta.unwrap(bsDelta),
            BeforeSwapDelta.unwrap(BeforeSwapDeltaLibrary.ZERO_DELTA),
            "beforeSwap should not modify deltas on a non-ETH-input shape"
        );
        assertEq(
            fee, DEFAULT_LP_FEE_RATE | LPFeeLibrary.OVERRIDE_FEE_FLAG, "Must return lpFeeRate with OVERRIDE_FEE_FLAG"
        );
    }

    function test_beforeSwap_reflectsUpdatedRate() public {
        vm.prank(owner);
        hook.setLpFeeRate(10000);

        PoolKey memory key = _ethTokenPoolKey();
        IPoolManager.SwapParams memory params = _sellParams(1 ether);

        vm.prank(poolManagerPlaceholder);
        (,, uint24 fee) = hook.beforeSwap(alice, key, params, bytes(""));

        assertEq(fee, 10000 | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function test_beforeSwap_onlyPoolManager() public {
        PoolKey memory key = _ethTokenPoolKey();
        IPoolManager.SwapParams memory params = _sellParams(1 ether);

        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        hook.beforeSwap(alice, key, params, bytes(""));
    }

    // ========== afterSwap: access control ==========

    function test_afterSwap_onlyPoolManagerCanCall() public {
        PoolKey memory key = _ethTokenPoolKey();

        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        hook.afterSwap(alice, key, _sellParams(1 ether), BalanceDelta.wrap(0), bytes(""));
    }
}

// ========== Mocks ==========

/// @notice Minimal vault stub used only as the hook's constructor `vault` argument; no swap in this file
///         drives a contribution through it (that path is proven in RealSettlement).
contract MockVault {
    uint256 public lastFeeAmount;
    address public lastBenefactor;
    Currency public lastCurrency;
    bool public receivedFee;

    receive() external payable { }

    function receiveContribution(Currency currency, uint256 amount, address benefactor) external payable {
        lastFeeAmount = amount;
        lastBenefactor = benefactor;
        lastCurrency = currency;
        receivedFee = true;
    }
}
