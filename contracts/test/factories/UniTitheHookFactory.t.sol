// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { UniTitheHookFactory } from "../../src/factories/erc404/hooks/UniTitheHookFactory.sol";
import { UniAlignmentV4Hook } from "../../src/factories/erc404/hooks/UniAlignmentV4Hook.sol";
import { HookAddressMiner } from "../../src/factories/erc404/hooks/HookAddressMiner.sol";
import { IAlignmentHookFactory } from "../../src/factories/erc404/hooks/IAlignmentHookFactory.sol";
import { IAlignmentHook } from "../../src/factories/erc404/hooks/IAlignmentHook.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";

/**
 * @title UniTitheHookFactoryTest
 * @notice Default-profile unit tests for the alignment-hook TYPE #1 factory. Proves the on-chain mine +
 *         CREATE2 deploy yields a permission-bit-valid `UniAlignmentV4Hook` carrying the passed
 *         immutables, and that `hookFlags()` reports the 0xCC mask. No real PoolManager is needed here:
 *         the hook constructor's `validateHookPermissions()` inspects the hook's OWN address bits, so a
 *         non-zero dummy PoolManager is sufficient (the real-PoolManager pool-init proof lives in the
 *         v4-profile fork test). See UniAlignmentV4Hook_RealSettlement.t.sol.
 */
contract UniTitheHookFactoryTest is Test {
    UniTitheHookFactory internal factory;

    // Non-zero dummy PoolManager — the hook ctor only null-checks it; nothing here calls into it.
    IPoolManager internal constant DUMMY_PM = IPoolManager(address(0xBEEF));
    address internal constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address internal constant HOOK_OWNER = address(0xB055);

    IAlignmentVault internal constant VAULT = IAlignmentVault(payable(address(0xA17)));
    address internal constant BENEFACTOR = address(0x7777777777777777777777777777777777777777);
    uint256 internal constant HOOK_FEE_BIPS = 100; // 1%
    uint24 internal constant LP_FEE_RATE = 3000; // 0.3%

    function setUp() public {
        factory = new UniTitheHookFactory(DUMMY_PM, WETH, HOOK_OWNER);
    }

    function test_hookFlags_are_0xCC_mask() public view {
        (uint160 required, uint160 forbidden) = factory.hookFlags();
        assertEq(required, uint160(0xCC), "required flags must be 0xCC");
        assertEq(required, HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS, "required == miner 0xCC constant");
        assertEq(forbidden, HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS, "forbidden == complement");
        // Required and forbidden are disjoint; together they mask exactly the 14 hook bits.
        assertEq(required & forbidden, 0, "required/forbidden disjoint");
        assertEq(required | forbidden, HookAddressMiner.ALL_HOOK_FLAGS, "union == all 14 hook bits");
    }

    function test_deployHook_returns_permission_bit_valid_hook_with_immutables() public {
        address hookAddr = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);

        // Address carries EXACTLY the 0xCC permission bits (and no forbidden hook bits).
        assertTrue(
            HookAddressMiner.isValidUniAlignmentHookAddress(hookAddr), "mined hook address must carry exactly 0xCC"
        );

        // Deployed code is a real UniAlignmentV4Hook with the passed immutables + factory config.
        UniAlignmentV4Hook hook = UniAlignmentV4Hook(payable(hookAddr));
        assertEq(address(hook.poolManager()), address(DUMMY_PM), "poolManager from factory config");
        assertEq(address(hook.vault()), address(VAULT), "vault from deployHook arg");
        assertEq(hook.weth(), WETH, "weth from factory config");
        assertEq(hook.owner(), HOOK_OWNER, "owner from factory config");
        assertEq(hook.benefactor(), BENEFACTOR, "benefactor from deployHook arg");
        assertEq(hook.hookFeeBips(), HOOK_FEE_BIPS, "hookFeeBips from deployHook arg");
        assertEq(hook.lpFeeRate(), LP_FEE_RATE, "lpFeeRate from deployHook arg");

        // The returned type satisfies the alignment-hook marker interface.
        IAlignmentHook marker = IAlignmentHook(hookAddr);
        assertEq(marker.benefactor(), BENEFACTOR, "IAlignmentHook.benefactor");
        assertEq(address(marker.vault()), address(VAULT), "IAlignmentHook.vault");
    }

    function test_deployHook_produces_distinct_hooks_per_call() public {
        address a = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        // Different benefactor => different init code => different mined address (no CREATE2 collision).
        address b = factory.deployHook(VAULT, address(0x1234), HOOK_FEE_BIPS, LP_FEE_RATE);
        assertTrue(a != b, "distinct init code must yield distinct hook addresses");
        assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(b), "second hook also 0xCC-valid");
        assertEq(UniAlignmentV4Hook(payable(b)).benefactor(), address(0x1234), "second hook benefactor");
    }

    function test_constructor_rejects_zero_config() public {
        vm.expectRevert(UniTitheHookFactory.InvalidAddress.selector);
        new UniTitheHookFactory(IPoolManager(address(0)), WETH, HOOK_OWNER);
        vm.expectRevert(UniTitheHookFactory.InvalidAddress.selector);
        new UniTitheHookFactory(DUMMY_PM, address(0), HOOK_OWNER);
        vm.expectRevert(UniTitheHookFactory.InvalidAddress.selector);
        new UniTitheHookFactory(DUMMY_PM, WETH, address(0));
    }

    /**
     * @notice The mine reverts cleanly (never loops unbounded) when the required flags are unsatisfiable.
     * @dev We cannot exhaust the real MAX_ITERATIONS (10M) in a test, but we prove the guard is reachable:
     *      when a required bit is ALSO forbidden, `hasExactFlags` can never be true for ANY address, so the
     *      loop can only ever fall through to its `NoValidSaltFound` revert. This is the property that makes
     *      the factory's mine bounded rather than a brick.
     */
    function test_mine_unsatisfiable_flags_can_never_pass() public pure {
        // beforeSwap bit (0x80) marked BOTH required AND forbidden — unsatisfiable for any address.
        uint160 contradictory = uint160(0x80);
        for (uint160 a = 0; a < 4096; a += 7) {
            address probe = address(a);
            assertFalse(
                HookAddressMiner.hasExactFlags(probe, contradictory, contradictory),
                "a bit both required and forbidden is unsatisfiable for every address"
            );
        }
    }
}
